import os
import re
import uuid
import asyncio
import json
from datetime import datetime

import fitz
from PIL import Image

from .constants import (
    PageType, LANGUAGE_CONFIG, MODEL_FLASH, MODEL_PRO,
    PRO_REQUIRED_TYPES, FLASH_FIRST_TYPES
)
from .classifier import classify_document
from .capture import prerender_all_pages, capture_region
from .prompts import build_qp_prompt, build_ms_prompt
from .extractor import extract_page, extract_batch
from .validator import validate_extraction

def detect_language_from_profile(profile) -> str:
    """Map profile.primary_language to our internal language config key."""
    from .constants import LANGUAGE_NAME_TO_CONFIG
    lang = str(profile.primary_language).lower().strip()
    if lang in LANGUAGE_NAME_TO_CONFIG:
        return LANGUAGE_NAME_TO_CONFIG[lang]
    for key, val in LANGUAGE_NAME_TO_CONFIG.items():
        if key in lang:
            return val
    return "english"

async def bulletproof_process_set(
    job_id:       str,
    files_info:   list,
    job_folder:   str,
    active_redis_client,    
    target_set:   str = "A",
    PageExtractionResult = None,
    AnswerKeyPage = None,
    DocumentProfile = None,
    scout_document_profile = None,
    process_qp_crops_sync = None,
    get_base_name = None,
    normalize_qno = None,
    strip_bullets = None,
    format_mode = None,
    get_next_key = None,   
    ASSIGNED_API_KEY: str = "",  
):
    """
    Bulletproof replacement for process_batch_set().
    Handles all languages, all encoding types, all page structures.
    """
    
    # ==========================================
    # REDIS STATE & LOG CLOSURES
    # ==========================================
    async def get_job_state(j_id):
        if not active_redis_client: return None
        data = await active_redis_client.get(f"job:{j_id}")
        return json.loads(data) if data else None

    async def save_job_state(j_id, state):
        if active_redis_client:
            await active_redis_client.set(f"job:{j_id}", json.dumps(state))

    async def log_to_client(j_id, text, log_type="info", data=None):
        if not active_redis_client: return
        payload = {"type": log_type, "text": text}
        if data is not None: payload["data"] = data
        await active_redis_client.publish(f"logs:{j_id}", json.dumps(payload))

    try:
        job_state = await get_job_state(job_id)
        if not job_state:
            return

        await log_to_client(job_id, f"🚀 BulletProof Engine v2 — SET {target_set}", "info")
        await log_to_client(job_id, "5", "progress")

        _get_key = get_next_key if callable(get_next_key) else (lambda: ASSIGNED_API_KEY)

        job_state["parsed_data"] = []
        job_state["stats"] = {"parsed": 0, "diagrams": 0, "duplicates": 0, "trash": 0}
        await save_job_state(job_id, job_state)

        if not job_state.get("qp_doc_path") and files_info:
            pairs = {}
            for f in files_info:
                base = get_base_name(f["name"])
                if base not in pairs:
                    pairs[base] = {}
                name_lower = f["name"].lower()
                if name_lower.startswith("qp"):
                    pairs[base]["qp"] = f["path"]
                elif name_lower.startswith("ms"):
                    pairs[base]["key"] = f["path"]

            valid_pair = False
            for b_name, paths in pairs.items():
                if "qp" not in paths or "key" not in paths:
                    continue
                qp_doc = fitz.open(paths["qp"])
                ms_doc = fitz.open(paths["key"])
                doc_profile = await scout_document_profile(job_id, qp_doc, ms_doc)
                ms_doc.close()
                qp_doc.close()

                job_state.update({
                    "qp_doc_path":  paths["qp"],
                    "ms_doc_path":  paths["key"],
                    "base_name":    b_name,
                    "doc_profile":  doc_profile.model_dump(),
                })
                valid_pair = True
                break

            if not valid_pair:
                await log_to_client(job_id, "No valid QP+MS pair found.", "error")
                await log_to_client(job_id, "ALL_DONE", "system_control")
                return

            await save_job_state(job_id, job_state)

        # ── PHASE 1: Open documents ──────────────────────────────────────
        base_name   = job_state["base_name"]
        qp_doc      = fitz.open(job_state["qp_doc_path"])
        ms_doc      = fitz.open(job_state["ms_doc_path"])
        doc_profile = DocumentProfile(**job_state["doc_profile"])

        # Detect language for config lookup
        detected_lang    = detect_language_from_profile(doc_profile)
        lang_cfg         = LANGUAGE_CONFIG.get(detected_lang, LANGUAGE_CONFIG["english"])
        detected_display = doc_profile.primary_language   # human-readable e.g. "Tamil"

        await log_to_client(job_id,
            f"   ↳ AI detected: {detected_display} → Config: {detected_lang}",
            "system_control")

        # ── LANGUAGE CONFIRMATION (compare AI detection vs user's declaration) ──
        user_declared = job_state.get("target_language", "Original")

        if user_declared and user_declared.lower() not in ("original", ""):
            if user_declared.lower() == detected_display.lower():
                await log_to_client(job_id,
                    f"   ↳ ✅ Language confirmed: you said {user_declared} and AI agrees. Proceeding.",
                    "success")
                await log_to_client(job_id, "", "language_confirmed",
                    {"language": detected_display})
            else:
                await log_to_client(job_id,
                    f"   ↳ ⚠️ Mismatch: you selected '{user_declared}' but AI detected '{detected_display}'.",
                    "warning")
                await log_to_client(job_id, "", "language_mismatch", {
                    "selected": user_declared,
                    "detected": detected_display,
                })

                final_language = user_declared
                for _ in range(300):
                    await asyncio.sleep(1)
                    fresh = await get_job_state(job_id)
                    if fresh and fresh.get("language_confirmed"):
                        final_language = fresh.get("confirmed_language", user_declared)
                        break
                else:
                    await log_to_client(job_id,
                        f"   ⏰ No response in 5 minutes. Using your selection: {user_declared}",
                        "warning")

                if final_language.lower() != detected_display.lower():
                    from .constants import LANGUAGE_NAME_TO_CONFIG
                    override_key = LANGUAGE_NAME_TO_CONFIG.get(final_language.lower(), detected_lang)
                    detected_lang = override_key
                    lang_cfg      = LANGUAGE_CONFIG.get(detected_lang, LANGUAGE_CONFIG["english"])
                    await log_to_client(job_id,
                        f"   ↳ ✅ Using your selection: {final_language} → Config: {detected_lang}",
                        "success")
                else:
                    await log_to_client(job_id,
                        f"   ↳ ✅ Confirmed: {final_language} → Config: {detected_lang}",
                        "success")
        else:
            await log_to_client(job_id,
                f"   ↳ Auto-detect mode: using AI result → {detected_display}",
                "info")

        raw_code  = str(doc_profile.qp_subject_or_code)
        code_match = re.search(r'\b\d{3}\b', raw_code)
        sub_code  = code_match.group(0) if code_match else re.sub(r'[^a-zA-Z0-9]', '', raw_code)[:3]

        doc_images_dir  = os.path.join(job_folder, "images", base_name)
        ui_pages_dir    = os.path.join(job_folder, "ui_pages", base_name)
        ms_ui_pages_dir = os.path.join(job_folder, "ms_ui_pages", base_name)
        for d in [doc_images_dir, ui_pages_dir, ms_ui_pages_dir]:
            os.makedirs(d, exist_ok=True)

        # ── PHASE 2: PRE-FLIGHT DOCUMENT SCAN ───────────────────────────
        await log_to_client(job_id, "   ↳ 🔍 Pre-Analysis: Classifying all pages...", "info")

        qp_classifications, qp_summary = classify_document(qp_doc, detected_lang)
        ms_classifications, ms_summary = classify_document(ms_doc, detected_lang)

        await log_to_client(job_id,
            f"   ↳ QP Pages: {_format_summary(qp_summary)} | "
            f"MS Pages: {_format_summary(ms_summary)}",
            "system_control")

        await _warn_about_page_types(job_id, qp_summary, ms_summary, log_to_client)

        # ── PHASE 3: PRE-RENDER ALL IMAGES ──────────────────────────────
        await log_to_client(job_id, "   ↳ 🖼️ Pre-rendering all pages (this takes ~30s)...", "info")

        qp_images = prerender_all_pages(qp_doc, qp_classifications)
        ms_images_rendered = prerender_all_pages(ms_doc, ms_classifications)

        for page_num, clf in enumerate(qp_classifications):
            thumb_path = os.path.join(ui_pages_dir, f"page_{page_num+1}.png")
            page = qp_doc[page_num]
            page.get_pixmap(matrix=fitz.Matrix(4, 4)).save(thumb_path, "jpeg", 85)

        for page_num, clf in enumerate(ms_classifications):
            thumb_path = os.path.join(ms_ui_pages_dir, f"ms_page_{page_num+1}.png")
            page = ms_doc[page_num]
            page.get_pixmap(matrix=fitz.Matrix(4, 4)).save(thumb_path, "jpeg", 85)

        await log_to_client(job_id, "   ↳ ✅ All pages pre-rendered.", "success")

        # ── PHASE 4: DETERMINE PAGE RANGES ──────────────────────────────
        job_state["set_boundaries"] = _detect_set_boundaries(qp_doc)
        qp_pages_to_scan = _get_pages_for_set(job_state["set_boundaries"], target_set, len(qp_doc))
        ms_pages_to_scan = _get_ms_pages_for_set(ms_doc, target_set)

        if len(qp_pages_to_scan) == 0 and target_set in ("B", "C"):
            image_types = {"image_dominant", "scanned", "legacy_encoded", "rtl_legacy"}
            image_count = sum(1 for c in qp_classifications if c.get("type") in image_types)
            if image_count / max(len(qp_classifications), 1) > 0.5:
                await log_to_client(job_id,
                    f"   ↳ ⚠️ Text boundary detection failed (image-only QP). "
                    f"Running vision scan to find SET {target_set} start page...",
                    "warning")
                vis_boundary = await _vision_find_set_boundary(
                    job_id, qp_images, target_set, _get_key, log_to_client
                )
                if vis_boundary != -1:
                    job_state["set_boundaries"][target_set] = vis_boundary
                    qp_pages_to_scan = _get_pages_for_set(
                        job_state["set_boundaries"], target_set, len(qp_doc)
                    )
                    await log_to_client(job_id,
                        f"   ↳ ✅ Vision scan found SET {target_set} starting at page {vis_boundary + 1}. "
                        f"{len(qp_pages_to_scan)} QP pages to extract.",
                        "success")
                else:
                    await log_to_client(job_id,
                        f"   ↳ ❌ Could not find SET {target_set} in QP. "
                        f"This paper may only have Set A, or the set label is not visible on the page.",
                        "error")
            else:
                await log_to_client(job_id,
                    f"   ↳ ⚠️ SET {target_set} boundary not found — paper may be Set A only.",
                    "warning")

        await log_to_client(job_id,
            f"   ↳ QP: {len(qp_pages_to_scan)} pages | MS: {len(ms_pages_to_scan)} pages for SET {target_set}",
            "system_control")
        await save_job_state(job_id, job_state)

        # ── PHASE 5: MS READY FOR MANUAL REVIEW ─────────────────────────
        target_language = job_state.get("target_language", "Original")
        ms_page_count   = len(ms_doc)   

        await log_to_client(job_id,
            f"   ↳ 📋 MS loaded: {ms_page_count} pages ready for manual reference.",
            "info")
        await log_to_client(job_id, "10", "progress")

        # ── PHASE 6: EXTRACT QUESTION PAPER ─────────────────────────────
        await log_to_client(job_id, f"   ↳ 📝 Extracting QP SET {target_set}...", "info")
        await log_to_client(job_id, "30", "progress")
        await log_to_client(job_id, "",  "page_map_init", {"total": len(qp_pages_to_scan)})

        doc_meta   = {"language": "", "subject": "", "class": "", "code": sub_code}

        qp_batch_items = [
            (page_num, qp_images[page_num], qp_classifications[page_num])
            for page_num in qp_pages_to_scan
            if page_num < len(qp_classifications)
        ]

        qp_batch_size = 1 if detected_lang == "urdu" else 2

        qp_results = await extract_batch(
            job_id=job_id,
            batch_items=qp_batch_items,
            profile_dict=doc_profile.model_dump(),
            target_language=target_language,
            api_key=(_get_key()),
            response_schema=PageExtractionResult,
            log_fn=log_to_client,
            mode="qp",
            target_set=target_set,
            batch_size=qp_batch_size,
        )

        # ── PHASE 7: BUILD OUTPUT ROWS ──────────────────────────────────
        row_index = 0

        for local_idx, (page_num, page_res) in enumerate(qp_results):
            progress = int(30 + ((local_idx + 1) / len(qp_results)) * 70)
            await log_to_client(job_id, str(progress), "progress")

            if not page_res:
                await log_to_client(job_id, "",  "page_map_update",
                    {"page": local_idx + 1, "status": "bypassed"})
                continue

            META_KEY_MAP = {
                "language_detected": "language",
                "subject_name":      "subject",
                "class_grade":       "class",
                "subject_code":      "code",   
            }
            for k, meta_key in META_KEY_MAP.items():
                val = page_res.get(k)
                if val and not doc_meta.get(meta_key):
                    doc_meta[meta_key] = val

            page_image_url = f"/workspace/{job_id}/ui_pages/{base_name}/page_{page_num+1}.png"
            questions      = [q for q in page_res.get("questions", [])
                              if q.get("is_actual_test_question") and q.get("q_sno")]

            if not questions:
                await log_to_client(job_id, "", "page_map_update",
                    {"page": local_idx + 1, "status": "bypassed"})
                continue

            await log_to_client(job_id, "", "page_map_update",
                {"page": local_idx + 1, "status": "done"})

            ui_page_path = os.path.join(ui_pages_dir, f"page_{page_num+1}.png")
            import asyncio as _aio
            page_img_paths = await _aio.to_thread(
                process_qp_crops_sync,
                ui_page_path, questions, doc_images_dir, sub_code, base_name
            )

            for q in questions:
                q_sno_str = str(q.get("q_sno", "")).strip()
                norm      = normalize_qno(q_sno_str)
                comp_key  = f"{target_set}_{norm}"

                ms_page_num = (row_index % ms_page_count) + 1 if ms_page_count > 0 else 1
                ms_url = f"/workspace/{job_id}/ms_ui_pages/{base_name}/ms_page_{ms_page_num}.png"

                row = _build_output_row(
                    q=q,
                    q_sno_str=q_sno_str,
                    ms_url=ms_url,
                    target_set=target_set,
                    doc_meta=doc_meta,
                    doc_profile=doc_profile,
                    base_name=base_name,
                    page_num=page_num,
                    page_image_url=page_image_url,
                    page_img_paths=page_img_paths,
                    comp_key=comp_key,
                    strip_bullets=strip_bullets,
                    format_mode=format_mode,
                    normalize_qno=normalize_qno,
                )

                job_state["parsed_data"].append(row)
                job_state["stats"]["parsed"] = len(job_state["parsed_data"])
                row_index += 1

            await save_job_state(job_id, job_state)
            await log_to_client(job_id, "", "stats", job_state["stats"])

        # ── SCOUT FALLBACK ──────────────────────────────────────────────
        profile_dict = doc_profile.model_dump()
        if not doc_meta.get("subject") and profile_dict.get("qp_subject_or_code"):
            doc_meta["subject"] = profile_dict["qp_subject_or_code"]
            await log_to_client(job_id, f"   ↳ Subject from scout: {doc_meta['subject']}", "info")
        if not doc_meta.get("class") and profile_dict.get("class_grade"):
            doc_meta["class"] = profile_dict["class_grade"]
            await log_to_client(job_id, f"   ↳ Class from scout: {doc_meta['class']}", "info")
        if not doc_meta.get("language") and profile_dict.get("primary_language"):
            doc_meta["language"] = profile_dict["primary_language"]

        if job_state["parsed_data"]:
            for existing_row in job_state["parsed_data"]:
                if not existing_row.get("Subject Name") and doc_meta.get("subject"):
                    existing_row["Subject Name"] = doc_meta["subject"]
                if not existing_row.get("Class") and doc_meta.get("class"):
                    existing_row["Class"] = doc_meta["class"]
            await save_job_state(job_id, job_state)

        # ── PHASE 8: COMPLETION ──────────────────────────────────────────
        ms_doc.close()
        qp_doc.close()

        if not job_state.get("cancel_requested"):
            job_state["completed_sets"].append(target_set)
            target_ext = job_state.get("target_extraction", "ALL")

            if target_ext != "ALL":
                await save_job_state(job_id, job_state)
                await log_to_client(job_id, "ALL_DONE", "system_control")
            else:
                boundaries = job_state["set_boundaries"]
                if target_set == "A" and boundaries["B"] == -1:
                    job_state["completed_sets"].extend(["B", "C"])
                    await save_job_state(job_id, job_state)
                    await log_to_client(job_id, "ALL_DONE", "system_control")
                elif target_set == "B" and boundaries["C"] == -1:
                    job_state["completed_sets"].append("C")
                    await save_job_state(job_id, job_state)
                    await log_to_client(job_id, "ALL_DONE", "system_control")
                else:
                    job_state["status"] = "waiting_for_next_set"
                    await save_job_state(job_id, job_state)
                    await log_to_client(job_id, "100", "progress")
                    await log_to_client(job_id, "SET_COMPLETE", "system_control")
        else:
            await log_to_client(job_id, "HALTED", "system_control")

    except Exception as e:
        err = str(e).lower()
        if "429" in err or "quota" in err:
            safe_err = "API rate limit reached. Please wait and retry."
        elif "api_key" in err or "unauthorized" in err:
            safe_err = "API authentication error. Check your API key."
        else:
            safe_err = f"Engine error: {str(e)[:200]}"

        await log_to_client(job_id, safe_err, "error")
        await log_to_client(job_id, "ALL_DONE", "system_control")


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _format_summary(summary: dict) -> str:
    return " | ".join(f"{k}: {v}" for k, v in summary.items() if v > 0)


