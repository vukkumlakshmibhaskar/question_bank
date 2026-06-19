"""
scan_endpoint.py
=========================
Drop-in replacement for scan_endpoint.py.

Key additions vs the original:
  • register_scan() now accepts an optional `is_language_parser` flag on the
    /scan-tab/{job_id} request body.
  • When is_language_parser=True the scan runs in TWO PHASES:
      Phase A – script / quality check (Pro, increased timeout for cold starts)
      Phase B – MS answer resolution (Flash)
        ∘ For every MCQ row: loads the nearest MS page image, asks Flash which
          option (A/B/C/D) is correct and patches Option{N} Is Correct? fields. 
          Handles Urdu RTL empty bracket formatting.
        ∘ For every descriptive row: extracts the full answer text from the MS
          page and writes it to Option1 (Mandatory).
  • Standard parser scan is unchanged (Flash, quality-only).
"""

import os
import re
import json
import uuid
import asyncio
from pathlib import Path
from typing import Optional, List, Any
from fastapi import Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from PIL import Image
import io


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────

class ScanRequest(BaseModel):
    rows: list
    subject_name: str = ""
    job_id: str = ""           
    is_language_scan: bool = False 
    scan_mode: str = "ALL"     # 'QP' | 'MS' | 'ALL' — optional hint from frontend


class ScanResult(BaseModel):
    row_id: str
    q_sno: str
    flagged: bool = False
    reason: str = ""
    fixes: dict = {}
    confidence: int = 75


class ScanReport(BaseModel):
    passed: int = 0
    fixed: int = 0
    flagged: int = 0
    results: list = []
    rows: List[Any] = []
    ms_resolved: int = 0


# ─────────────────────────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────────────────────────

MODEL_FLASH = "gemini-2.5-flash"
MODEL_PRO   = "gemini-2.5-pro"
SCAN_AI_CONCURRENCY = max(1, int(os.getenv("SCAN_AI_CONCURRENCY", "2")))
SCAN_AI_SEMAPHORE = asyncio.Semaphore(SCAN_AI_CONCURRENCY)


async def _run_ai_call(call_fn, timeout: float):
    async with SCAN_AI_SEMAPHORE:
        return await asyncio.wait_for(asyncio.to_thread(call_fn), timeout=timeout)

# Batch sizes
FLASH_BATCH = 5   # questions per API call during standard scan
PRO_BATCH   = 3   # smaller – Pro is slower and more expensive

# Scripts where we always need Pro even in Phase A
HARD_SCRIPTS = {"telugu", "odia", "malayalam", "gurmukhi"}


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_image(path: str) -> Optional[Image.Image]:
    try:
        return Image.open(path).convert("RGB")
    except Exception:
        return None


def _ms_page_path(job_id: str, row: dict) -> Optional[str]:
    """
    Resolve the filesystem path of the MS page image for a given row.
    Falls back gracefully if no URL is stored.
    """
    if not job_id:
        return None

    ms_url = row.get("MS_Page_Image_URL", "") or ""
    if not ms_url:
        return None

    # MS_Page_Image_URL looks like /workspace/<job_id>/ms_ui_pages/<base>/ms_page_N.png
    # Strip the leading slash and resolve relative to cwd.
    rel = ms_url.lstrip("/")
    full = os.path.join(os.getcwd(), rel)
    if os.path.exists(full):
        return full

    # Fallback: try every ms_page_*.png in the job's ms_ui_pages directory,
    # sorted, and return the first one that exists.
    ms_root = os.path.join("workspace", job_id, "ms_ui_pages")
    if os.path.isdir(ms_root):
        pages = sorted(Path(ms_root).rglob("ms_page_*.png"))
        if pages:
            return str(pages[0])

    return None


def _qp_page_path(job_id: str, row: dict) -> Optional[str]:
    """Resolve QP page image path for Phase A script checks."""
    if not job_id:
        return None
    url = row.get("Page_Image_URL", "") or ""
    if not url:
        return None
    rel = url.lstrip("/")
    full = os.path.join(os.getcwd(), rel)
    return full if os.path.exists(full) else None


def _is_mcq(row: dict) -> bool:
    try:
        n = int(row.get("No. of Options/Blanks (Mandatory)") or 0)
        return n > 0
    except Exception:
        return False


