"""
Bulletproof Pipeline v4.3.1 â€” Complete Edition (Stitcher Fix)
=============================================================
* Strict Anti-Splitting Rules for Regionals.
* Implements post-processing cross-page stitcher with FULL field merging.
* Fix: Continuation rows now merge options, images, marks â€” not just text.
"""

import asyncio
import io
import json
import os
import re
import uuid
from datetime import datetime
from typing import Optional

import cv2
import fitz
import numpy as np
from PIL import Image

from .classifier import classify_page
from .constants  import MODEL_FLASH
from .validator  import confidence_score, has_correct_answer, is_mcq_row

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Redis / state helpers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _log(rc, job_id, text, log_type="info", data=None):
    if not rc: return
    payload = {"type": log_type, "text": text}
    if data is not None: payload["data"] = data
    try:
        await rc.publish(f"logs:{job_id}", json.dumps(payload))
    except Exception:
        pass

async def _get_state(rc, job_id) -> Optional[dict]:
    if not rc: return None
    try:
        raw = await rc.get(f"job:{job_id}")
        return json.loads(raw) if raw else None
    except Exception:
        return None

async def _save_state(rc, job_id, state):
    if not rc: return
    try:
        await rc.set(f"job:{job_id}", json.dumps(state, default=str))
    except Exception:
        pass

def _strip_fence(text: str) -> str:
    return re.sub(r"^```json\s*|```$", "", (text or "").strip(), flags=re.MULTILINE).strip()

def _clean_nulls(obj):
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if v is None or str(v).strip().lower() in ("null", "none", "undefined"):
                obj[k] = ""
            else:
                _clean_nulls(v)
    elif isinstance(obj, list):
        for item in obj:
            _clean_nulls(item)

def _safe_filename_part(s: str) -> str:
    return re.sub(r'[/\\:*?"<>|]', '-', str(s))

def is_marking_scheme_file(filename: str) -> bool:
    stem = os.path.splitext(os.path.basename(str(filename or "")))[0].lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", stem).strip()
    tokens = set(normalized.split())
    return (
        stem.startswith(("ms_", "ms-", "ms "))
        or "marking scheme" in normalized
        or "answer key" in normalized
        or "answerkey" in normalized
        or "solutions" in tokens
        or "solution" in tokens
        or "tm" in tokens
    )

def pdf_looks_like_marking_scheme(path, filename=""):
    if is_marking_scheme_file(filename):
        return True
    try:
        doc = fitz.open(path)
        text_parts = []
        for page_index in range(min(len(doc), 3)):
            text_parts.append(doc[page_index].get_text("text"))
        doc.close()
        normalized = re.sub(r"[^a-z0-9]+", " ", " ".join(text_parts).lower())
        return any(phrase in normalized for phrase in [
            "marking scheme",
            "answer key",
            "model answer",
            "suggested answer",
            "scheme of evaluation",
            "marking instructions",
        ])
    except Exception:
        return False

def extract_instruction_type_rules(qp_doc):
    rules = []
    label_patterns = [
        ("1 Mark (MCQ)", r"(?i)\b(?:mcq|multiple choice|objective(?: type)?|choose the correct)\b"),
        ("Very Short Answer (VSA)", r"(?i)\b(?:very short answer|vsa)\b"),
        ("Short Answer (SA)", r"(?i)\b(?:short answer|sa)\b"),
        ("Long Answer Type (LA)", r"(?i)\b(?:long answer|la)\b"),
    ]
    for page_index in range(min(len(qp_doc), 5)):
        text = qp_doc[page_index].get_text("text")
        if not text or not text.strip():
            continue
        compact = re.sub(r"\s+", " ", text)
        for qtype, label_re in label_patterns:
            for label_match in re.finditer(label_re, compact):
                window = compact[max(0, label_match.start() - 180): label_match.end() + 180]
                range_match = re.search(
                    r"(?i)(?:q(?:uestion)?\.?\s*(?:nos?\.?)?\s*)?(\d{1,3})\s*(?:-|–|—|to|से)\s*(\d{1,3})",
                    window,
                )
                if not range_match:
                    range_match = re.search(
                        r"(?i)(\d{1,3})\s*(?:-|–|—|to|से)\s*(\d{1,3})\s*(?:q(?:uestion)?|प्रश्न)",
                        window,
                    )
                if range_match:
                    start, end = int(range_match.group(1)), int(range_match.group(2))
                    if start <= end:
                        rules.append({"start": start, "end": end, "type": qtype, "source_page": page_index + 1})
    deduped, seen = [], set()
    for rule in rules:
        key = (rule["start"], rule["end"], rule["type"])
        if key not in seen:
            seen.add(key)
            deduped.append(rule)
    return deduped

def instruction_type_for_qno(q_sno, rules):
    match = re.search(r"\d+", str(q_sno or ""))
    if not match:
        return ""
    q_num = int(match.group(0))
    for rule in rules or []:
        if int(rule.get("start", -1)) <= q_num <= int(rule.get("end", -1)):
            return str(rule.get("type", "") or "")
    return ""

def unique_workspace_qno(rows, target_set, proposed_qno):
    proposed = str(proposed_qno or "").strip()
    existing = {
        str(row.get("Sl.No", "")).strip().lower()
        for row in rows
        if str(row.get("SET Name", "")).strip().upper() == str(target_set).strip().upper()
    }
    if proposed and proposed.lower() not in existing:
        return proposed, ""

    same_set_count = sum(
        1 for row in rows
        if str(row.get("SET Name", "")).strip().upper() == str(target_set).strip().upper()
    )
    next_num = same_set_count + 1
    while str(next_num).lower() in existing:
        next_num += 1
    return str(next_num), proposed

def enforce_unique_workspace_qnos(rows):
    cleaned = []
    for row in rows or []:
        fixed = dict(row)
        display_qno, original_qno = unique_workspace_qno(
            cleaned,
            fixed.get("SET Name", "A"),
            fixed.get("Sl.No")
        )
        if original_qno:
            fixed["Sl.No"] = display_qno
            fixed["Repeat Question Id (Optional)"] = fixed.get("Repeat Question Id (Optional)") or original_qno
        cleaned.append(fixed)
    return cleaned

SOURCE_NOISE_RE = re.compile(
    r"(?i)^\s*(?:"
    r"(?:source|reference|references|citation|citations|credit|credits)\s*:.*|"
    r"(?:neurochispas|lamar\s+university|byju'?s|khan\s+academy|wikipedia|britannica|"
    r"vedantu|toppr|cuemath|mathway|symbolab|brainly|chegg|quizlet)(?:\s*\+\d+)?|"
    r"[A-Z][A-Za-z0-9 .,&'()-]{2,70}\s+(?:University|College|Institute|Academy|School|"
    r"Board|Press|Education|Foundation|Publisher|Publications)(?:\s*\+\d+)?|"
    r"[A-Z][A-Za-z0-9 .,&'()-]{2,60}\s*\+\d+"
    r")\s*$"
)