async def _vision_find_set_boundary(job_id, qp_images, target_set, get_key, log_fn) -> int:
    import google.genai as genai
    from google.genai import types

    total = len(qp_images)
    if total == 0:
        return -1

    step = max(1, total // 15)
    probe_pages = sorted(set(
        list(range(0, total, step)) +
        [total // 3, total // 2, 2 * total // 3, total - 1]
    ))

    set_results = {}

    async def _probe_page(p_num):
        if p_num >= total:
            return
        try:
            client = genai.Client(api_key=get_key())
            def _call():
                return client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        qp_images[p_num],
                        f"This is a page from an exam paper that has multiple sets (Set A, Set B, Set C). "
                        f"Look for a 'SET' label or heading on this page. "
                        f"Which SET does this page belong to? "
                        f"Reply with ONLY a single letter: A, B, C, or ? if you cannot tell."
                    ],
                    config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=5),
                )
            res = await asyncio.wait_for(asyncio.to_thread(_call), timeout=30.0)
            letter = res.text.strip().upper().replace(".", "").replace("SET", "").strip()
            if letter in ("A", "B", "C"):
                set_results[p_num] = letter
        except Exception:
            pass

    await log_fn(job_id, f"   ↳ 🔍 Vision boundary scan: probing {len(probe_pages)} pages...", "info")
    await asyncio.gather(*[_probe_page(p) for p in probe_pages])

    target_pages = sorted(p for p, s in set_results.items() if s == target_set)
    if not target_pages:
        return -1

    first_candidate = target_pages[0]

    prev_pages = sorted(p for p, s in set_results.items() if s != target_set and p < first_candidate)
    lower_bound = prev_pages[-1] if prev_pages else 0

    for p_num in range(lower_bound, first_candidate + 1):
        if p_num in set_results:
            continue
        try:
            def _refine(pn=p_num):
                c = genai.Client(api_key=get_key())
                return c.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=[
                        qp_images[pn],
                        f"Which SET does this exam page belong to? Reply ONLY: A, B, C, or ?"
                    ],
                    config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=5),
                )
            res = await asyncio.wait_for(asyncio.to_thread(_refine), timeout=30.0)
            letter = res.text.strip().upper().replace(".", "").replace("SET", "").strip()
            if letter in ("A", "B", "C"):
                set_results[p_num] = letter
        except Exception:
            pass

    confirmed = sorted(p for p, s in set_results.items() if s == target_set)
    result = confirmed[0] if confirmed else first_candidate
    await log_fn(job_id, f"   ↳ 🔍 Vision boundary scan complete: SET {target_set} detected at page {result + 1}.", "info")
    return result