def _detect_script(subject_name: str) -> str:
    """Return a simplified script identifier from the subject name."""
    s = subject_name.lower()
    if "telugu" in s:   return "telugu"
    if "odia" in s or "odiya" in s: return "odia"
    if "malayalam" in s: return "malayalam"
    if "punjabi" in s:  return "gurmukhi"
    if "tamil" in s:    return "tamil"
    if "arabic" in s or "urdu" in s or "persian" in s or "sindhi" in s:
        return "arabic"
    if any(x in s for x in ["hindi", "sanskrit", "marathi", "nepali"]):
        return "devanagari"
    if "bengali" in s or "assamese" in s: return "bengali"
    if "kannada" in s:  return "kannada"
    if "gujarati" in s: return "gujarati"
    return "latin"


# ─────────────────────────────────────────────────────────────────────────────
# Phase A – Script / Quality check  (No MCQ checks, strictly text quality)
# ─────────────────────────────────────────────────────────────────────────────

async def _phase_a_scan_batch(
    batch: list,
    page_image: Optional[Image.Image],
    script: str,
    get_next_key,
) -> list[ScanResult]:
    """
    Check script correctness and truncation for a batch of rows.
    Returns one ScanResult per row.
    """
    from google import genai
    from google.genai import types

    results = []

    for row in batch:
        row_id  = str(row.get("id", ""))
        q_sno   = str(row.get("Sl.No", "?"))
        q_text  = str(row.get("Question text(Mandatory)", "") or "")
        opts    = [str(row.get(f"Option{n} (Mandatory)", "") or "") for n in range(1, 7)]
        is_mcq  = _is_mcq(row)

        # Fast-path: skip obviously empty rows
        if not q_text.strip():
            results.append(ScanResult(
                row_id=row_id, q_sno=q_sno,
                flagged=True, reason="Missing question text", confidence=20
            ))
            continue

        prompt = f"""You are an elite quality auditor and OCR corrector for exam data.

Script expected: {script}
Question Q{q_sno}: {q_text}
Options: A) {opts[0]}  B) {opts[1]}  C) {opts[2]}  D) {opts[3]}  E) {opts[4]}  F) {opts[5]}
Is MCQ: {is_mcq}

Check ALL of the following and respond ONLY with a JSON object:
{{
  "flagged": bool,
  "reason": "short explanation if flagged, else empty string",
  "fixes": {{
    "Question text(Mandatory)": "corrected text or omit key if no change",
    "Option1 (Mandatory)": "corrected or omit",
    "Option2 (Mandatory)": "corrected or omit",
    "Option3 (Mandatory)": "corrected or omit",
    "Option4 (Mandatory)": "corrected or omit",
    "Option5 (Mandatory)": "corrected or omit",
    "Option6 (Mandatory)": "corrected or omit"
  }},
  "confidence": "0-100"
}}

CRITICAL RULES FOR REVIEW:
1. AGGRESSIVE REWRITE (SCRIPT & UNICODE ERRORS): The provided text was extracted by a fast, lower-quality OCR and may contain severe Unicode errors, gibberish, or Latin transliterations instead of {script}.
   Compare the provided text to the image. If the text does NOT perfectly match the image, YOU MUST COMPLETELY REWRITE the question and options in the correct {script} Unicode and place them in the `fixes` object.
   DO NOT flag the question as "unreadable" if the image is clear. Your job is to fix the bad OCR by replacing it entirely.
2. MISSING OPTIONS: If the OCR missed the options but they are visible in the image, transcribe them and put them in the `fixes` object.
3. TRUNCATION / ILLEGIBLE: ONLY set `flagged=true` if the physical image itself is cut off, heavily blurred, or completely impossible for a human to read.
4. If you rewrite or fix the text, set `flagged=false` and `reason=""`.

Respond ONLY with the JSON object. No explanation outside JSON"""
        contents: list = []
        if page_image:
            contents.append(page_image)
        contents.append(prompt)

        for attempt in range(3):
            try:
                client = genai.Client(api_key=get_next_key())
                def _call():
                    return client.models.generate_content(
                        model=MODEL_PRO,
                        contents=contents,
                        config=types.GenerateContentConfig(temperature=0.0)
                    )
                # Increased timeout to 120s to prevent cold-start hanging
                res = await _run_ai_call(_call, timeout=120.0)
                raw = (res.text or "").strip()
                # Strip markdown fences if present
                raw = re.sub(r"^```json\s*|```$", "", raw, flags=re.MULTILINE).strip()
                parsed = json.loads(raw)
                fixes = {k: v for k, v in parsed.get("fixes", {}).items() if v}
                results.append(ScanResult(
                    row_id=row_id,
                    q_sno=q_sno,
                    flagged=bool(parsed.get("flagged", False)),
                    reason=str(parsed.get("reason", "")),
                    fixes=fixes,
                    confidence=int(parsed.get("confidence", 75)),
                ))
                break
            except asyncio.TimeoutError:
                await asyncio.sleep(5)
                continue
            except Exception as e:
                err = str(e).lower()
                if "429" in err or "quota" in err:
                    await asyncio.sleep(15)
                elif "503" in err:
                    await asyncio.sleep(10)
                else:
                    results.append(ScanResult(
                        row_id=row_id, q_sno=q_sno,
                        flagged=True, reason=f"Scan error: {str(e)[:60]}", confidence=40
                    ))
                    break
        else:
            results.append(ScanResult(
                row_id=row_id, q_sno=q_sno,
                flagged=True, reason="Scan timed out after 3 attempts", confidence=30
            ))

    return results