QUESTION_SOLUTION_START_RE = re.compile(
    r"(?i)(?:^|\n)\s*(?:"
    r"answer\s*:|solution\s*:|explanation\s*:|"
    r"this\s+is\s+a\s+standard|you\s+can\s+solve\s+it|"
    r"\d+\.\s*(?:factoring|quadratic\s+formula|completing\s+the\s+square)|"
    r"this\s+problem\s+demonstrates|you\s+can\s+try\s+similar"
    r")\b"
)

def normalize_math_text(text: str) -> str:
    if not text:
        return ""
    cleaned = str(text)
    cleaned = cleaned.replace("âˆ’", "-").replace("â€“", "-").replace("â€”", "-").replace("âˆš ", "âˆš")
    cleaned = re.sub(r"\bsqrt\s*\(([^)]+)\)", r"âˆš(\1)", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b([A-Za-z])\s*\^\s*2\b", r"\1Â²", cleaned)
    cleaned = re.sub(r"\b([A-Za-z])\s*\^\s*3\b", r"\1Â³", cleaned)
    cleaned = re.sub(r"\b([A-Za-z])([23])\b", lambda m: f"{m.group(1)}{'Â²' if m.group(2) == '2' else 'Â³'}", cleaned)
    cleaned = re.sub(r"\b1\s*/\s*2\b", "1/2", cleaned)
    return cleaned

def normalize_ocr_spelling(text: str) -> str:
    if not text:
        return ""
    cleaned = str(text)
    cleaned = re.sub(r"(?i)<br\s*/?>", "\n", cleaned)
    cleaned = re.sub(r"(?i)\bgive\s+(?:n|in)\s+their\s+own\s+kind\b", "give birth to their own kind", cleaned)
    cleaned = re.sub(r"(?i)\breproduc\s+of\b", "reproduction of", cleaned)
    cleaned = re.sub(
        r"(?i)\b(reproductuion|reprodution|reproducation|reproduciton|reprodction|reprodcuction)\b",
        "reproduction",
        cleaned,
    )
    cleaned = re.sub(r"(?i)\base\b", "as", cleaned)
    cleaned = re.sub(r"(?i)\bbacterias\b", "bacteria", cleaned)
    cleaned = re.sub(r"(?i)\bprotozoas\b", "protozoa", cleaned)
    cleaned = re.sub(r"(?i)\balgaes\b", "algae", cleaned)
    cleaned = re.sub(
        r"(?i)\bIt may occur as Asexual and sexual mode of reproduction lower organisms\b",
        "It may occur in asexual and sexual modes of reproduction. Lower organisms",
        cleaned,
    )
    cleaned = re.sub(r"(?i)\balgae\s+reproduces\s+as\s+The\b", "algae reproduce. The", cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r" *\n *", "\n", cleaned)
    cleaned = re.sub(r"\s+([,.;:?!])", r"\1", cleaned)
    cleaned = re.sub(r"([,.;:?!])([A-Za-z])", r"\1 \2", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

def strip_source_noise(text: str) -> str:
    if not text:
        return ""
    lines = []
    for raw_line in str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if not line or SOURCE_NOISE_RE.match(line):
            continue
        lines.append(line)
    return "\n".join(lines).strip()

def clean_question_export_text(text: str, strip_bullets) -> str:
    cleaned = normalize_ocr_spelling(strip_source_noise(normalize_math_text(strip_bullets(text))))
    match = QUESTION_SOLUTION_START_RE.search(cleaned)
    if match:
        cleaned = cleaned[:match.start()].strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

def clean_export_text(text: str, strip_bullets) -> str:
    cleaned = normalize_ocr_spelling(strip_source_noise(normalize_math_text(strip_bullets(text))))
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Flash-only QP page extractor
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _extract_page_flash(
    job_id, page, page_num, doc_profile, target_lang,
    PageExtractionResult, get_next_key, rc, semaphore=None,
):
    from google import genai
    from google.genai import types

    info = classify_page(page)
    zoom = info["zoom"]

    if info["is_scanned"] or info["is_legacy_font"]:
        grounding  = f"VISION MODE: Transcribe ALL visible text in {target_lang} script exactly as printed."
        text_block = "LOCAL RAW TEXT: [Image or legacy font â€” transcribe from image]"
    else:
        raw        = info["raw_text"][:3000]
        grounding  = f"TEXT GROUNDING: Use the raw text below as primary source. Paper language: {target_lang}."
        text_block = f'LOCAL RAW TEXT:\n"""{raw}"""'

    prompt = f"""ROLE: Exam question extractor for {target_lang}-medium papers.

{grounding}

RULES:
1. Extract ONLY actual exam questions. Skip general instructions, headers, and page numbers.
2. CRITICAL: Preserve all numbering, A/B/C/D, and regional letters exactly as printed.
3. THE IRON-CLAD GROUPING RULE (NO SPLITTING): If a question has multiple sub-partsâ€”whether numbered as (a, b, c), (1.1, 1.2), (à°…, à°†, à°‡), or (i, ii, iii)â€”and they do NOT have their own separate 4 options (A,B,C,D), YOU MUST NOT SPLIT THEM. Combine ALL sub-parts into ONE single `question_text` string separated by \\n. Put the shared instruction in `question_header`.
4. THE "OR" RULE: If a question has alternative choices separated by "OR", split the alternative into a separate row. Use the original number for the first choice (for example "37") and append "_OR" for the alternative row (for example "37_OR").
5. PAGE BOUNDARY ORPHANS: If the text at the top of the page is a continuation of sub-parts from the previous page (e.g., it starts directly with ix, x), group them into ONE object and set `q_sno` STRICTLY to "CONTINUATION".
6. ONLY split into separate objects if the sub-questions are actual MCQs with their own 4 multiple-choice options.
7. q_sno: Use the exact main Arabic numeral printed on the page (e.g., 18, 19, 25).
8. No LaTeX. Use plain Unicode for maths.
9. requires_crop = true ONLY for actual drawn diagrams. Do not guess or hallucinate.
10. Keep `question_text` as the question only. Do not include solved steps, explanations, web snippets, source names, citations, or practice suggestions.
11. PAGE-BREAK CONTINUITY: If a passage, paragraph, long question, or OR alternative starts near the bottom of one page and continues on the next page, preserve it as ONE logical question. Put the full shared passage/instruction in `question_header`, not inside `question_text`, and do not create empty continuation rows.
12. HEADER VISIBILITY: Any long shared paragraph, case study, poem, table instruction, or "Read the following..." block belongs in `question_header`. The actual asked sub-question only belongs in `question_text`.
13. SPELLING AND HTML CLEANUP: Output clean textbook text. Correct obvious OCR/vision spelling breaks while preserving meaning. Never output raw HTML tags like <br>; use real line breaks. Common subject words must be spelled correctly, such as reproduction, asexual, sexual, bacteria, protozoa, algae, and organism.
14. QUESTION TYPE SOURCE: Use the paper's instruction page and section headings to decide MCQ, Very Short Answer, Short Answer, Long Answer, etc. Do not infer the type from marks alone when instructions say otherwise.

{text_block}
"""

    mat     = fitz.Matrix(zoom, zoom)
    pil_img = Image.open(io.BytesIO(page.get_pixmap(matrix=mat).tobytes("jpeg", 85)))

    await _log(rc, job_id, f"      [QP Pg {page_num}] Extracting page...", "info")

    for attempt in range(5):
        # Exponential backoff between attempts
        if attempt > 0:
            wait = min(10 * (2 ** (attempt - 1)), 60)
            await _log(rc, job_id, f"      â³ [QP Pg {page_num}] Retrying in {wait}s (attempt {attempt + 1}/5)...", "warning")
            await asyncio.sleep(wait)
        try:
            client = genai.Client(api_key=get_next_key())
            def _call():
                return client.models.generate_content(
                    model=MODEL_FLASH,
                    contents=[pil_img, prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=PageExtractionResult,
                        temperature=0.0,
                    ),
                )

            if semaphore:
                async with semaphore:
                    res = await asyncio.wait_for(asyncio.to_thread(_call), timeout=120.0)
            else:
                res = await asyncio.wait_for(asyncio.to_thread(_call), timeout=120.0)

            raw    = _strip_fence(res.text or "")
            if not raw:
                raise ValueError("empty extraction response")

            safe   = re.sub(r"(?<!\\)\\(?![nrt\"\\bfu/])", r"\\\\", raw)
            parsed = json.loads(safe)
            _clean_nulls(parsed)

            actual = [q for q in parsed.get("questions", []) if q.get("is_actual_test_question")]

            if not actual and not info["is_scanned"] and info["alpha_len"] > 80:
                await _log(rc, job_id, f"      âš ï¸  [QP Pg {page_num}] 0 questions on text-rich page.", "warning")
                # RETRY with a more aggressive prompt
                retry_prompt = f"""ROLE: Exam question extractor for {target_lang}-medium papers.

            {grounding}

            CRITICAL RETRY: The first pass found ZERO questions on this page, but it contains substantial text.
            Look MORE carefully â€” questions may be mixed with instructions or headers.
            Extract ANY numbered items (1, 2, 3...) that contain exam content, even if they appear right after instructions.

            {text_block}
            """
                try:
                    client2 = genai.Client(api_key=get_next_key())
                    def _retry():
                        return client2.models.generate_content(
                            model=MODEL_FLASH,
                            contents=[pil_img, retry_prompt],
                            config=types.GenerateContentConfig(
                                response_mime_type="application/json",
                                response_schema=PageExtractionResult,
                                temperature=0.1,
                            ),
                        )
                    res2 = await asyncio.wait_for(asyncio.to_thread(_retry), timeout=120.0)
                    raw2 = _strip_fence(res2.text or "")
                    if raw2:
                        safe2 = re.sub(r"(?<!\\)\\(?![nrt\"\\bfu/])", r"\\\\", raw2)
                        parsed2 = json.loads(safe2)
                        _clean_nulls(parsed2)
                        retry_actual = [q for q in parsed2.get("questions", []) if q.get("is_actual_test_question")]
                        if retry_actual:
                            await _log(rc, job_id, f"      ðŸ”„ [QP Pg {page_num}] Retry found {len(retry_actual)} question(s)!", "success")
                            return parsed2
                except Exception:
                    pass

                return {}

            await _log(rc, job_id, f"      âœ… [QP Pg {page_num}] Found {len(actual)} question(s).", "info")
            return parsed

        except asyncio.TimeoutError:
            await _log(rc, job_id, f"      â³ [QP Pg {page_num}] Timeout on attempt {attempt + 1}/5.", "warning")
            continue
        except Exception as e:
            err = str(e).lower()
            await _log(rc, job_id, f"      âŒ [QP Pg {page_num}] Error attempt {attempt + 1}/5: {err[:80]}", "warning")
            if "429" in err or "quota" in err or "rate" in err:
                await asyncio.sleep(30)
            elif "503" in err or "unavailable" in err or "high demand" in err:
                await asyncio.sleep(20)
            else:
                await asyncio.sleep(5)
            continue

    await _log(rc, job_id, f"      âŒ [QP Pg {page_num}] All 5 attempts failed â€” page skipped.", "warning")
    return {}


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Render MS pages
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def _render_ms_pages(job_id, ms_doc, ms_ui_pages_dir, pages, rc):
    await _log(rc, job_id, f"   \u21b3 \U0001f4cb Rendering {len(pages)} MS page(s)...", "info")
    rendered = 0
    for pn in pages:
        if pn >= len(ms_doc):
            continue
        try:
            pix  = ms_doc[pn].get_pixmap(matrix=fitz.Matrix(4, 4))
            path = os.path.join(ms_ui_pages_dir, f"ms_page_{pn + 1}.png")
            pix.save(path, "jpeg", 85)
            rendered += 1
        except Exception:
            pass
    await _log(rc, job_id, f"   \u21b3 \u2705 {rendered} MS page(s) ready for Phase B scan.", "success")

def _normalize_ms_marks(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    raw = raw.replace("×", "x").replace("X", "x")
    equals_match = re.search(r"=\s*(\d+(?:\.\d+)?)\s*$", raw)
    if equals_match:
        return equals_match.group(1).rstrip("0").rstrip(".")
    product_match = re.fullmatch(r"\s*(\d+(?:\.\d+)?|\d+\s*/\s*\d+)\s*x\s*(\d+(?:\.\d+)?)\s*", raw)
    if product_match:
        left, right = product_match.groups()
        if "/" in left:
            num, den = [float(part.strip()) for part in left.split("/", 1)]
            left_value = num / den if den else 0.0
        else:
            left_value = float(left)
        total = left_value * float(right)
        return str(int(total)) if total.is_integer() else str(total)
    plus_match = re.fullmatch(r"\s*\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)+\s*", raw)
    if plus_match:
        total = sum(float(part.strip()) for part in raw.split("+"))
        return str(int(total)) if total.is_integer() else str(total)
    return raw

def _normalize_option_letter(text: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return ""
    raw_upper = raw.upper()[:1]
    if raw_upper in ("A", "B", "C", "D"):
        return raw_upper
    indic_map = {
        "क": "A", "ख": "B", "ग": "C", "घ": "D",
        "अ": "A", "आ": "B", "इ": "C", "ई": "D",
        "அ": "A", "ஆ": "B", "இ": "C", "ஈ": "D",
        "అ": "A", "ఆ": "B", "ఇ": "C", "ఈ": "D",
        "ಅ": "A", "ಆ": "B", "ಇ": "C", "ಈ": "D",
    }
    return indic_map.get(raw[:1], "")

def _infer_option_letter_from_text(answer_text: str) -> str:
    text = str(answer_text or "")
    match = re.search(r"(?i)\(([a-d])\)", text)
    if not match:
        match = re.search(r"\(([कखगघअआइईஅஆஇஈఅఆఇఈಅಆಇಈ])\)", text)
    if not match:
        match = re.search(r"(?i)(?:^|[^A-Za-z])([a-d])(?:[^A-Za-z]|$)", text)
    return _normalize_option_letter(match.group(1)) if match else ""

def _infer_option_letter_from_page_text(q_sno: str, page_text: str) -> str:
    q_clean = str(q_sno or "").strip()
    if not q_clean or not re.fullmatch(r"\d+", q_clean):
        return ""
    lines = [line.strip() for line in str(page_text or "").splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if line.rstrip("*") != q_clean:
            continue
        for lookahead in lines[index + 1:index + 8]:
            if re.fullmatch(r"\d+\*?", lookahead) and lookahead.rstrip("*") != q_clean:
                break
            option_match = re.search(r"(?i)\(([a-d])\)", lookahead) or re.search(r"\(([कखगघअआइईஅஆஇஈఅఆఇಈಅಆಇಈ])\)", lookahead)
            if option_match and (" or " in f" {lookahead.lower()} " or "अथवा" in lookahead or len(lookahead) <= 40):
                return _normalize_option_letter(option_match.group(1))
    return ""

async def _extract_ms_answers(job_id, ms_doc, doc_images_dir, ms_ui_pages_dir, base_name, target_set, sub_code, pages, AnswerKeyPage, get_next_key, rc, semaphore=None):
    from google import genai
    from google.genai import types

    ms_answers = {}
    page_list = pages or list(range(len(ms_doc)))
    await _log(rc, job_id, f"   -> MS extraction enabled for language parser: {len(page_list)} page(s).", "info")

    def merge_answer(existing: dict, incoming: dict) -> dict:
        if not existing:
            return incoming
        merged = dict(existing)
        for key in ("correct_option_letter", "marks_awarded", "ms_page_url", "page_number", "primary_ref"):
            if not str(merged.get(key, "")).strip() and str(incoming.get(key, "")).strip():
                merged[key] = incoming.get(key, "")
        old_text = str(merged.get("full_answer_text", "") or "").strip()
        new_text = str(incoming.get("full_answer_text", "") or "").strip()
        if new_text and new_text.lower() not in old_text.lower():
            merged["full_answer_text"] = f"{old_text}\n{new_text}".strip() if old_text else new_text
        return merged

    for page_num in page_list:
        if page_num >= len(ms_doc):
            continue
        page = ms_doc[page_num]
        ms_ui_filename = f"ms_page_{page_num + 1}.png"
        ms_ui_path = os.path.join(ms_ui_pages_dir, ms_ui_filename)
        ms_page_url = f"/workspace/{job_id}/ms_ui_pages/{base_name}/{ms_ui_filename}"
        try:
            page.get_pixmap(matrix=fitz.Matrix(4, 4)).save(ms_ui_path, "jpeg", 85)
        except Exception:
            pass

        local_raw_text = page.get_text("text").strip()
        pil_img = Image.open(io.BytesIO(page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5)).tobytes("jpeg", 85)))
        prompt = f"""ROLE: Exam marking-scheme extractor for a regional-language paper.

Read this MARKING SCHEME page for SET {target_set}. Extract answer-key data only.

Return JSON matching the schema exactly:
- detected_question_numbers: every question number visible.
- answers: one object per answer block.

Rules:
1. q_sno must be the exact main question number. If there is an OR/अथवा answer, append _OR only for the alternative row.
2. For MCQ answers, correct_option_letter may be A/B/C/D or local option letters like क/ख/ग/घ. If a cell says "(क) ... अथवा (घ) ...", use the FIRST visible option for this uploaded QP.
3. full_answer_text must contain descriptive/fill/short-answer text.
4. marks_awarded should be the total marks value only where possible.
5. Ignore page numbers, headers, and general instructions.

LOCAL RAW TEXT:
\"\"\"{local_raw_text[:6000]}\"\"\"
"""

        parsed = None
        for attempt in range(3):
            try:
                client = genai.Client(api_key=get_next_key())
                def _call():
                    return client.models.generate_content(
                        model=MODEL_FLASH,
                        contents=[pil_img, prompt],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=AnswerKeyPage,
                            temperature=0.0,
                        ),
                    )
                if semaphore:
                    async with semaphore:
                        res = await asyncio.wait_for(asyncio.to_thread(_call), timeout=150.0)
                else:
                    res = await asyncio.wait_for(asyncio.to_thread(_call), timeout=150.0)
                raw = _strip_fence(res.text or "")
                safe = re.sub(r"(?<!\\)\\(?![nrt\"\\bfu/])", r"\\\\", raw)
                parsed = json.loads(safe)
                _clean_nulls(parsed)
                break
            except asyncio.TimeoutError:
                await _log(rc, job_id, f"      MS page {page_num + 1} timed out. Retrying...", "warning")
            except Exception as exc:
                err = str(exc).lower()
                if "429" in err or "quota" in err or "rate" in err or "503" in err:
                    await asyncio.sleep(10)
                    continue
                if attempt == 2:
                    await _log(rc, job_id, f"      MS page {page_num + 1} parse failed: {str(exc)[:100]}", "warning")

        if not parsed:
            continue

        page_count = 0
        for raw_item in parsed.get("answers", []) or []:
            item = raw_item if isinstance(raw_item, dict) else {}
            q_sno = str(item.get("q_sno", "") or "").strip().rstrip("*")
            if not re.search(r"\d", q_sno):
                continue
            norm = re.sub(r"[^0-9a-zA-Z]", "", q_sno).lower()
            key = f"{target_set}_{norm}"
            answer_text = str(item.get("full_answer_text", "") or "").strip()
            letter = _normalize_option_letter(item.get("correct_option_letter", ""))
            page_text_letter = _infer_option_letter_from_page_text(q_sno, local_raw_text)
            text_letter = _infer_option_letter_from_text(answer_text)
            if page_text_letter and (not letter or answer_text.strip().lower().startswith(("or", "अथवा"))):
                letter = page_text_letter
            elif not letter:
                letter = text_letter
            item.update({
                "q_sno": q_sno,
                "correct_option_letter": letter,
                "full_answer_text": answer_text,
                "marks_awarded": _normalize_ms_marks(item.get("marks_awarded", "")),
                "ms_page_url": ms_page_url,
                "page_number": str(page_num + 1),
                "primary_ref": q_sno,
            })
            ms_answers[key] = merge_answer(ms_answers.get(key, {}), item)
            page_count += 1
        await _log(rc, job_id, f"      MS page {page_num + 1}: extracted {page_count} answer item(s).", "success")

    await _log(rc, job_id, f"   -> MS extraction complete: {len(ms_answers)} answer item(s) mapped.", "success")
    return ms_answers

def _apply_ms_to_row(row: dict, ms_data: dict) -> dict:
    if not ms_data:
        return row
    updated = dict(row)
    marks = str(ms_data.get("marks_awarded", "") or "").strip()
    if marks:
        updated["Marks (Mandatory)"] = marks
    ms_url = str(ms_data.get("ms_page_url", "") or "").strip()
    if ms_url:
        updated["MS_Page_Image_URL"] = ms_url
    letter = _normalize_option_letter(ms_data.get("correct_option_letter", ""))
    has_options = int(str(updated.get("No. of Options/Blanks (Mandatory)", "0") or "0") or 0) > 0
    if has_options and letter:
        idx = {"A": 1, "B": 2, "C": 3, "D": 4}.get(letter, 0)
        for option_idx in range(1, 5):
            updated[f"Option{option_idx} Is Correct?"] = "Yes" if option_idx == idx else "No"
        updated["MS_Confidence"] = "85"
    elif not has_options and str(ms_data.get("full_answer_text", "") or "").strip():
        updated["Option1 (Mandatory)"] = str(ms_data.get("full_answer_text", "") or "").strip()
        updated["Option1 Is Correct?"] = "Yes"
        updated["MS_Confidence"] = "85"
    return updated


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Crop helper
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _crop_sync(image_path, questions, output_dir, subject_code, normalize_qno):
    try:
        with open(image_path, "rb") as f:
            arr = np.frombuffer(f.read(), dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    except Exception:
        return {}
        
    if img is None:
        return {}

    h, w  = img.shape[:2]
    result = {}
    safe_code = _safe_filename_part(subject_code)

    def _cut(box, q_set, q_num, sfx):
        if not box or len(box) != 4:
            return ""
        ymin, xmin, ymax, xmax = box
        py, px = int(h * 0.015), int(w * 0.015)
        y1, x1 = max(0, int(ymin / 1000 * h) - py), max(0, int(xmin / 1000 * w) - px)
        y2, x2 = min(h, int(ymax / 1000 * h) + py), min(w, int(xmax / 1000 * w) + px)
        if y1 >= y2 or x1 >= x2:
            return ""
        crop = img[y1:y2, x1:x2]
        if crop is None or crop.size == 0:
            return ""
        safe_qnum = _safe_filename_part(q_num)
        ts   = datetime.now().strftime("%H-%M-%S-%f")[:12]
        name = f"{safe_code}_{q_set}_{ts}_{safe_qnum.upper()}{sfx}.png"
        cv2.imencode(".png", crop)[1].tofile(os.path.join(output_dir, name))
        return name

    for q in questions:
        q_sno = str(q.get("q_sno", ""))
        norm  = normalize_qno(q_sno)
        q_set = str(q.get("set_name", "A")).strip().upper()
        key   = f"{q_set}_{norm}"
        paths = {}
        if q.get("requires_crop"):
            paths["main"] = _cut(q.get("crop_box_2d"), q_set, norm, "")
        for n, sfx in [(1, "_opt1"), (2, "_opt2"), (3, "_opt3"), (4, "_opt4")]:
            if q.get(f"opt{n}_requires_crop"):
                paths[f"opt{n}"] = _cut(q.get(f"opt{n}_crop_box"), q_set, norm, sfx)
        if paths:
            result[key] = paths
            
    return result

def _display_qno_from_detected(value):
    raw = str(value or "").strip()
    if not raw:
        return ""
    has_or = bool(re.search(r"\bOR\b|_OR$", raw, flags=re.IGNORECASE))
    match = re.search(r"\d+", raw)
    if not match:
        return ""
    return f"{match.group(0)}_OR" if has_or else match.group(0)

def _detected_qno_sequence(page_res):
    sequence = []
    seen = set()
    for raw in (page_res or {}).get("detected_question_numbers", []) or []:
        display = _display_qno_from_detected(raw)
        if not display:
            continue
        key = display.lower()
        if key in seen:
            continue
        seen.add(key)
        sequence.append(display)
    return sequence

def _repair_page_question_numbers(questions, page_res):
    sequence = _detected_qno_sequence(page_res)
    if len(sequence) < len(questions or []):
        return []

    changes = []
    for question, repaired_qno in zip(questions, sequence):
        old_qno = str(question.get("q_sno", "")).strip()
        if repaired_qno and old_qno != repaired_qno:
            question["_original_q_sno"] = old_qno
            question["q_sno"] = repaired_qno
            changes.append((old_qno, repaired_qno))
    return changes


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Row builder
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _build_row(q, target_set, page_num, page_url, ms_url,
               base_name, doc_meta, crops, strip_bullets, format_mode, instruction_type_rules=None):
    q_sno  = str(q.get("q_sno", "")).strip()
    q_text = clean_question_export_text(str(q.get("question_text") or q.get("question_text_english") or "").strip(), strip_bullets)
    q_header = clean_export_text(str(q.get("question_header", "") or "").strip(), strip_bullets)

    opts = [clean_export_text(str(q.get(f"option_{n}") or q.get(f"option_{n}_english") or "").strip(), strip_bullets) for n in range(1, 5)]
    opt_imgs = [crops.get(f"opt{n}", "") for n in range(1, 5)]
    
    num_opts = sum(1 for i, o in enumerate(opts) if o or opt_imgs[i])
    is_mcq   = num_opts > 0
    correct = ["No"] * 4
    marks = str(q.get("marks", "") or "").strip()
    if not marks and is_mcq:
        marks = "1"
    
    try:
        m    = float(marks.replace("\u00bd", "0.5").replace("\u00bc", "0.25"))
        comp = "Easy" if m <= 2 else ("Hard" if m >= 5 else "Medium")
    except Exception:
        comp = "Medium"

    if is_mcq:
        q_type, obj_type = "1 Mark (MCQ)", "1 Mark (MCQ)"
    else:
        rqt, robj = str(q.get("type_of_question", "")).lower(), str(q.get("objective_type", "")).lower()
        q_type = ("Very Short Answer (VSA)" if "vsa" in rqt or "very short" in rqt else "Short Answer (SA)" if "sa" in rqt or ("short" in rqt and "very" not in rqt) else "Long Answer Type (LA)" if "la" in rqt or "long" in rqt else "Skill (Map)" if "map" in rqt or "skill" in rqt else "Objective-Type Questions")
        obj_type = ("Fill in the blanks" if "fill" in robj or "blank" in robj else "match the column" if "match" in robj else "True False" if "true" in robj or "false" in robj else "one-word questions" if "one" in robj and "word" in robj else "paragraph or case-based questions" if "paragraph" in robj or "case" in robj else "Diagram Based" if "diagram" in robj else "Map-Based" if "map" in robj else "None")

    instruction_q_type = instruction_type_for_qno(q_sno, instruction_type_rules)
    if instruction_q_type:
        q_type = instruction_q_type
        if instruction_q_type == "1 Mark (MCQ)":
            obj_type = "1 Mark (MCQ)"

    bloom_raw = str(q.get("blooms_taxonomy", "Understanding")).strip().title()
    bloom = "Knowledge" if any(x in bloom_raw for x in ("Know", "Rememb")) else "Application" if "App" in bloom_raw else "Understanding"
    q_img = crops.get("main", "")
    conf  = confidence_score({"Question text(Mandatory)": q_text, "No. of Options/Blanks (Mandatory)": str(num_opts), "Option1 Is Correct?": correct[0], "Option1 (Mandatory)": opts[0]})
    
    def mode(key, img):
        return format_mode(q.get(key), bool(img))

    return {
        "id": str(uuid.uuid4()),
        "Sl.No": q_sno,
        "Class": doc_meta.get("class", ""),
        "Subject Name": doc_meta.get("subject", ""),
        "Subject Code": doc_meta.get("code", ""),
        "SET Name": target_set,
        "Lesson/Module": str(q.get("lesson_module", "") or ""),
        "Chapter": str(q.get("chapter", "") or ""),
        "Translate Language": doc_meta.get("language", ""),
        "Question Mode (Mandatory)": mode("mode_of_question", q_img),
        "Question text(Mandatory)": q_text,
        "Question Type (Mandatory)": "Standard",
        "Question Translate": "",
        "Question Translate Image": "",
        "If Question is Image, Specify Image Name": q_img,
        "Marks (Mandatory)": marks,
        "Negative Marks": "",
        "No. of Options/Blanks (Mandatory)": str(num_opts) if is_mcq else "0",
        "Repeat Question Id (Optional)": "",
        "Option1 Mode (Mandatory)": mode("opt1_mode", opt_imgs[0]),
        "Option1 (Mandatory)": opts[0],
        "Option1 Translate": "",
        "Option1 Translate Image": "",
        "If Option1 is Image, Specify Image Name": opt_imgs[0],
        "Option1 Is Correct?": correct[0],
        "Option2 Mode (Mandatory)": mode("opt2_mode", opt_imgs[1]),
        "Option2 (Mandatory)": opts[1],
        "Option2 Translate": "",
        "Option2 Translate Image": "",
        "If Option2 is Image, Specify Image Name": opt_imgs[1],
        "Option2 Is Correct?": correct[1],
        "Option3 Mode (Mandatory)": mode("opt3_mode", opt_imgs[2]),
        "Option3 (Mandatory)": opts[2],
        "Option3 Translate": "",
        "Option3 Translate Image": "",
        "If Option3 is Image, Specify Image Name": opt_imgs[2],
        "Option3 Is Correct?": correct[2],
        "Option4 Mode (Mandatory)": mode("opt4_mode", opt_imgs[3]),
        "Option4 (Mandatory)": opts[3],
        "Option4 Translate": "",
        "Option4 Translate Image": "",
        "If Option4 is Image, Specify Image Name": opt_imgs[3],
        "Option4 Is Correct?": correct[3],
        "Option5 Mode (Mandatory)": "",
        "Option5 (Mandatory)": "",
        "Option5 Translate": "",
        "Option5 Translate Image": "",
        "If Option5 is Image, Specify Image Name": "",
        "Option5 Is Correct?": "",
        "Option6 Mode (Mandatory)": "",
        "Option6 (Mandatory)": "",
        "Option6 Translate": "",
        "Option6 Translate Image": "",
        "If Option6 is Image, Specify Image Name": "",
        "Option6 Is Correct?": "",
        "IsNestedMainQuestionType": "No",
        "NoofNestedQuestions": "",
        "Parent Question No(if it is nested sub question)": "",
        "NIOS Filename": f"{base_name}.pdf",
        "Question Complexity": comp,
        "Objective Type Questions": obj_type,
        "Question Header": q_header,
        "Answer_Diagram_Image": "",
        "Bloom\'s Taxonomy": bloom,
        "Type of question (Mandatory)": q_type,
        "Duplicate_Flag": "No",
        "MS_Diagram_Flag": "No",
        "Page_Number": str(page_num),
        "Page_Image_URL": page_url,
        "MS_Page_Image_URL": ms_url,
        "Extraction_Confidence": str(conf),
        "QP_Confidence": str(conf),
        "MS_Confidence": "0",
        "Is_Verified": "No",
    }


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Boundary helpers
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _detect_bounds(qp_doc) -> dict:
    bounds = {"A": 0, "B": -1, "C": -1}
    for i in range(len(qp_doc)):
        t = qp_doc[i].get_text("text").upper()
        if bounds["B"] == -1 and re.search(r"SET.{0,15}\bB\b", t):
            bounds["B"] = i
        if bounds["C"] == -1 and re.search(r"SET.{0,15}\bC\b", t):
            bounds["C"] = i
    total = len(qp_doc)
    if bounds["B"] == -1 and total > 30:
        p = total // 3
        bounds["B"], bounds["C"] = p, p * 2
    return bounds

def _qp_pages(bounds, target_set, total):
    b = bounds["B"] if bounds["B"] != -1 else total
    c = bounds["C"] if bounds["C"] != -1 else total
    if target_set == "A":  return list(range(0, b))
    if target_set == "B":  return list(range(b, c)) if bounds["B"] != -1 else []
    if target_set == "C":  return list(range(c, total)) if bounds["C"] != -1 else []
    return list(range(0, total))

def _ms_pages(ms_doc, target_set):
    ms_b, ms_c = -1, -1
    for i in range(len(ms_doc)):
        t = ms_doc[i].get_text("text").upper()
        if ms_b == -1 and i > 1 and re.search(r"SET.{0,15}\bB\b|MARKING.*\bB\b", t):
            ms_b = i
        if ms_c == -1 and i > 1 and re.search(r"SET.{0,15}\bC\b|MARKING.*\bC\b", t):
            ms_c = i
    total = len(ms_doc)
    if ms_b != -1:
        if target_set == "A":  return list(range(0, ms_b))
        if target_set == "B":  return list(range(ms_b, ms_c if ms_c != -1 else total))
        if target_set == "C":  return list(range(ms_c, total)) if ms_c != -1 else []
    return list(range(0, total))


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Cross-Page Stitcher v2 â€” Full Field Merge
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

def _stitch_continuations(parsed_data):
    """
    Merge CONTINUATION rows into the previous question.
    v2: merges options, images, marks, headers â€” not just question text.
    """
    stitched = []
    for row in parsed_data:
        sno  = str(row.get("Sl.No", "")).strip().upper()
        text = str(row.get("Question text(Mandatory)", ""))

        if sno == "CONTINUATION" and stitched:
            prev = stitched[-1]

            # â”€â”€ Merge question text â”€â”€
            prev["Question text(Mandatory)"] = (
                str(prev.get("Question text(Mandatory)", "")) + "\n" + text
            )

            # â”€â”€ Merge options: only if prev slot is empty and continuation has data â”€â”€
            for n in range(1, 5):
                opt_key     = f"Option{n} (Mandatory)"
                opt_img     = f"If Option{n} is Image, Specify Image Name"
                opt_correct = f"Option{n} Is Correct?"
                opt_mode    = f"Option{n} Mode (Mandatory)"

                if not str(prev.get(opt_key, "")).strip() and str(row.get(opt_key, "")).strip():
                    prev[opt_key]     = row[opt_key]
                    prev[opt_img]     = row.get(opt_img, "")
                    prev[opt_correct] = row.get(opt_correct, "No")
                    prev[opt_mode]    = row.get(opt_mode, "General")

            # â”€â”€ Recalculate option count after merge â”€â”€
            cont_opts = sum(
                1 for n in range(1, 5)
                if str(prev.get(f"Option{n} (Mandatory)", "")).strip()
            )
            if cont_opts > 0:
                prev["No. of Options/Blanks (Mandatory)"] = str(cont_opts)

            # â”€â”€ Merge image fields: don't overwrite existing â”€â”€
            for img_field in [
                "If Question is Image, Specify Image Name",
                "Answer_Diagram_Image",
            ]:
                if not str(prev.get(img_field, "")).strip() and str(row.get(img_field, "")).strip():
                    prev[img_field] = row[img_field]

            # â”€â”€ Merge marks if prev is empty â”€â”€
            if not str(prev.get("Marks (Mandatory)", "")).strip():
                prev["Marks (Mandatory)"] = row.get("Marks (Mandatory)", "")

            # â”€â”€ Merge question header â”€â”€
            prev_header = str(prev.get("Question Header", "")).strip()
            cont_header = str(row.get("Question Header", "")).strip()
            if cont_header and not prev_header:
                prev["Question Header"] = cont_header

        else:
            stitched.append(row)

    return stitched


# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# Public entry point
# â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async def bulletproof_process_set(
    job_id, files_info, job_folder, target_set="A",
    active_redis_client=None, PageExtractionResult=None, AnswerKeyPage=None, 
    DocumentProfile=None, scout_document_profile=None, process_qp_crops_sync=None,
    get_base_name=None, normalize_qno=None, strip_bullets=None, format_mode=None, get_next_key=None,
):
    rc = active_redis_client
    _api_semaphore = asyncio.Semaphore(2)
    async def L(text, lt="info", data=None):
        await _log(rc, job_id, text, lt, data)

    try:
        state = await _get_state(rc, job_id)
        if not state:
            await L("Job state missing â€” aborting.", "error")
            await L("ALL_DONE", "system_control")
            return

        await L(f"Bulletproof v4.3.1 | SET {target_set} | Stitcher Fix Edition", "info")
        await L("5", "progress")

        if not state.get("qp_doc_path") and files_info:
            qp_files = [fi for fi in files_info if not pdf_looks_like_marking_scheme(fi["path"], fi["name"])]
            ms_files = [fi for fi in files_info if pdf_looks_like_marking_scheme(fi["path"], fi["name"])]
            pairs = {}
            if len(qp_files) == 1 and len(ms_files) == 1:
                base = get_base_name(qp_files[0]["name"])
                pairs[base] = {"qp": qp_files[0]["path"], "ms": ms_files[0]["path"]}
                await L("QP and MS names differ; pairing the single uploaded question paper with the single uploaded marking scheme.", "info")
            elif len(files_info) == 2 and not ms_files:
                base = get_base_name(files_info[0]["name"])
                pairs[base] = {"qp": files_info[0]["path"], "ms": files_info[1]["path"]}
                await L("QP/MS role fallback: two PDFs uploaded with unclear names; treating first file as QP and second file as MS.", "warning")
            elif qp_files and len(qp_files) == len(ms_files):
                for qp_file, ms_file in zip(qp_files, ms_files):
                    base = get_base_name(qp_file["name"])
                    pairs[base] = {"qp": qp_file["path"], "ms": ms_file["path"]}
                await L("QP/MS filenames differ; pairing uploaded PDFs by order.", "info")
            else:
                for fi in files_info:
                    base = get_base_name(fi["name"])
                    pairs.setdefault(base, {})
                    if is_marking_scheme_file(fi["name"]):
                        pairs[base]["ms"] = fi["path"]
                    else:
                        pairs[base]["qp"] = fi["path"]

            found = False
            for base_name, paths in pairs.items():
                if "qp" not in paths:
                    continue
                qp_doc = fitz.open(paths["qp"])
                ms_doc = fitz.open(paths["ms"]) if "ms" in paths else None
                await L("   \u21b3 [PHASE 1] Scouting document profile...", "info")
                doc_profile = await scout_document_profile(job_id, qp_doc, ms_doc)
                qp_doc.close()
                if ms_doc:
                    ms_doc.close()
                
                state.update({
                    "qp_doc_path": paths["qp"], 
                    "ms_doc_path": paths.get("ms"), 
                    "ms_available": "ms" in paths,
                    "qp_file_name": os.path.basename(paths["qp"]),
                    "ms_file_name": os.path.basename(paths.get("ms")) if paths.get("ms") else "",
                    "base_name": base_name, 
                    "doc_profile": doc_profile.model_dump()
                })
                found = True
                break

            if not found:
                await L("No QP document found. Halting.", "error")
                await L("ALL_DONE", "system_control")
                return
            await _save_state(rc, job_id, state)

        base_name   = state["base_name"]
        doc_profile = DocumentProfile(**state["doc_profile"])
        target_lang = state.get("confirmed_language") or state.get("target_language") or getattr(doc_profile, "primary_language", "regional") or "regional"

        doc_images_dir  = os.path.join(job_folder, "images", base_name)
        ui_pages_dir    = os.path.join(job_folder, "ui_pages", base_name)
        ms_ui_pages_dir = os.path.join(job_folder, "ms_ui_pages", base_name)
        
        for d in (doc_images_dir, ui_pages_dir, ms_ui_pages_dir):
            os.makedirs(d, exist_ok=True)

        raw_code = str(getattr(doc_profile, "qp_subject_or_code", ""))
        m = re.search(r"\b(\d{3})\b", raw_code)
        sub_code = m.group(1) if m else re.sub(r"[^a-zA-Z0-9]", "", raw_code)[:3]

        qp_doc = fitz.open(state["qp_doc_path"])
        ms_doc = fitz.open(state["ms_doc_path"]) if state.get("ms_doc_path") else None
        
        bounds = _detect_bounds(qp_doc)
        state["set_boundaries"] = bounds
        instruction_type_rules = extract_instruction_type_rules(qp_doc)
        if instruction_type_rules:
            state["instruction_type_rules"] = instruction_type_rules
            await L(f"   -> QP instruction type rules detected: {len(instruction_type_rules)} range(s).", "info")
        
        qp_page_list = _qp_pages(bounds, target_set, len(qp_doc))
        ms_page_list = _ms_pages(ms_doc, target_set) if ms_doc else []

        await L(f"   Boundary lock: SET {target_set} â€” {len(qp_page_list)} QP page(s), {len(ms_page_list)} MS page(s)", "system_control")
        await L("", "page_map_init", {"total": len(qp_page_list)})
        
        ms_answers = {}
        if ms_doc:
            ms_answers = await _extract_ms_answers(
                job_id, ms_doc, doc_images_dir, ms_ui_pages_dir, base_name,
                target_set, sub_code, ms_page_list, AnswerKeyPage, get_next_key, rc, _api_semaphore
            )
        else:
            await L("   \u21b3 No MS uploaded. Continuing with QP-only extraction; answer fields can be reviewed manually.", "warning")

        ms_urls = [f"/workspace/{job_id}/ms_ui_pages/{base_name}/ms_page_{pn + 1}.png" for pn in ms_page_list]
        def _ms_url(abs_idx):
            if not ms_urls:
                return ""
            return ms_urls[min(int(abs_idx / max(len(qp_page_list), 1) * len(ms_urls)), len(ms_urls) - 1)]

        BATCH = 3
        doc_meta = state.get("doc_meta", {})

        for batch_start in range(0, len(qp_page_list), BATCH):
            state = await _get_state(rc, job_id) or state
            if state.get("cancel_requested"):
                await L("ENGINE HALTED BY USER.", "system_control")
                if ms_doc:
                    ms_doc.close()
                qp_doc.close()
                return

            batch = qp_page_list[batch_start : batch_start + BATCH]
            tasks = []
            for page_idx in batch:
                page = qp_doc[page_idx]
                ui_path = os.path.join(ui_pages_dir, f"page_{page_idx + 1}.png")
                try:
                    page.get_pixmap(matrix=fitz.Matrix(4, 4)).save(ui_path, "jpeg", 85)
                except Exception:
                    pass
                tasks.append(asyncio.create_task(_extract_page_flash(job_id, page, page_idx + 1, doc_profile, target_lang, PageExtractionResult, get_next_key, rc, _api_semaphore)))

            await L(f"   \u21b3 [SET {target_set}] Batch pages {batch[0]+1}\u2013{batch[-1]+1}...", "info")
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for rel, page_res in enumerate(results):
                page_idx = batch[rel]
                abs_idx = batch_start + rel
                page_url = f"/workspace/{job_id}/ui_pages/{base_name}/page_{page_idx + 1}.png"
                ms_url = _ms_url(abs_idx)

                pct = int(20 + (abs_idx + 1) / max(len(qp_page_list), 1) * 80)
                await L(str(pct), "progress")
                await L("", "page_map_update", {"page": abs_idx + 1, "status": "scanning"})

                if isinstance(page_res, Exception) or not page_res:
                    await L("", "page_map_update", {"page": abs_idx + 1, "status": "bypassed"})
                    continue

                for src, dst in [("language_detected", "language"), ("subject_name", "subject"), ("class_grade", "class"), ("subject_code", "code")]:
                    if page_res.get(src) and not doc_meta.get(dst):
                        doc_meta[dst] = page_res.get(src)
                        
                if not doc_meta.get("code"):
                    doc_meta["code"] = sub_code

                questions = [q for q in page_res.get("questions", []) if q.get("is_actual_test_question")]
                if not questions:
                    await L("", "page_map_update", {"page": abs_idx + 1, "status": "bypassed"})
                    continue

                ui_path = os.path.join(ui_pages_dir, f"page_{page_idx + 1}.png")
                qno_repairs = _repair_page_question_numbers(questions, page_res)
                if qno_repairs:
                    repaired_preview = ", ".join(f"{old or '?'}->{new}" for old, new in qno_repairs[:6])
                    if len(qno_repairs) > 6:
                        repaired_preview += ", ..."
                    await L(
                        f"   Question number order repaired on page {page_idx + 1}: {repaired_preview}",
                        "warning"
                    )

                for q in questions:
                    q["set_name"] = target_set
                    
                crop_map = await asyncio.to_thread(_crop_sync, ui_path, questions, doc_images_dir, sub_code, normalize_qno)

                state.setdefault("parsed_data", [])
                state.setdefault("stats", {"parsed": 0, "diagrams": 0, "duplicates": 0, "trash": 0})

                for q in questions:
                    norm = normalize_qno(str(q.get("q_sno", "")))
                    key  = f"{target_set}_{norm}"
                    row  = _build_row(
                        q, target_set, page_idx + 1, page_url, ms_url, base_name,
                        doc_meta, crop_map.get(key, {}), strip_bullets, format_mode,
                        instruction_type_rules
                    )
                    row = _apply_ms_to_row(row, ms_answers.get(key, {}))
                    display_qno, original_qno = unique_workspace_qno(state.get("parsed_data", []), target_set, row.get("Sl.No"))
                    row["Sl.No"] = display_qno
                    row["Repeat Question Id (Optional)"] = original_qno

                    state["parsed_data"].append(row)
                    state["stats"]["parsed"] = len(state["parsed_data"])
                    if crop_map.get(key, {}).get("main"):
                        state["stats"]["diagrams"] += 1

                    ts = datetime.now().strftime("%H:%M:%S")
                    await L(f"[{ts}] \u2713 Q{row['Sl.No']} | Conf: {row['Extraction_Confidence']}", "success")

                state["doc_meta"] = doc_meta
                await L("", "page_map_update", {"page": abs_idx + 1, "status": "done"})
                await L("", "stats", state["stats"])
                await _save_state(rc, job_id, state)

        # â”€â”€ Cross-Page Stitching v2 (Full Field Merge) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        state = await _get_state(rc, job_id) or state
        if "parsed_data" in state:
            before_count = len(state["parsed_data"])
            state["parsed_data"] = _stitch_continuations(state["parsed_data"])
            state["parsed_data"] = enforce_unique_workspace_qnos(state["parsed_data"])
            after_count = len(state["parsed_data"])
            merged = before_count - after_count
            if merged > 0:
                await L(f"   âœ‚ï¸ Stitcher merged {merged} continuation fragment(s).", "success")
            state["stats"]["parsed"] = after_count
            await _save_state(rc, job_id, state)

        if ms_doc:
            target_rows = [
                row for row in state.get("parsed_data", [])
                if str(row.get("SET Name", "")).strip().upper() == str(target_set).strip().upper()
            ]
            await L(
                f"MS answers mapped: {len(ms_answers)} / {len(target_rows)} expected QP question(s).",
                "info"
            )

        if ms_doc:
            ms_doc.close()
        qp_doc.close()

        # â”€â”€ Signal completion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        state = await _get_state(rc, job_id) or state
        state.setdefault("completed_sets", [])
        if target_set not in state["completed_sets"]:
            state["completed_sets"].append(target_set)

        target_ext = state.get("target_extraction", "ALL")
        bds = state.get("set_boundaries", {"A": 0, "B": -1, "C": -1})
        
        if target_ext != "ALL":
            state["status"] = "completed"
            await _save_state(rc, job_id, state)
            await L("ALL_DONE", "system_control")
        elif target_set == "A" and bds["B"] == -1:
            state["completed_sets"] = ["A", "B", "C"]
            state["status"] = "completed"
            await _save_state(rc, job_id, state)
            await L("ALL_DONE", "system_control")
        elif target_set == "B" and bds["C"] == -1:
            if "C" not in state["completed_sets"]:
                state["completed_sets"].append("C")
            state["status"] = "completed"
            await _save_state(rc, job_id, state)
            await L("ALL_DONE", "system_control")
        else:
            state["status"] = "waiting_for_next_set"
            await _save_state(rc, job_id, state)
            await L("100", "progress")
            await L("SET_COMPLETE", "system_control")

    except Exception as exc:
        err = str(exc).lower()
        msg = "Server traffic limit reached â€” wait and retry." if any(x in err for x in ("429", "quota", "rate", "503")) else f"Engine error: {str(exc)[:120]}"
        await L(msg, "error")
        state = await _get_state(rc, job_id) or {}
        state["status"] = "halted"
        await _save_state(rc, job_id, state)
        await L("ALL_DONE", "system_control")