async def _warn_about_page_types(job_id, qp_summary, ms_summary, log_to_client):
    total = sum(qp_summary.values()) or 1
    legacy = qp_summary.get("legacy_encoded", 0) + qp_summary.get("rtl_legacy", 0)
    image  = qp_summary.get("image_dominant", 0) + qp_summary.get("scanned", 0)

    if legacy > 0:
        pct = legacy / total * 100
        await log_to_client(job_id,
            f"   ⚠️ {pct:.0f}% of QP pages use legacy font — Vision-Only mode active for those",
            "warning")
    if image > 0:
        pct = image / total * 100
        await log_to_client(job_id,
            f"   ⚠️ {pct:.0f}% of QP pages are image-embedded — Full vision extraction active",
            "warning")


def _detect_set_boundaries(qp_doc: fitz.Document) -> dict:
    boundaries = {"A": 0, "B": -1, "C": -1}
    for p_num in range(len(qp_doc)):
        text = qp_doc[p_num].get_text("text").upper()
        if re.search(r'SET.{0,15}\bB\b', text) and boundaries["B"] == -1:
            boundaries["B"] = p_num
        if re.search(r'SET.{0,15}\bC\b', text) and boundaries["C"] == -1:
            boundaries["C"] = p_num
    return boundaries


def _get_pages_for_set(boundaries: dict, target_set: str, total: int) -> list:
    if target_set == "A":
        end = boundaries["B"] if boundaries["B"] != -1 else total
        return list(range(0, end))
    elif target_set == "B":
        if boundaries["B"] == -1:
            return []
        end = boundaries["C"] if boundaries["C"] != -1 else total
        return list(range(boundaries["B"], end))
    elif target_set == "C":
        if boundaries["C"] == -1:
            return []
        return list(range(boundaries["C"], total))
    return list(range(0, total))