# ─────────────────────────────────────────────────────────────────────────────
# Phase B – MS Answer Resolution  (Using Flash, handling RTL Formatting)
# ─────────────────────────────────────────────────────────────────────────────

async def _phase_b_resolve_answers(
    rows: list,
    job_id: str,
    script: str,
    get_next_key,
    _log,
) -> dict:
    """
    For each row, load the MS page image and ask Flash to:
      - MCQ → identify correct option letter (A/B/C/D)
      - Descriptive → extract the model answer text
    """
    from google import genai
    from google.genai import types

    resolutions = {}

    # Group rows by MS page URL to avoid reloading the same image repeatedly
    page_groups: dict[str, list] = {}
    for row in rows:
        ms_url = row.get("MS_Page_Image_URL", "") or "UNKNOWN"
        page_groups.setdefault(ms_url, []).append(row)

    for ms_url, group in page_groups.items():
        # Try to find the MS page image on disk
        ms_img_path = _ms_page_path(job_id, group[0])
        ms_image: Optional[Image.Image] = None
        if ms_img_path:
            ms_image = await asyncio.to_thread(_load_image, ms_img_path)

        if not ms_image:
            await _log(f"   ⚠️  MS page image not found for {len(group)} question(s) — skipping Phase B for this group")
            for row in group:
                resolutions[str(row.get("id", ""))] = {"ms_resolved": False}
            continue

        # Process in small batches
        for i in range(0, len(group), PRO_BATCH):
            batch = group[i : i + PRO_BATCH]

            # Build a combined prompt for the batch
            q_blocks = []
            for row in batch:
                q_sno  = str(row.get("Sl.No", "?"))
                q_text = str(row.get("Question text(Mandatory)", "") or "")
                is_mcq = _is_mcq(row)
                opts   = {
                    "A": str(row.get("Option1 (Mandatory)", "") or ""),
                    "B": str(row.get("Option2 (Mandatory)", "") or ""),
                    "C": str(row.get("Option3 (Mandatory)", "") or ""),
                    "D": str(row.get("Option4 (Mandatory)", "") or ""),
                }
                row_id = str(row.get("id", ""))
                q_blocks.append({
                    "row_id": row_id,
                    "q_sno": q_sno,
                    "is_mcq": is_mcq,
                    "question": q_text[:400],   # truncate for prompt safety
                    "options": opts if is_mcq else {},
                })

            prompt = f"""You are reading an exam MARKING SCHEME (answer key) page image.
Script of this paper: {script}

For each question below, find its answer in the marking scheme image and respond with JSON.

Questions:
{json.dumps(q_blocks, ensure_ascii=False, indent=2)}

Respond ONLY with a JSON array — one object per question in the same order:
[
  {{
    "row_id": "<same row_id>",
    "q_sno": "<same q_sno>",
    "is_mcq": true|false,
    "correct_option": "A"|"B"|"C"|"D"|"",
    "answer_text": "full answer text",
    "found": true|false,
    "confidence": 0-100
  }}
]

Rules:
1. Extract the question number EXACTLY as printed. If the question has an "OR" / "یا" alternative, look carefully for the second answer block.
2. AGGRESSIVE MCQ RULE: If the Marking Scheme shows ANY English letter (A, B, C, D) next to the answer text (even if formatted strangely like `() B`, `15 )A(`, or `A ()`), IT IS AN MCQ. You MUST extract that letter into `correct_option`.
3. Do NOT mark a question as descriptive if there is an A, B, C, or D visible next to it.
4. If it truly is descriptive, copy the answer text VERBATIM from the MS page.
5. Preserve all Roman numerals (i, ii, iii)."""

            for attempt in range(3):
                try:
                    client = genai.Client(api_key=get_next_key())
                    def _call(img=ms_image, p=prompt):
                        return client.models.generate_content(
                            model=MODEL_FLASH,
                            contents=[img, p],
                            config=types.GenerateContentConfig(
                                temperature=0.0,
                                response_mime_type="application/json" # Prevents the Expecting ',' delimiter crash
                            )
                        )
                    res = await _run_ai_call(_call, timeout=120.0)
                    raw = (res.text or "").strip()
                    raw = re.sub(r"^```json\s*|```$", "", raw, flags=re.MULTILINE).strip()
                    parsed_list: list = json.loads(raw)

                    for item in parsed_list:
                        rid = str(item.get("row_id", ""))
                        resolutions[rid] = {
                            "correct_option": str(item.get("correct_option", "")).upper().strip(),
                            "answer_text": str(item.get("answer_text", "") or ""),
                            "found": bool(item.get("found", False)),
                            "confidence": int(item.get("confidence", 50)),
                            "ms_resolved": True,
                        }
                        opt = resolutions[rid]["correct_option"]
                        found = resolutions[rid]["found"]
                        await _log(f"   ✅ Q{item.get('q_sno','?')} MS resolved → "
                                   f"{'option ' + opt if opt else 'descriptive answer'} "
                                   f"({'found' if found else 'not found on page'})")
                    break

                except asyncio.TimeoutError:
                    await asyncio.sleep(5)
                    continue
                except Exception as e:
                    err = str(e).lower()
                    if "429" in err or "quota" in err:
                        await asyncio.sleep(15)
                    elif "503" in err:
                        await asyncio.sleep(10)
                    else:
                        await _log(f"   ❌ Phase B batch error: {str(e)[:80]}")
                        for row in batch:
                            resolutions[str(row.get("id", ""))] = {"ms_resolved": False}
                        break
            else:
                for row in batch:
                    resolutions[str(row.get("id", ""))] = {"ms_resolved": False}

            # Small delay between batches
            if i + PRO_BATCH < len(group):
                await asyncio.sleep(1.0)

    return resolutions