def _get_ms_pages_for_set(ms_doc: fitz.Document, target_set: str) -> list:
    ms_b, ms_c = -1, -1
    for p_num in range(len(ms_doc)):
        text = ms_doc[p_num].get_text("text").upper()
        if re.search(r'SET\s*[-_]?\s*B', text) and ms_b == -1 and p_num > 1:
            ms_b = p_num
        if re.search(r'SET\s*[-_]?\s*C', text) and ms_c == -1 and p_num > 1:
            ms_c = p_num

    if ms_b == -1:
        return list(range(len(ms_doc)))

    if target_set == "A":
        return list(range(0, ms_b))
    elif target_set == "B":
        return list(range(ms_b, ms_c if ms_c != -1 else len(ms_doc)))
    elif target_set == "C" and ms_c != -1:
        return list(range(ms_c, len(ms_doc)))
    return list(range(len(ms_doc)))


def _build_output_row(
    q, q_sno_str, ms_url, target_set, doc_meta,
    doc_profile, base_name, page_num, page_image_url,
    page_img_paths, comp_key, strip_bullets, format_mode, normalize_qno
) -> dict:

    q_imgs   = page_img_paths.get(comp_key, {})

    o1 = strip_bullets(str(q.get("option_1", "")).strip())
    o2 = strip_bullets(str(q.get("option_2", "")).strip())
    o3 = strip_bullets(str(q.get("option_3", "")).strip())
    o4 = strip_bullets(str(q.get("option_4", "")).strip())
    opt_imgs = [q_imgs.get(f"opt{i}", "") for i in range(1, 5)]

    num_opts = sum(bool(o or i) for o, i in zip([o1, o2, o3, o4], opt_imgs))
    is_mcq   = num_opts > 0

    final_marks = str(q.get("marks", "")).strip()
    try:
        m_val = float(final_marks.replace("½", "0.5").replace("¼", "0.25"))
    except Exception:
        m_val = 1.0
    comp = "Easy" if m_val <= 2 else ("Hard" if m_val >= 5 else "Medium")

    bloom_raw = str(q.get("blooms_taxonomy", "Understanding")).title()
    bloom = ("Knowledge" if any(x in bloom_raw for x in ["Rememb", "Know"])
             else "Application" if "App" in bloom_raw
             else "Understanding")

    if is_mcq:
        q_type   = "1 Mark (MCQ)"
        obj_type = "1 Mark (MCQ)"
    else:
        q_type_raw = str(q.get("type_of_question", "")).lower()
        obj_raw    = str(q.get("objective_type", "")).lower()
        q_type = (
            "Very Short Answer (VSA)" if "very short" in q_type_raw or "vsa" in q_type_raw
            else "Long Answer Type (LA)" if "long" in q_type_raw
            else "Short Answer (SA)" if "short" in q_type_raw
            else "Objective-Type Questions"
        )
        obj_type = (
            "Fill in the blanks"  if "fill" in obj_raw or "blank" in obj_raw
            else "match the column"        if "match" in obj_raw
            else "True False"              if "true"  in obj_raw
            else "one-word questions"      if "one"   in obj_raw and "word" in obj_raw
            else "paragraph or case-based questions" if "paragraph" in obj_raw or "case" in obj_raw
            else "None"
        )

    import uuid as _uuid
    return {
        "id":                      str(_uuid.uuid4()),
        "Sl.No":                   q_sno_str,
        "Class":                   doc_meta.get("class", ""),
        "Subject Name":            doc_meta.get("subject", ""),
        "Subject Code":            doc_meta.get("code", ""),
        "SET Name":                target_set,
        "Lesson/Module":           q.get("lesson_module", ""),
        "Chapter":                 q.get("chapter", ""),
        "Translate Language":      doc_profile.primary_language,
        "Question Mode (Mandatory)": format_mode(q.get("mode_of_question"), bool(q_imgs.get("main"))),
        "Question text(Mandatory)": strip_bullets(str(q.get("question_text", "")).strip()),
        "Question Type (Mandatory)": "Standard",
        "Question Translate":       "", "Question Translate Image": "",
        "If Question is Image, Specify Image Name": q_imgs.get("main", ""),
        "Marks (Mandatory)":        final_marks,
        "Negative Marks":           "",
        "No. of Options/Blanks (Mandatory)": str(num_opts) if is_mcq else "0",
        "Repeat Question Id (Optional)": "",
        "Option1 Mode (Mandatory)":  format_mode(q.get("opt1_mode"), bool(opt_imgs[0])),
        "Option1 (Mandatory)":       o1, "Option1 Translate": "", "Option1 Translate Image": "",
        "If Option1 is Image, Specify Image Name": opt_imgs[0],
        "Option1 Is Correct?":       "No" if is_mcq else "",
        "Option2 Mode (Mandatory)":  format_mode(q.get("opt2_mode"), bool(opt_imgs[1])),
        "Option2 (Mandatory)":       o2, "Option2 Translate": "", "Option2 Translate Image": "",
        "If Option2 is Image, Specify Image Name": opt_imgs[1],
        "Option2 Is Correct?":       "No" if is_mcq else "",
        "Option3 Mode (Mandatory)":  format_mode(q.get("opt3_mode"), bool(opt_imgs[2])),
        "Option3 (Mandatory)":       o3, "Option3 Translate": "", "Option3 Translate Image": "",
        "If Option3 is Image, Specify Image Name": opt_imgs[2],
        "Option3 Is Correct?":       "No" if is_mcq else "",
        "Option4 Mode (Mandatory)":  format_mode(q.get("opt4_mode"), bool(opt_imgs[3])),
        "Option4 (Mandatory)":       o4, "Option4 Translate": "", "Option4 Translate Image": "",
        "If Option4 is Image, Specify Image Name": opt_imgs[3],
        "Option4 Is Correct?":       "No" if is_mcq else "",
        "Option5 Mode (Mandatory)":  "", "Option5 (Mandatory)": "", "Option5 Translate": "",
        "Option5 Translate Image":   "", "If Option5 is Image, Specify Image Name": "", "Option5 Is Correct?": "",
        "Option6 Mode (Mandatory)":  "", "Option6 (Mandatory)": "", "Option6 Translate": "",
        "Option6 Translate Image":   "", "If Option6 is Image, Specify Image Name": "", "Option6 Is Correct?": "",
        "IsNestedMainQuestionType":  "No",
        "NoofNestedQuestions":       "",
        "Parent Question No(if it is nested sub question)": q.get("parent_q_sno", ""),
        "NIOS Filename":             f"{base_name}.pdf",
        "Question Complexity":       comp,
        "Objective Type Questions":  obj_type,
        "Question Header":           q.get("question_header", ""),
        "Answer_Diagram_Image":      "",
        "Bloom's Taxonomy":          bloom,
        "Type of question (Mandatory)": q_type,
        "Duplicate_Flag":            "No",
        "MS_Diagram_Flag":           "No",
        "Page_Number":               str(page_num + 1),
        "Page_Image_URL":            page_image_url,
        "MS_Page_Image_URL":         ms_url,
        "Extraction_Confidence":     "100",
        "Is_Verified":               "No",
    }