# ─────────────────────────────────────────────────────────────────────────────
# Apply Phase B resolutions back onto rows
# ─────────────────────────────────────────────────────────────────────────────

def _apply_ms_resolutions(rows: list, resolutions: dict) -> tuple[list, int]:
    """
    Patches Option{N} Is Correct? fields (MCQ) or Option1 (Mandatory) (descriptive)
    using Phase B resolution data.
    Returns (updated_rows, count_of_rows_changed).
    """
    changed = 0
    updated = []
    for row in rows:
        rid = str(row.get("id", ""))
        res = resolutions.get(rid)
        if not res or not res.get("ms_resolved") or not res.get("found"):
            updated.append(row)
            continue

        new_row = dict(row)
        is_mcq  = _is_mcq(row)

        if is_mcq:
            opt_letter = res.get("correct_option", "")
            if opt_letter in ("A", "B", "C", "D"):
                idx_map = {"A": 1, "B": 2, "C": 3, "D": 4}
                correct_idx = idx_map[opt_letter]
                for n in range(1, 5):
                    new_row[f"Option{n} Is Correct?"] = "Yes" if n == correct_idx else "No"
                new_row["Extraction_Confidence"] = str(min(int(row.get("Extraction_Confidence") or 75) + 15, 95))
                changed += 1
        else:
            answer = res.get("answer_text", "")
            if answer.strip():
                new_row["Option1 (Mandatory)"] = answer
                new_row["Option1 Is Correct?"] = "Yes"
                # Only zero out if it was an MCQ (has options count > 0)
                # Preserve the blanks count for fill-in-the-blank type questions
                if int(row.get("No. of Options/Blanks (Mandatory)") or 0) > 0:
                    new_row["No. of Options/Blanks (Mandatory)"] = "0"
                new_row["Extraction_Confidence"] = str(min(int(row.get("Extraction_Confidence") or 75) + 15, 95))
                changed += 1

        updated.append(new_row)
    return updated, changed


# ─────────────────────────────────────────────────────────────────────────────
# Standard (Flash) scan – unchanged from original, refactored here for clarity
# ─────────────────────────────────────────────────────────────────────────────

async def _standard_flash_scan(rows, subject_name, scan_id, redis_client, get_next_key):
    """
    Original Flash-based quality scan used by the Standard Parser.
    Groups rows by QP page, calls Flash per batch, applies fixes.
    """
    from google import genai
    from google.genai import types

    report = ScanReport()

    async def _log(text: str):
        if redis_client:
            await redis_client.publish(
                f"scan:{scan_id}",
                json.dumps({"type": "log", "text": text})
            )

    # Group by QP page
    page_groups: dict[str, list] = {}
    for row in rows:
        pg = row.get("Page_Image_URL", "") or "NO_PAGE"
        page_groups.setdefault(pg, []).append(row)

    all_results: list[ScanResult] = []
    processed = 0

    for pg_url, pg_rows in page_groups.items():
        # Load QP page image
        qp_img = None
        rel = pg_url.lstrip("/")
        full = os.path.join(os.getcwd(), rel)
        if os.path.exists(full):
            qp_img = await asyncio.to_thread(_load_image, full)

        for i in range(0, len(pg_rows), FLASH_BATCH):
            batch = pg_rows[i : i + FLASH_BATCH]

            # Build a simple quality prompt for Flash
            q_entries = []
            for row in batch:
                q_entries.append({
                    "id": str(row.get("id", "")),
                    "q_sno": str(row.get("Sl.No", "?")),
                    "question_text": str(row.get("Question text(Mandatory)", "") or "")[:300],
                    "options": [str(row.get(f"Option{n} (Mandatory)", "") or "") for n in range(1, 5)],
                    "is_mcq": _is_mcq(row),
                })

            prompt = f"""Quality check for exam questions. Subject: {subject_name}

Questions:
{json.dumps(q_entries, ensure_ascii=False)}

For each question return a JSON array with one object per question:
[{{
  "row_id": "<id>",
  "q_sno": "<q_sno>",
  "flagged": bool,
  "reason": "short reason or empty",
  "fixes": {{}},
  "confidence": 0-100
}}]

Checks: (1) missing question text (2) obvious truncation.
Auto-fix only if >90% confident. No hallucination. JSON array only."""

            contents: list = []
            if qp_img:
                contents.append(qp_img)
            contents.append(prompt)

            for attempt in range(3):
                try:
                    client = genai.Client(api_key=get_next_key())
                    def _call():
                        return client.models.generate_content(
                            model=MODEL_FLASH,
                            contents=contents,
                            config=types.GenerateContentConfig(temperature=0.0)
                        )
                    res = await _run_ai_call(_call, timeout=60.0)
                    raw = (res.text or "").strip()
                    raw = re.sub(r"^```json\s*|```$", "", raw, flags=re.MULTILINE).strip()
                    items: list = json.loads(raw)
                    for item in items:
                        fixes = {k: v for k, v in item.get("fixes", {}).items() if v}
                        sr = ScanResult(
                            row_id=str(item.get("row_id", "")),
                            q_sno=str(item.get("q_sno", "?")),
                            flagged=bool(item.get("flagged", False)),
                            reason=str(item.get("reason", "")),
                            fixes=fixes,
                            confidence=int(item.get("confidence", 75)),
                        )
                        all_results.append(sr)
                        processed += 1
                        if sr.fixes and not sr.flagged:
                            report.fixed += 1
                            await _log(f"  ✅ Q{sr.q_sno} → auto-fixed: {', '.join(sr.fixes.keys())}")
                        elif sr.flagged:
                            report.flagged += 1
                            await _log(f"  ⚠️  Q{sr.q_sno} → flagged: {sr.reason[:60]}")
                        else:
                            report.passed += 1
                    break
                except Exception as e:
                    err = str(e).lower()
                    if "429" in err or "quota" in err:
                        await asyncio.sleep(15)
                    else:
                        await asyncio.sleep(3)
                    if attempt == 2:
                        for row in batch:
                            all_results.append(ScanResult(
                                row_id=str(row.get("id", "")),
                                q_sno=str(row.get("Sl.No", "?")),
                                flagged=True,
                                reason="Flash scan failed after 3 attempts",
                                confidence=40,
                            ))
                            report.flagged += 1
                            processed += 1

            pct = int(processed / len(rows) * 100)
            await _log(f"  📊 Progress: {processed}/{len(rows)} ({pct}%)")
            if i + FLASH_BATCH < len(pg_rows):
                await asyncio.sleep(0.5)

    report.results = all_results
    return report


# ─────────────────────────────────────────────────────────────────────────────
# Main language scan orchestrator
# ─────────────────────────────────────────────────────────────────────────────

async def _language_pro_scan(rows, subject_name, job_id, scan_id, redis_client, get_next_key):
    """
    Two-phase Pro scan for the Language Parser.
    Phase A: script correctness + quality (Pro, with QP page images)
    Phase B: MS answer resolution (Flash, with MS page images)
    """
    report = ScanReport()
    script = _detect_script(subject_name)

    async def _log(text: str):
        if redis_client:
            await redis_client.publish(
                f"scan:{scan_id}",
                json.dumps({"type": "log", "text": text})
            )

    await _log(f"🔍 Language scan started — {len(rows)} questions | Script: {script}")
    await _log("━━━ PHASE A: Script & Quality Check ━━━")

    # ── Phase A ──────────────────────────────────────────────────────────────
    # Group by QP page so we only load each page image once
    page_groups: dict[str, list] = {}
    for row in rows:
        pg = row.get("Page_Image_URL", "") or "NO_PAGE"
        page_groups.setdefault(pg, []).append(row)

    phase_a_results: list[ScanResult] = []
    processed = 0

    for pg_url, pg_rows in page_groups.items():
        qp_img = None
        rel = pg_url.lstrip("/")
        full = os.path.join(os.getcwd(), rel)
        if os.path.exists(full):
            qp_img = await asyncio.to_thread(_load_image, full)

        for i in range(0, len(pg_rows), PRO_BATCH):
            batch = pg_rows[i : i + PRO_BATCH]
            batch_results = await _phase_a_scan_batch(batch, qp_img, script, get_next_key)
            phase_a_results.extend(batch_results)
            processed += len(batch)

            for sr in batch_results:
                if sr.fixes and not sr.flagged:
                    report.fixed += 1
                    await _log(f"  ✅ Q{sr.q_sno} → script auto-corrected: {', '.join(sr.fixes.keys())}")
                elif sr.flagged:
                    report.flagged += 1
                    await _log(f"  ⚠️  Q{sr.q_sno} → {sr.reason[:80]}")
                else:
                    report.passed += 1

            pct = int(processed / len(rows) * 100)
            await _log(f"  📊 Phase A progress: {processed}/{len(rows)} ({pct}%)")
            if i + PRO_BATCH < len(pg_rows):
                await asyncio.sleep(1.0)

    # Apply Phase A fixes into rows before Phase B
    fix_map = {r.row_id: r for r in phase_a_results}
    patched_rows = []
    for row in rows:
        rid = str(row.get("id", ""))
        res = fix_map.get(rid)
        if res and res.fixes and not res.flagged:
            new_row = dict(row)
            new_row.update(res.fixes)
            patched_rows.append(new_row)
        else:
            patched_rows.append(row)

    # ── Phase B ──────────────────────────────────────────────────────────────
    await _log("━━━ PHASE B: MS Answer Resolution ━━━")

    resolutions = await _phase_b_resolve_answers(
        patched_rows, job_id, script, get_next_key, _log
    )

    final_rows, ms_resolved_count = _apply_ms_resolutions(patched_rows, resolutions)

    await _log(f"  📊 MS answers resolved: {ms_resolved_count}/{len(rows)}")

    # Merge Phase B resolution into ScanResults so the UI can show them
    for row in final_rows:
        rid = str(row.get("id", ""))
        res = fix_map.get(rid)
        if not res:
            # Row was clean in Phase A but may have been patched in Phase B
            mr = resolutions.get(rid, {})
            if mr.get("ms_resolved") and mr.get("found"):
                phase_a_results.append(ScanResult(
                    row_id=rid,
                    q_sno=str(row.get("Sl.No", "?")),
                    flagged=False,
                    reason="",
                    fixes={"ms_answer_resolved": "true"},
                    confidence=min(int(row.get("Extraction_Confidence") or 75) + 15, 95),
                ))

    report.results  = phase_a_results
    report.rows     = final_rows          # caller will use these to update matrices
    return report


# ─────────────────────────────────────────────────────────────────────────────
# register_scan – called from the server's main file
# ─────────────────────────────────────────────────────────────────────────────

def register_scan(app, get_next_key_fn, redis_client_ref):
    """
    Registers two endpoints on `app`:
      POST /scan-tab/{job_id}   → starts a scan, returns {scan_id}
      GET  /scan-status/{scan_id} → SSE stream of log messages + final result
    """
    from fastapi import BackgroundTasks

    # In-memory store for active scans (scan_id → asyncio.Queue)
    _scan_queues: dict[str, asyncio.Queue] = {}

    async def _run_scan(scan_id: str, req: ScanRequest, job_id: str):
        """Background task that runs the scan and publishes results via Redis pubsub."""

        # Use a local redis reference (may be None in offline mode)
        rc = redis_client_ref

        async def _publish(payload: dict):
            msg = json.dumps(payload, ensure_ascii=False)
            if rc:
                try:
                    await rc.publish(f"scan:{scan_id}", msg)
                except Exception:
                    pass
            q = _scan_queues.get(scan_id)
            if q:
                await q.put(msg)

        async def _log(text: str):
            await _publish({"type": "log", "text": text})

        try:
            rows = req.rows
            subject_name = req.subject_name or ""
            run_mode = (req.scan_mode or "ALL").upper()

            if req.is_language_scan and job_id:
                # Language parser variants
                script = _detect_script(subject_name)
                if run_mode == 'QP':
                    # Phase A only: run Pro script/quality checks and apply fixes
                    # Group by QP page
                    page_groups: dict[str, list] = {}
                    for row in rows:
                        pg = row.get("Page_Image_URL", "") or "NO_PAGE"
                        page_groups.setdefault(pg, []).append(row)

                    phase_a_results: list[ScanResult] = []
                    for pg_url, pg_rows in page_groups.items():
                        qp_img = None
                        rel = pg_url.lstrip("/")
                        full = os.path.join(os.getcwd(), rel)
                        if os.path.exists(full):
                            qp_img = await asyncio.to_thread(_load_image, full)

                        for i in range(0, len(pg_rows), PRO_BATCH):
                            batch = pg_rows[i : i + PRO_BATCH]
                            batch_results = await _phase_a_scan_batch(batch, qp_img, script, get_next_key_fn)
                            phase_a_results.extend(batch_results)

                    # Apply Phase A fixes into rows
                    fix_map = {r.row_id: r for r in phase_a_results}
                    updated_rows = []
                    for row in rows:
                        rid = str(row.get("id", ""))
                        res = fix_map.get(rid)
                        if res and res.fixes and not res.flagged:
                            new_row = dict(row)
                            new_row.update(res.fixes)
                            updated_rows.append(new_row)
                        else:
                            updated_rows.append(row)

                    # Build a minimal report object from phase_a_results
                    report = ScanReport()
                    report.results = phase_a_results
                    report.rows = updated_rows

                elif run_mode == 'MS':
                    # Phase B only: resolve answers on MS pages and apply
                    resolutions = await _phase_b_resolve_answers(rows, job_id, script, get_next_key_fn, _log)
                    final_rows, ms_resolved_count = _apply_ms_resolutions(rows, resolutions)
                    report = ScanReport()
                    report.results = []
                    report.rows = final_rows
                    report.ms_resolved = ms_resolved_count

                else:
                    # Full two-phase language scan
                    report = await _language_pro_scan(
                        rows, subject_name, job_id, scan_id, rc, get_next_key_fn
                    )
                updated_rows = getattr(report, "rows", rows)
            else:
                # ── Standard Parser: Flash quality scan ──
                report = await _standard_flash_scan(
                    rows, subject_name, scan_id, rc, get_next_key_fn
                )
                # Apply fixes from Flash scan back onto rows
                fix_map = {r.row_id: r for r in report.results}
                updated_rows = []
                for row in rows:
                    rid = str(row.get("id", ""))
                    res = fix_map.get(rid)
                    if res and res.fixes and not res.flagged:
                        new_row = dict(row)
                        new_row.update(res.fixes)
                        updated_rows.append(new_row)
                    else:
                        updated_rows.append(row)

            await _publish({
                "type": "scan_complete",
                "summary": {
                    "passed":  report.passed,
                    "fixed":   report.fixed,
                    "flagged": report.flagged,
                },
                "results": [
                    {
                        "row_id":     r.row_id,
                        "q_sno":      r.q_sno,
                        "flagged":    r.flagged,
                        "reason":     r.reason,
                        "fixes":      r.fixes,
                        "confidence": r.confidence,
                    }
                    for r in report.results
                ],
                "updated_rows": updated_rows,
            })

        except Exception as e:
            await _publish({
                "type": "scan_complete",
                "error": f"Scan failed: {str(e)}",
                "summary": {"passed": 0, "fixed": 0, "flagged": 0},
                "results": [],
                "updated_rows": req.rows,
            })
        finally:
            _scan_queues.pop(scan_id, None)

    

    @app.post("/scan-tab/{job_id}")
    async def start_scan(job_id: str, req: ScanRequest, background_tasks: BackgroundTasks):
        scan_id = str(uuid.uuid4())
        q: asyncio.Queue = asyncio.Queue()
        _scan_queues[scan_id] = q
        req_with_job = req.copy(update={})  
        background_tasks.add_task(_run_scan, scan_id, req_with_job, job_id)
        return {"scan_id": scan_id}

    @app.get("/scan-status/{scan_id}")
    async def scan_status(scan_id: str, request: Request):
        async def _generator():
            if redis_client_ref:
                pubsub = redis_client_ref.pubsub()
                await pubsub.subscribe(f"scan:{scan_id}")
                try:
                    while True:
                        if await request.is_disconnected():
                            break
                        msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                        if msg and msg["type"] == "message":
                            data = msg["data"]
                            yield f"data: {data}\n\n"
                            parsed = json.loads(data)
                            if parsed.get("type") == "scan_complete":
                                break
                finally:
                    await pubsub.unsubscribe(f"scan:{scan_id}")
                    await pubsub.close()
            else:
                q = _scan_queues.get(scan_id)
                if not q:
                    yield f"data: {json.dumps({'type':'scan_complete','error':'Scan not found','summary':{},'results':[],'updated_rows':[]})}\n\n"
                    return
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        data = await asyncio.wait_for(q.get(), timeout=2.0)
                        yield f"data: {data}\n\n"
                        parsed = json.loads(data)
                        if parsed.get("type") == "scan_complete":
                            break
                    except asyncio.TimeoutError:
                        continue

        return StreamingResponse(_generator(), media_type="text/event-stream")

    class SingleRowScanRequest(BaseModel):
        row: dict
        subject_name: str = ""
        target_field: str = "ALL"  # 👈 Added target field

    @app.post("/scan-single-row/{job_id}")
    async def scan_single_row(job_id: str, req: SingleRowScanRequest):
        """Ultra-fast endpoint to run Phase A text-correction on a targeted field."""
        try:
            row = req.row
            target = req.target_field
            script = _detect_script(req.subject_name)

            # ALL single-row AI fixes use the QP page.
            # Option text (A/B/C/D choices) is on the QP page, not the MS page.
            # The MS page only has the answer key letter — not the full option text.
            qp_img = None
            pg_url = row.get("Page_Image_URL", "")
            if pg_url:
                rel = pg_url.lstrip("/")
                full = os.path.join(os.getcwd(), rel)
                if os.path.exists(full):
                    qp_img = await asyncio.to_thread(_load_image, full)

            if not qp_img:
                return {
                    "status": "error",
                    "message": "QP page image not found on disk. Try 'Scan Text' to manually OCR this field, or re-run extraction."
                }

            from google import genai
            from google.genai import types
            import json, re

            if target != "ALL":
                # 🎯 TARGETED MODE: STRICT VERBATIM TRANSCRIPTION WITH QUESTION ANCHOR
                q_sno        = str(row.get("Sl.No", ""))
                current_text = str(row.get(target, "") or "")

                if target == "Question text(Mandatory)":
                    field_hint = f"the QUESTION TEXT of question number {q_sno}"
                elif "Option" in target and "Is Correct" not in target:
                    opt_letter = {
                        "Option1": "A", "Option2": "B", "Option3": "C",
                        "Option4": "D", "Option5": "E", "Option6": "F"
                    }.get(target.split(" ")[0], target.split(" ")[0])
                    field_hint = f"Option {opt_letter} of question number {q_sno}"
                else:
                    field_hint = f"the field '{target}' of question number {q_sno}"

                prompt = f"""You are an elite, strict OCR transcriber working on a {script}-script exam paper.

Question number on this page: {q_sno}
Target field: {field_hint}
Current extracted text (may contain OCR errors): {current_text}

STEP 1 — LOCATE: Find question number {q_sno} on this image. Do NOT read any other question.
STEP 2 — READ: Transcribe ONLY {field_hint} exactly as it appears — character by character.
STEP 3 — OUTPUT: Return ONLY the JSON below. Nothing else.

CRITICAL RULES:
1. ONLY transcribe {field_hint}. Ignore all other questions and all surrounding text on the page.
2. DO NOT include question numbers, option labels (a/b/c), marks, or instructions in your output — only the pure text content of the target field.
3. Preserve every matra, virama, anusvara, diacritic, and conjunct exactly as printed.
4. If a word is spelled strangely, keep the strange spelling. Do not correct it.
5. DO NOT summarize, translate, or add any explanation.

Respond ONLY with this JSON:
{{
  "fixes": {{
    "{target}": "transcribed text of {field_hint} only"
  }}
}}"""

                contents = [qp_img, prompt]
                client = genai.Client(api_key=get_next_key_fn())
                res = await asyncio.to_thread(
                    client.models.generate_content,
                    model=MODEL_PRO,
                    contents=contents,
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        response_mime_type="application/json"
                    )
                )
                raw = re.sub(r"^```json\s*|```$", "", (res.text or "").strip(), flags=re.MULTILINE).strip()
                parsed = json.loads(raw)
                return {"status": "success", "fixes": parsed.get("fixes", {})}

            else:
                # WHOLE ROW MODE: Fallback if target is ALL
                results = await _phase_a_scan_batch([row], qp_img, script, get_next_key_fn)
                if not results:
                    return {"status": "error", "message": "Scan failed to return results."}
                res = results[0]
                if res.flagged:
                    return {"status": "flagged", "reason": res.reason, "fixes": res.fixes}
                return {"status": "success", "fixes": res.fixes}

        except Exception as e:
            return {"status": "error", "message": str(e)}
