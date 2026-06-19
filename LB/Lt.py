import os
import glob
import json
import re
import uuid
import io
import zipfile
import shutil
import string
import itertools 
import threading
import pandas as pd
import numpy as np
import fitz  # PyMuPDF 
import asyncio
import cv2
import time
import argparse
from datetime import datetime
from PIL import Image
from typing import List, Optional, Dict, Any
from contextlib import asynccontextmanager
from scan_endpoint import register_scan

from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Request, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from dotenv import load_dotenv

import redis.asyncio as aioredis
import sys
sys.path.insert(0, os.path.dirname(__file__))
from bulletproof.pipeline import bulletproof_process_set

load_dotenv()

# ==========================================
# REDIS CONNECTION
# ==========================================
redis_db = int(os.getenv("REDIS_DB", "0"))
redis_url = f"redis://localhost:6379/{redis_db}"
REDIS_TIMEOUT_SECONDS = float(os.getenv("REDIS_TIMEOUT_SECONDS", "2.0"))
redis_client = None

# ==========================================
# MULTI-KEY ROTATION POOL
# ==========================================
raw_keys = os.getenv("GEMINI_API_KEYS", os.getenv("GEMINI_API_KEY", ""))
API_KEYS = [k.strip() for k in raw_keys.split(",") if k.strip()] or ["DUMMY"]

_key_cycle = itertools.cycle(API_KEYS)
_key_lock  = threading.Lock()

def get_next_key() -> str:
    """Thread-safe round-robin key rotation."""
    with _key_lock:
        return next(_key_cycle)

SCAN_TEXT_AI_CONCURRENCY = max(1, int(os.getenv("SCAN_TEXT_AI_CONCURRENCY", "3")))
SCAN_TEXT_AI_SEMAPHORE = asyncio.Semaphore(SCAN_TEXT_AI_CONCURRENCY)

def prepare_scan_text_image(img: Image.Image, max_side: int = 1600) -> Image.Image:
    """Keep OCR crops small enough for fast vision requests."""
    clean = img.convert("RGB")
    width, height = clean.size
    longest = max(width, height)
    if longest <= max_side:
        return clean
    scale = max_side / float(longest)
    return clean.resize((max(1, int(width * scale)), max(1, int(height * scale))), Image.LANCZOS)

print(f"✅ LANG Engine key pool: {len(API_KEYS)} key(s) available for rotation.")

def print_language_status(job_id: str, label: str, language: str, files: list | None = None) -> None:
    file_text = ""
    if files:
        file_text = " | files: " + ", ".join(str(name) for name in files[:5])
        if len(files) > 5:
            file_text += f" +{len(files) - 5} more"
    print(f"[LANGUAGE] job={job_id} | {label}: {language or 'Unknown'}{file_text}", flush=True)



# ==========================================
# IN-MEMORY STATE MANAGEMENT
# ==========================================
JOB_STATES = {}  
LOG_QUEUES = {}

async def get_job_state(job_id):
    if redis_client:
        try:
            data = await asyncio.wait_for(
                redis_client.get(f"job:{job_id}"),
                timeout=REDIS_TIMEOUT_SECONDS,
            )
            if data:
                return json.loads(data)
        except Exception as exc:
            print(f"[WARN] Redis get_job_state failed for {job_id}: {exc}")
    return JOB_STATES.get(job_id)

async def save_job_state(job_id, state):
    JOB_STATES[job_id] = state
    if redis_client:
        try:
            await asyncio.wait_for(
                redis_client.set(f"job:{job_id}", json.dumps(state, default=str)),
                timeout=REDIS_TIMEOUT_SECONDS,
            )
            return
        except Exception as exc:
            print(f"[WARN] Redis save_job_state failed for {job_id}: {exc}")

async def delete_job_state(job_id):
    if redis_client:
        try:
            await asyncio.wait_for(
                redis_client.delete(f"job:{job_id}"),
                timeout=REDIS_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            print(f"[WARN] Redis delete_job_state failed for {job_id}: {exc}")
    JOB_STATES.pop(job_id, None)

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    candidate = aioredis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
        socket_timeout=REDIS_TIMEOUT_SECONDS,
        health_check_interval=30,
    )
    try:
        await asyncio.wait_for(candidate.ping(), timeout=REDIS_TIMEOUT_SECONDS)
        redis_client = candidate
    except Exception as exc:
        print(f"[WARN] Redis unavailable; using in-memory state only: {exc}")
        await candidate.aclose()
        redis_client = None
    os.makedirs("workspace", exist_ok=True)
    yield
    if redis_client:
        await redis_client.aclose()

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

@app.get("/workspace/{file_path:path}")
async def serve_workspace_files(file_path: str):
    full_path = os.path.join("workspace", file_path)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(full_path, headers={"Access-Control-Allow-Origin": "*"})

if os.path.exists("build") and os.path.exists("build/static"):
    app.mount("/static", StaticFiles(directory="build/static"), name="static")
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        if full_path.startswith("workspace/"):
            raise HTTPException(status_code=404)
        return FileResponse("build/index.html")

async def log_to_client(job_id, text, log_type="info", data=None):
    payload = {"type": log_type, "text": text}
    if data is not None: 
        payload["data"] = data
    if redis_client:
        try:
            await asyncio.wait_for(
                redis_client.publish(f"logs:{job_id}", json.dumps(payload, default=str)),
                timeout=REDIS_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            print(f"[WARN] Redis log publish failed for {job_id}: {exc}")

def get_base_name(filename):
    match = re.search(r'^(?:qp|ms|QP|MS)_(.*?)(?:_[a-zA-Z0-9]{15,})?\.pdf$', filename)
    base = match.group(1) if match else filename.replace('.pdf', '')
    base = base.replace('.pdf', '').replace('.PDF', '')
    return re.sub(r'[^a-zA-Z0-9_]', '', base) or "Document"

def is_marking_scheme_file(filename):
    stem = os.path.splitext(os.path.basename(str(filename or "")))[0].lower()
    normalized = re.sub(r"[^a-z0-9]+", " ", stem).strip()
    tokens = set(normalized.split())
    return (
        stem.startswith(("ms_", "ms-", "ms "))
        or "marking scheme" in normalized
        or "answer key" in normalized
        or "answerkey" in normalized
        or "ms" in tokens
        or "solutions" in tokens
        or "solution" in tokens
        or "tm" in tokens
    )

def normalize_qno(qno):
    return re.sub(r'[^0-9a-zA-Z_]', '', str(qno)).lower()

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

def normalize_row_identity_value(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()

def row_fingerprint(row: dict) -> str:
    parts = [
        row.get("SET Name"),
        row.get("NIOS Filename"),
        row.get("Sl.No") or row.get("Question Number") or row.get("q_sno"),
        row.get("Page_Number") or row.get("page_number"),
    ]
    return "|".join(normalize_row_identity_value(part) for part in parts)

def row_is_deleted(row: dict, deleted_ids=None, deleted_fingerprints=None) -> bool:
    return row.get("id") in set(deleted_ids or []) or row_fingerprint(row) in set(deleted_fingerprints or [])

def extract_json_from_text(raw_text):
    match = re.search(r'```json\n(.*?)```', raw_text, re.DOTALL)
    if match:
        return match.group(1)
    if raw_text.strip().startswith('{') or raw_text.strip().startswith('['):
        return raw_text
    return raw_text

def strip_bullets(text):
    if not text:
        return text
    cleaned = str(text).replace('_x000d_', '').replace('\r', '')
    cleaned = re.sub(r'^\s*\([a-zivx]+\)\s*|^\s*[a-zivx]+\)\s*', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()

def normalize_ocr_spelling(text):
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

def normalize_question_header_and_text(header: str, question_text: str) -> tuple[str, str]:
    header = normalize_ocr_spelling(strip_bullets(header or ""))
    question_text = normalize_ocr_spelling(strip_bullets(question_text or ""))
    if not header:
        return header, question_text
    long_header = len(header) > 180 or header.count("\n") >= 2
    passage_hint = re.search(r"\b(read|passage|paragraph|poem|extract|case study|answer the questions)\b", header, re.IGNORECASE)
    question_hint = re.search(r"(\?|(?:^|\n)\s*(?:\(?[A-D]\)|[A-D]\.|\d+\s*[\).]))", header, re.IGNORECASE)
    if long_header and passage_hint:
        first_line = next((line.strip() for line in header.splitlines() if line.strip()), "")
        short_header = first_line
        if len(short_header) > 120:
            short_header = "Read the following passage and answer the questions."
        combined_question = f"{header}\n\n{question_text}".strip() if question_text else header
        return short_header, combined_question
    if (long_header or question_hint) and (not question_text or len(question_text) < 40):
        combined_question = f"{header}\n\n{question_text}".strip() if question_text else header
        return "", combined_question
    if question_text and header.strip().lower() == question_text.strip().lower():
        return "", question_text
    return header, question_text

def format_mode(mode_str, has_img):
    if has_img:
        return "Image"
    if not mode_str:
        return "General"
    m = str(mode_str).lower()
    if "image" in m:
        return "Image"
    if "mcq" in m or "general" in m or "text" in m:
        return "General"
    return str(mode_str).title()

def load_cv2_image_sync(path):
    with open(path, "rb") as stream:
        return cv2.imdecode(np.asarray(bytearray(stream.read()), dtype=np.uint8), cv2.IMREAD_UNCHANGED)

def recursively_clean_nulls(obj):
    if isinstance(obj, dict):
        for k, v in list(obj.items()):
            if v is None or str(v).strip().lower() in ["null", "none", "undefined"]:
                obj[k] = ""
            else:
                recursively_clean_nulls(v)
    elif isinstance(obj, list):
        for item in obj:
            recursively_clean_nulls(item)

def clean_download_cell(value):
    if isinstance(value, str):
        replacements = {
            "âœ…": "Done",
            "âœ“": "Yes",
            "âŒ": "No",
            "âš ï¸": "Warning",
            "âš ": "Warning",
            "â€”": "-",
            "â€“": "-",
            "â†³": "->",
            "✓": "Yes",
            "✅": "Done",
            "✔": "Yes",
            "☑": "Yes",
        }
        cleaned = value
        for bad, good in replacements.items():
            cleaned = cleaned.replace(bad, good)
        return cleaned
    if isinstance(value, list):
        return [clean_download_cell(item) for item in value]
    if isinstance(value, dict):
        return {key: clean_download_cell(item) for key, item in value.items()}
    return value

def clean_download_rows(rows):
    return [clean_download_cell(row) for row in rows]

def clean_saved_rows(rows):
    cleaned_rows = []
    text_fields = [
        "Question text(Mandatory)",
        "Question Header",
        "Option1 (Mandatory)",
        "Option2 (Mandatory)",
        "Option3 (Mandatory)",
        "Option4 (Mandatory)",
        "Option5 (Mandatory)",
        "Option6 (Mandatory)",
    ]
    for row in rows or []:
        fixed = dict(row)
        for field in text_fields:
            if isinstance(fixed.get(field), str):
                fixed[field] = normalize_ocr_spelling(strip_bullets(fixed[field]))
        fixed["Question Header"], fixed["Question text(Mandatory)"] = normalize_question_header_and_text(
            fixed.get("Question Header", ""),
            fixed.get("Question text(Mandatory)", ""),
        )
        cleaned_rows.append(fixed)
    return cleaned_rows

# ==========================================
# PYDANTIC SCHEMAS
# ==========================================
class DocumentProfile(BaseModel):
    qp_subject_or_code: str = Field(description="Subject name or code in English.")
    ms_subject_or_code: str = Field(description="Subject name or code in English.")
    is_matching_pair: bool = Field(description="True ONLY if QP and MS belong to the exact same subject and exam.")
    primary_language: str = Field(description="The primary language detected. MUST be in English.")
    class_grade: str = Field(default="", description="Class or grade level in English.")

class ParsedQuestion(BaseModel):
    is_actual_test_question: bool = Field(description="Strictly True for exam questions. FALSE for instructions.")
    q_sno: str = Field(description="Exact Question Number, INCLUDING any sub-parts.")
    question_type: str = Field(default="standard")
    parent_q_sno: str = Field(default="")
    mode_of_question: str = Field(default="general - General MCQ")
    objective_type: str = Field(description="MUST BE EXACTLY ONE: '1 Mark (MCQ)', '1x2=2 Marks', 'Fill in the blanks', 'match the column', 'paragraph or case-based questions', 'one-word questions', 'True False', 'Flow Chart', 'Diagram Based', 'Map-Based', 'None'")
    type_of_question: str = Field(default="Objective-Type Questions")
    question_header: str = Field(default="", description="Short shared instruction/header only. Do not put full passage or actual question text here.")
    question_text: str = Field(default="")
    option_1: str = Field(default="")
    option_2: str = Field(default="")
    option_3: str = Field(default="")
    option_4: str = Field(default="")
    justification_for_crop: str = Field(default="None")
    requires_crop: bool = Field(description="FALSE for text/math. TRUE ONLY for actual visual diagrams.")
    crop_box_2d: Optional[List[int]] = None
    opt1_requires_crop: bool = Field(default=False)
    opt1_crop_box: Optional[List[int]] = None
    opt1_mode: str = Field(default="general - MCQ type")
    opt2_requires_crop: bool = Field(default=False)
    opt2_crop_box: Optional[List[int]] = None
    opt2_mode: str = Field(default="general - MCQ type")
    opt3_requires_crop: bool = Field(default=False)
    opt3_crop_box: Optional[List[int]] = None
    opt3_mode: str = Field(default="general - MCQ type")
    opt4_requires_crop: bool = Field(default=False)
    opt4_crop_box: Optional[List[int]] = None
    opt4_mode: str = Field(default="general - MCQ type")
    marks: str = Field(default="")
    blooms_taxonomy: str = Field(default="Understanding")
    difficulty_level: str = Field(default="Medium")
    lesson_module: str = Field(default="")
    chapter: str = Field(default="")

class PageExtractionResult(BaseModel):
    detected_question_numbers: List[str] = Field()
    language_detected: str = ""
    subject_name: str = ""
    subject_code: str = ""
    class_grade: str = ""
    questions: List[ParsedQuestion]

class AnswerKeyItem(BaseModel):
    q_sno: str = Field(default="")
    correct_option_letter: str = Field(default="")
    full_answer_text: str = Field(default="")
    marks_awarded: str = Field(default="")
    justification_for_crop: str = Field(default="None")
    requires_crop: bool = Field(default=False)
    diagram_flag: bool = Field(default=False)
    crop_box_2d: Optional[List[int]] = None

class AnswerKeyPage(BaseModel):
    detected_question_numbers: List[str] = Field()
    answers: List[AnswerKeyItem]

# ==========================================
# EXTRACTION FUNCTIONS
# ==========================================
async def scout_document_profile(job_id, qp_doc, ms_doc):
    await log_to_client(job_id, "   ↳ [PHASE 1] Scouting document profile...", "info")
    page = qp_doc[0]
    img_bytes = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0)).tobytes("png")
    pil_img = Image.open(io.BytesIO(img_bytes))

    prompt = """Analyze this exam paper cover page.
Return JSON with exactly these fields:
- qp_subject_or_code: subject name and/or code in ENGLISH
- ms_subject_or_code: same as above in ENGLISH
- is_matching_pair: true
- primary_language: MUST be in English — one of: Tamil, Hindi, Sanskrit, Sanskrit Vyakaran, Sanskrit Sahitya, Urdu, Bengali, Assamese, Gujarati, Kannada, Malayalam, Marathi, Odiya, Punjabi, Telugu, English
- class_grade: the class or grade level in English
"""

    MODEL_CASCADE = [
        ("gemini-2.5-flash", 4, 300.0),   
        ("gemini-2.5-pro",   3, 300.0),
    ]

    for model_name, max_attempts, timeout in MODEL_CASCADE:
        await log_to_client(job_id, "      Checking document profile...", "info")

        for attempt in range(max_attempts):
            # Exponential backoff: 0s, 15s, 30s, 60s ... capped at 90s
            wait_time = min(15 * (2 ** attempt), 90) if attempt > 0 else 0
            if wait_time > 0:
                await log_to_client(job_id, f"      ⏳ Waiting {wait_time}s before attempt {attempt + 1}/{max_attempts}...", "warning")
                await asyncio.sleep(wait_time)

            try:
                client = genai.Client(api_key=get_next_key())

                def _gen(m=model_name):
                    return client.models.generate_content(
                        model=m,
                        contents=[pil_img, prompt],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=DocumentProfile,
                            temperature=0.0
                        )
                    )

                res = await asyncio.wait_for(asyncio.to_thread(_gen), timeout=timeout)
                parsed = json.loads(extract_json_from_text(res.text))
                recursively_clean_nulls(parsed)
                profile = DocumentProfile(**parsed)
                print_language_status(job_id, "detected language", profile.primary_language)
                await log_to_client(job_id, "      Document profile detected.", "info")
                await log_to_client(job_id, f"      Detected language: {profile.primary_language}", "info")
                return profile

            except asyncio.TimeoutError:
                await log_to_client(job_id, f"      Profile check timed out. Retrying ({attempt + 1}/{max_attempts})...", "warning")
                continue

            except Exception as e:
                err = str(e).lower()
                await log_to_client(job_id, f"      Profile check failed. Retrying ({attempt + 1}/{max_attempts})...", "warning")

                if "429" in err or "quota" in err:
                    # Rate limited — longer wait, rotate key, then retry same model
                    await log_to_client(job_id, "      Processing service is busy. Waiting 45s before retry...", "warning")
                    await asyncio.sleep(45)
                    continue
                elif "503" in err or "unavailable" in err or "overload" in err or "high demand" in err:
                    # Server overloaded — cascade to next model after exhausting retries
                    await log_to_client(job_id, "      Processing service is busy. Retrying...", "warning")
                    continue
                elif "400" in err or "invalid" in err:
                    # Bad request — no point retrying same model
                    await log_to_client(job_id, "      Profile check returned an invalid response. Trying fallback...", "warning")
                    break
                else:
                    # Unknown error — short wait then retry
                    await asyncio.sleep(5)
                    continue

        await log_to_client(job_id, "      Profile check attempts exhausted. Trying fallback...", "warning")

    await log_to_client(job_id, "      Profile check failed. Using defaults; extraction will continue.", "warning")
    fallback_profile = DocumentProfile(
        qp_subject_or_code="Unknown",
        ms_subject_or_code="Unknown",
        is_matching_pair=True,
        primary_language="Hindi",
        class_grade=""
    )
    print_language_status(job_id, "detected language", fallback_profile.primary_language)
    await log_to_client(job_id, f"      Detected language: {fallback_profile.primary_language}", "info")
    return fallback_profile

def process_qp_crops_sync(image_path: str, parsed_questions: list, output_dir: str, subject_code: str, base_name: str):
    img = load_cv2_image_sync(image_path)
    if img is None: return {}
    h, w, _ = img.shape
    page_img_map = {}

    def crop_and_save(box, target_set, q_num, suffix_label):
        if not box or len(box) != 4: return ""
        ymin, xmin, ymax, xmax = box
        y1, x1 = max(0, int((ymin/1000.0)*h) - int(h*0.015)), max(0, int((xmin/1000.0)*w) - int(w*0.015))
        y2, x2 = min(h, int((ymax/1000.0)*h) + int(h*0.015)), min(w, int((xmax/1000.0)*w) + int(w*0.015))
        if y1 >= y2 or x1 >= x2: return ""
        crop_img = img[y1:y2, x1:x2]
        if crop_img is None or crop_img.size == 0: return ""
        ts = datetime.now().strftime("%H-%M-%S")
        img_name = f"{subject_code}_{target_set.upper()}_{ts}_{q_num.upper()}{suffix_label}.png"
        cv2.imencode(".png", crop_img)[1].tofile(os.path.join(output_dir, img_name))
        return img_name

    for q in parsed_questions:
        q_sno = str(q.get('q_sno', ''))
        norm_qno = normalize_qno(q_sno)
        q_set_name = str(q.get('set_name', 'A')).strip().upper()
        composite_key = f"{q_set_name}_{norm_qno}"
        paths = {}
        if q.get('requires_crop'): paths['main'] = crop_and_save(q.get('crop_box_2d'), q_set_name, norm_qno, "")
        if q.get('opt1_requires_crop'): paths['opt1'] = crop_and_save(q.get('opt1_crop_box'), q_set_name, norm_qno, "_opt1")
        if q.get('opt2_requires_crop'): paths['opt2'] = crop_and_save(q.get('opt2_crop_box'), q_set_name, norm_qno, "_opt2")
        if q.get('opt3_requires_crop'): paths['opt3'] = crop_and_save(q.get('opt3_crop_box'), q_set_name, norm_qno, "_opt3")
        if q.get('opt4_requires_crop'): paths['opt4'] = crop_and_save(q.get('opt4_crop_box'), q_set_name, norm_qno, "_opt4")
        if paths: page_img_map[composite_key] = paths
    return page_img_map

async def process_batch_set(job_id, files_info, job_folder, target_set="A"):
    await bulletproof_process_set(
        job_id=job_id,
        files_info=files_info,
        job_folder=job_folder,
        target_set=target_set,
        active_redis_client=redis_client,
        PageExtractionResult=PageExtractionResult,
        AnswerKeyPage=AnswerKeyPage,
        DocumentProfile=DocumentProfile,
        scout_document_profile=scout_document_profile,
        process_qp_crops_sync=process_qp_crops_sync,
        get_base_name=get_base_name,
        normalize_qno=normalize_qno,
        strip_bullets=strip_bullets,
        format_mode=format_mode,
        get_next_key=get_next_key,
    )

# ==========================================
# FASTAPI ENDPOINTS
# ==========================================
@app.get("/api-status")
async def get_api_status():
    return {"current": len(API_KEYS), "total": len(API_KEYS)}

class SyncData(BaseModel):
    parsed_data: list

@app.post("/sync-db/{job_id}")
async def sync_db(job_id: str, data: SyncData, request: Request):
    job_state = await get_job_state(job_id)
    if not job_state:
        job_state = {
            "status": "completed", "parsed_data": [], "image_map": {},
            "owner_workspace_id": workspace_owner_id(request),
            "cancel_requested": False, "current_set": "A", "completed_sets": [],
            "ms_master_map": {}, "qp_doc_path": None, "base_name": "Imported_Doc",
            "stats": {"parsed": len(data.parsed_data), "diagrams": 0, "duplicates": 0, "trash": 0}
        }
    await assert_job_owner(job_id, job_state, request)
    deleted_ids = set(job_state.get("deleted_row_ids", []))
    deleted_fingerprints = set(job_state.get("deleted_row_fingerprints", []))
    repaired_rows = enforce_unique_workspace_qnos(data.parsed_data)
    job_state["parsed_data"] = [
        row for row in repaired_rows
        if not row_is_deleted(row, deleted_ids, deleted_fingerprints)
    ]
    job_state["deleted_row_ids"] = list(deleted_ids)
    job_state["deleted_row_fingerprints"] = list(deleted_fingerprints)
    job_state["stats"] = {**job_state.get("stats", {}), "parsed": len(job_state["parsed_data"])}
    await save_job_state(job_id, job_state)
    return {"status": "synced"}

class LanguageConfirmation(BaseModel):
    language: str

@app.post("/confirm-language/{job_id}")
async def confirm_language(job_id: str, data: LanguageConfirmation, request: Request):
    job_state = await get_job_state(job_id)
    if not job_state: raise HTTPException(status_code=404, detail="Job not found")
    await assert_job_owner(job_id, job_state, request)
    job_state["confirmed_language"] = data.language
    job_state["language_confirmed"] = True
    await save_job_state(job_id, job_state)
    await log_to_client(job_id, f"   ↳ User confirmed language: {data.language}", "info")
    return {"status": "confirmed", "language": data.language}

class WorkspaceState(BaseModel):
    workspace: dict

def workspace_owner_id(request: Request) -> str:
    raw_id = (
        request.headers.get("x-ads-workspace-id")
        or request.headers.get("x-ads-session-id")
        or request.query_params.get("workspace_id")
        or "default"
    )
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", str(raw_id))[:96] or "default"

def workspace_storage_key(request: Request) -> str:
    return f"workspace_state_lp:{workspace_owner_id(request)}"

def workspace_rows(workspace: dict, prefix: str) -> list:
    matrices = workspace.get(f"{prefix}_matrices", {}) if isinstance(workspace, dict) else {}
    if not isinstance(matrices, dict):
        return []
    rows = []
    for matrix_rows in matrices.values():
        if isinstance(matrix_rows, list):
            rows.extend(matrix_rows)
    return rows

def workspace_row_count(workspace: dict, prefix: str) -> int:
    return len(workspace_rows(workspace, prefix))

def workspace_job_ids(workspace: dict, prefix: str) -> set:
    ids = set()
    if not isinstance(workspace, dict):
        return ids
    for tab in workspace.get(f"{prefix}_openTabs", []) or []:
        if isinstance(tab, dict) and tab.get("jobId"):
            ids.add(str(tab.get("jobId")))
    matrices = workspace.get(f"{prefix}_matrices", {})
    if isinstance(matrices, dict):
        for tab_id in matrices.keys():
            match = re.search(r"engine-([0-9a-f-]{12,})-", str(tab_id), re.IGNORECASE)
            if match:
                ids.add(match.group(1))
    return ids

def workspace_sources(workspace: dict, prefix: str) -> set:
    sources = set()
    if not isinstance(workspace, dict):
        return sources
    for tab in workspace.get(f"{prefix}_openTabs", []) or []:
        if isinstance(tab, dict):
            source = str(tab.get("qpName") or tab.get("label") or "").strip().lower()
            if source:
                sources.add(source)
    for row in workspace_rows(workspace, prefix):
        if not isinstance(row, dict):
            continue
        source = str(
            row.get("NIOS Filename")
            or row.get("Source File")
            or row.get("Subject Name")
            or row.get("Subject Code")
            or ""
        ).strip().lower()
        if source:
            sources.add(source)
    return sources

def sets_overlap(left: set, right: set) -> bool:
    for item in left:
        if item in right:
            return True
        for other in right:
            if item and other and (item in other or other in item):
                return True
    return False

def should_keep_larger_workspace(existing: dict, candidate: dict, prefix: str) -> bool:
    existing_rows = workspace_row_count(existing, prefix)
    candidate_rows = workspace_row_count(candidate, prefix)
    if existing_rows == 0:
        return False
    if candidate_rows == 0:
        return True
    if candidate_rows >= existing_rows:
        return False

    existing_jobs = workspace_job_ids(existing, prefix)
    candidate_jobs = workspace_job_ids(candidate, prefix)
    if sets_overlap(existing_jobs, candidate_jobs) and candidate_rows >= int(existing_rows * 0.75):
        return False

    existing_sources = workspace_sources(existing, prefix)
    candidate_sources = workspace_sources(candidate, prefix)
    return sets_overlap(existing_sources, candidate_sources) or candidate_rows <= existing_rows - 5

async def load_existing_workspace_for_save(key: str) -> dict:
    try:
        if redis_client:
            data = await asyncio.wait_for(
                redis_client.get(key),
                timeout=REDIS_TIMEOUT_SECONDS,
            )
            if data:
                return json.loads(data)
    except Exception:
        pass
    return getattr(app.state, "workspaces", {}).get(key, {})

async def candidate_has_incomplete_jobs(candidate: dict, prefix: str) -> bool:
    for job_id in workspace_job_ids(candidate, prefix):
        job_state = await get_job_state(job_id)
        if job_state and job_state.get("status") not in {"completed", "waiting_for_next_set"}:
            return True
    return False

async def assert_job_owner(job_id: str, job_state: dict, request: Request) -> None:
    owner_id = workspace_owner_id(request)
    existing_owner = job_state.get("owner_workspace_id")
    if existing_owner and existing_owner != owner_id:
        raise HTTPException(status_code=403, detail="This job belongs to another workspace.")
    if not existing_owner:
        job_state["owner_workspace_id"] = owner_id
        await save_job_state(job_id, job_state)

@app.post("/redis/save")
async def redis_save(state: WorkspaceState, request: Request):
    key = workspace_storage_key(request)
    existing_workspace = await load_existing_workspace_for_save(key)
    existing_rows = workspace_row_count(existing_workspace, "lp")
    candidate_rows = workspace_row_count(state.workspace, "lp")
    if (
        should_keep_larger_workspace(existing_workspace, state.workspace, "lp")
        or (0 < candidate_rows < existing_rows and await candidate_has_incomplete_jobs(state.workspace, "lp"))
    ):
        return {
            "success": True,
            "skipped": True,
            "reason": "kept_larger_workspace",
            "existingRows": existing_rows,
            "candidateRows": candidate_rows,
        }
    try:
        if not redis_client:
            raise RuntimeError("Redis unavailable")
        await asyncio.wait_for(
            redis_client.set(key, json.dumps(state.workspace)),
            timeout=REDIS_TIMEOUT_SECONDS,
        )
        return {"success": True}
    except Exception:
        if not hasattr(app.state, "workspaces"):
            app.state.workspaces = {}
        app.state.workspaces[key] = state.workspace
        return {"success": True}

@app.get("/redis/load")
async def redis_load(request: Request):
    key = workspace_storage_key(request)
    try:
        if not redis_client:
            raise RuntimeError("Redis unavailable")
        data = await asyncio.wait_for(
            redis_client.get(key),
            timeout=REDIS_TIMEOUT_SECONDS,
        )
        if data: return {"success": True, "workspace": json.loads(data)}
        return {"success": False, "workspace": {}}
    except Exception:
        ws = getattr(app.state, "workspaces", {}).get(key, {})
        return {"success": bool(ws), "workspace": ws}

@app.post("/redis/clear")
async def redis_clear(request: Request):
    key = workspace_storage_key(request)
    try:
        if not redis_client:
            raise RuntimeError("Redis unavailable")
        await asyncio.wait_for(
            redis_client.delete(key),
            timeout=REDIS_TIMEOUT_SECONDS,
        )
        return {"success": True}
    except Exception:
        if hasattr(app.state, "workspaces"):
            app.state.workspaces.pop(key, None)
        return {"success": True}

@app.post("/process-documents")
async def process_documents(request: Request, background_tasks: BackgroundTasks, files: List[UploadFile] = File(...), target_set: str = Form("ALL"), target_language: str = Form("Original")):
    job_id = str(uuid.uuid4())
    job_folder = os.path.join("workspace", job_id)
    os.makedirs(job_folder, exist_ok=True)
    LOG_QUEUES[job_id] = asyncio.Queue()
    saved_files = []
    for file in files:
        file_path = os.path.join(job_folder, file.filename)
        with open(file_path, "wb") as f: f.write(await file.read())
        saved_files.append({"name": file.filename, "path": file_path})
    print_language_status(job_id, "selected target language", target_language, [item["name"] for item in saved_files])

    initial_set = "A" if target_set == "ALL" else target_set
    initial_state = {
        "status": "processing", "parsed_data": [], "image_map": {},
        "owner_workspace_id": workspace_owner_id(request),
        "deleted_row_ids": [], "deleted_row_fingerprints": [],
        "cancel_requested": False, "current_set": initial_set,
        "target_extraction": target_set, "target_language": target_language,
        "completed_sets": [], "ms_master_map": {}, "qp_doc_path": None,
        "uploaded_files": [item["name"] for item in saved_files],
        "base_name": "Document", "stats": {"parsed": 0, "diagrams": 0, "duplicates": 0, "trash": 0}
    }
    await save_job_state(job_id, initial_state)
    background_tasks.add_task(process_batch_set, job_id, saved_files, job_folder, initial_set)
    return {"job_id": job_id}

@app.post("/continue-set/{job_id}")
async def continue_processing_set(job_id: str, request: Request, background_tasks: BackgroundTasks, next_set: str):
    job_state = await get_job_state(job_id)
    if not job_state: raise HTTPException(status_code=404)
    await assert_job_owner(job_id, job_state, request)
    job_state["status"] = "processing"
    job_state["current_set"] = next_set
    await save_job_state(job_id, job_state)
    background_tasks.add_task(process_batch_set, job_id, [], os.path.join("workspace", job_id), next_set)
    return {"status": "resumed", "set": next_set}

@app.post("/cancel/{job_id}")
async def cancel_job(job_id: str, request: Request):
    job_state = await get_job_state(job_id)
    if job_state:
        await assert_job_owner(job_id, job_state, request)
        job_state["cancel_requested"] = True
        await save_job_state(job_id, job_state)
    return {"status": "cancelled"}

@app.get("/logs/{job_id}")
async def stream_logs(job_id: str, request: Request):
    async def log_generator():
        if not redis_client:
            yield f"data: {json.dumps({'type': 'error', 'text': 'Database disconnected'})}\n\n"
            return
        job_state = await get_job_state(job_id)
        if job_state:
            await assert_job_owner(job_id, job_state, request)
            yield f"data: {json.dumps({'type': 'info', 'text': 'Log stream connected. Extraction is running in the background.'})}\n\n"
            stats = job_state.get("stats")
            if stats:
                yield f"data: {json.dumps({'type': 'stats', 'text': '', 'data': stats})}\n\n"
            if job_state.get("status") in {"completed", "cancelled", "halted"}:
                yield f"data: {json.dumps({'type': 'system_control', 'text': 'ALL_DONE'})}\n\n"
                return
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(f"logs:{job_id}")
        last_heartbeat = time.time()
        try:
            while True:
                if await request.is_disconnected(): break 
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message["type"] == "message":
                    log_data = message["data"]
                    yield f"data: {log_data}\n\n"
                    log_dict = json.loads(log_data)
                    if log_dict.get("type") == "system_control" and log_dict.get("text") in ["ALL_DONE", "SET_COMPLETE", "HALTED"]: break
                elif time.time() - last_heartbeat >= 30:
                    yield ": keepalive\n\n"
                    last_heartbeat = time.time()
        finally:
            await pubsub.unsubscribe(f"logs:{job_id}")
            await pubsub.close()
    return StreamingResponse(
        log_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.get("/data/{job_id}")
async def get_data(job_id: str, request: Request):
    job_state = await get_job_state(job_id)
    if not job_state: raise HTTPException(status_code=404)
    await assert_job_owner(job_id, job_state, request)
    if isinstance(job_state.get("parsed_data"), list):
        job_state["parsed_data"] = clean_saved_rows(enforce_unique_workspace_qnos(job_state["parsed_data"]))
    return job_state

@app.post("/upload-manual-image/{job_id}")
async def upload_manual_image(request: Request, job_id: str, q_sno: str = Form(...), set_name: str = Form(...), base_name: str = Form(...), field: str = Form(...), subject_code: str = Form(""), source: str = Form("QP"), file: UploadFile = File(...)):
    job_state = await get_job_state(job_id)
    if job_state:
        await assert_job_owner(job_id, job_state, request)
    job_folder = os.path.join("workspace", job_id)
    clean_base = base_name.replace('.pdf', '').replace('.PDF', '')
    images_base_dir = os.path.join(job_folder, "images", clean_base)
    os.makedirs(images_base_dir, exist_ok=True)

    clean_qno = normalize_qno(q_sno)
    if "Option 1" in field:   suffix = "_opt1"
    elif "Option 2" in field: suffix = "_opt2"
    elif "Option 3" in field: suffix = "_opt3"
    elif "Option 4" in field: suffix = "_opt4"
    elif "Option 5" in field: suffix = "_opt5"
    elif "Option 6" in field: suffix = "_opt6"
    else:                     suffix = ""

    ts = datetime.now().strftime("%H-%M-%S")
    import re
    safe_code = re.sub(r'[/\\:*?"<>|]', '-', str(subject_code))
    safe_qno  = re.sub(r'[/\\:*?"<>|]', '-', str(clean_qno))
    filename  = f"{safe_code}_{set_name.upper()}_{ts}_{safe_qno.upper()}{suffix}.png"
    with open(os.path.join(images_base_dir, filename), "wb") as f: f.write(await file.read())
    return {"status": "success", "filename": filename}

class ExportRequest(BaseModel):
    set_name: str
    data: List[dict]

@app.post("/export-zip/{job_id}")
async def export_zip(job_id: str, req: ExportRequest, request: Request):
    job_folder = os.path.join("workspace", job_id) if job_id != "imported" else "workspace/imported_export"
    os.makedirs(job_folder, exist_ok=True)
    export_data = req.data
    metadata_qp_file = ""
    metadata_ms_file = ""
    if job_id != "imported":
        job_state = await get_job_state(job_id)
        if job_state:
            await assert_job_owner(job_id, job_state, request)
            metadata_qp_file = str(job_state.get("qp_file_name", "") or "")
            metadata_ms_file = str(job_state.get("ms_file_name", "") or "")
            export_data = [
                row for row in req.data
                if not row_is_deleted(row, job_state.get("deleted_row_ids", []), job_state.get("deleted_row_fingerprints", []))
            ]
    export_data = clean_download_rows(enforce_unique_workspace_qnos(export_data))
    df = pd.DataFrame(export_data)
    zip_path = os.path.join(job_folder, f"Verified_SET_{req.set_name}_{uuid.uuid4().hex[:6]}.zip")

    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        excel_path = os.path.join(job_folder, f"SET_{req.set_name}.xlsx")
        df.to_excel(excel_path, index=False)
        zipf.write(excel_path, arcname=f"SET_{req.set_name}.xlsx")

        json_path = os.path.join(job_folder, f"SET_{req.set_name}.json")
        with open(json_path, 'w', encoding='utf-8') as f: json.dump(export_data, f, indent=4)
        zipf.write(json_path, arcname=f"SET_{req.set_name}.json")

        qp_file = metadata_qp_file or (df['NIOS Filename'].iloc[0] if not df.empty else 'Unknown.pdf')
        ms_file = metadata_ms_file or qp_file.replace('QP', 'MS').replace('qp', 'ms')
        subject = df['Subject Name'].iloc[0] if not df.empty else 'Unknown'
        cls = df['Class'].iloc[0] if not df.empty else 'Unknown'

        meta_text = f"Subject: {subject}\nClass: {cls}\nQP File Name: {qp_file}\nMS File Name: {ms_file}\n"
        meta_path = os.path.join(job_folder, "uploaded_files_info.txt")
        with open(meta_path, 'w', encoding='utf-8') as f: f.write(meta_text)
        zipf.write(meta_path, arcname="uploaded_files_info.txt")

        if job_id != "imported":
            images_dir = os.path.join("workspace", job_id, "images")
            if os.path.exists(images_dir):
                for root, _, files in os.walk(images_dir):
                    for file in files:
                        full_path = os.path.join(root, file)
                        arcname = os.path.relpath(full_path, images_dir)
                        zipf.write(full_path, arcname=f"images/{arcname}")

    return FileResponse(path=zip_path, filename=f"Verified_SET_{req.set_name}.zip", media_type="application/zip")

@app.post("/restore-workspace/{job_id}")
async def restore_workspace(job_id: str, request: Request, background_tasks: BackgroundTasks, files: List[UploadFile] = File(...)):
    existing_state = await get_job_state(job_id)
    if existing_state:
        await assert_job_owner(job_id, existing_state, request)
    job_folder = os.path.join("workspace", job_id)
    os.makedirs(job_folder, exist_ok=True)
    async def unpack_pdfs(files_data):
        for file_name, file_bytes in files_data:
            if file_name.lower().endswith('.zip'):
                try:
                    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z: z.extractall(job_folder)
                except Exception: pass
                continue
            file_path = os.path.join(job_folder, file_name)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "wb") as f: f.write(file_bytes)
            if file_name.lower().endswith('.pdf'):
                base_name = get_base_name(file_name)
                ui_dir = os.path.join(job_folder, "ms_ui_pages" if "ms" in file_name.lower() else "ui_pages", base_name)
                os.makedirs(ui_dir, exist_ok=True)
                doc = fitz.open(file_path)
                for page_num in range(len(doc)):
                    pix = doc[page_num].get_pixmap(matrix=fitz.Matrix(4, 4))
                    prefix = "ms_page_" if "ms" in file_name.lower() else "page_"
                    pix.save(os.path.join(ui_dir, f"{prefix}{page_num + 1}.png"), "jpeg", 85)
                doc.close()
    files_data = [(f.filename, await f.read()) for f in files]
    background_tasks.add_task(unpack_pdfs, files_data)
    return {"status": "restoring_in_background"}

@app.delete("/delete-row/{job_id}/{row_id}")
async def delete_row(job_id: str, row_id: str, request: Request):
    job_state = await get_job_state(job_id)
    if job_state and "parsed_data" in job_state:
        await assert_job_owner(job_id, job_state, request)
        deleted_ids = set(job_state.get("deleted_row_ids", []))
        deleted_fingerprints = set(job_state.get("deleted_row_fingerprints", []))
        deleted_ids.add(row_id)
        for row in job_state["parsed_data"]:
            if row.get("id") == row_id:
                deleted_fingerprints.add(row_fingerprint(row))
        job_state["parsed_data"] = [
            r for r in job_state["parsed_data"]
            if r.get("id") != row_id and row_fingerprint(r) not in deleted_fingerprints
        ]
        job_state["deleted_row_ids"] = list(deleted_ids)
        job_state["deleted_row_fingerprints"] = list(deleted_fingerprints)
        job_state["stats"] = {**job_state.get("stats", {}), "parsed": len(job_state["parsed_data"])}
        await save_job_state(job_id, job_state)
    return {"status": "deleted"}

@app.delete("/cleanup/{job_id}")
async def cleanup_job(job_id: str):
    job_folder = os.path.join("workspace", job_id)
    try:
        if os.path.exists(job_folder): shutil.rmtree(job_folder)
        await delete_job_state(job_id)
        LOG_QUEUES.pop(job_id, None)
        return {"status": "cleaned"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))


@app.post("/scan-text")
async def scan_text(
    image:     UploadFile = File(...),
    language:  str        = Form("auto"),
    direction: str        = Form("ltr"),
    script:    str        = Form("auto"),
):
    """
    AI-powered text extraction for the workspace Scan Text button.
    Handles all regional scripts including legacy-encoded fonts.
    Request:  multipart/form-data — image file + language / direction / script fields.
    Response: { "text": "...", "chars": N, "status": "ok" }
    """
    try:
        img_bytes = await image.read()
        pil_img   = prepare_scan_text_image(Image.open(io.BytesIO(img_bytes)))

        lang_display   = language.title() if language not in ("auto", "") else "regional language"
        script_display = script if script not in ("auto", "") else "regional"

        _PRO_SCRIPTS = {"telugu", "odia", "malayalam", "arabic", "gurmukhi", "kannada"}

        _SCRIPT_RULES = {
            "telugu": (
                "⚠️ TELUGU UNICODE MANDATORY (U+0C00–U+0C7F):\n"
                "This image uses a legacy Telugu font (Gautami/Vani/Hemalatha).\n"
                "Output ONLY Telugu Unicode characters: అ ఆ ఇ ఈ ఉ ఊ క ఖ గ ఘ న ప ఫ బ భ మ య ర ల వ శ ష స హ etc.\n"
                "FORBIDDEN: Latin transliteration like 'naayakuDayam', 'garuDaMthuDu'.\n"
                "FORBIDDEN: English descriptions. REQUIRED: Telugu Unicode only.\n"
                "CRITICAL confusables: న ≠ స ≠ శ | అ ≠ ఆ | ట ≠ డ | ్ (virama) NEVER drop."
            ),
            "odia": (
                "⚠️ ODIA UNICODE MANDATORY (U+0B00–U+0B7F):\n"
                "This image uses a legacy Odia font (Akruti/CDAC).\n"
                "Output ONLY Odia Unicode characters.\n"
                "FORBIDDEN: Latin transliteration. REQUIRED: Odia Unicode only.\n"
                "CRITICAL: ୍ (virama) NEVER drop | ଂ ≠ ଁ | ଦ ≠ ଡ | circular forms look similar — read carefully."
            ),
            "malayalam": (
                "⚠️ MALAYALAM UNICODE MANDATORY (U+0D00–U+0D7F):\n"
                "Output ONLY Malayalam Unicode characters.\n"
                "FORBIDDEN: Latin transliteration. REQUIRED: Malayalam Unicode only.\n"
                "CRITICAL: ് (chandrakkala) NEVER drop | chillus ൻ ർ ൽ ൾ ൺ must be preserved | ള ≠ ല ≠ ഴ."
            ),
            "arabic": (
                "⚠️ ARABIC/URDU/RTL UNICODE MANDATORY:\n"
                "Read every line RIGHT TO LEFT.\n"
                "CRITICAL BI-DIRECTIONAL RULE: You MUST strictly preserve all Roman numerals (i, ii, iii) and English letters (A, B, C, D) mixed in the text. Do NOT drop them.\n"
                "FORBIDDEN: left-to-right reordering. REQUIRED: Arabic/Urdu/Persian Unicode only.\n"
                "CRITICAL: ء ≠ ئ ≠ ؤ | ے ≠ ی | ک ≠ گ | ر ≠ ز | preserve ALL harakat diacritics."
            ),
            "gurmukhi": (
                "⚠️ GURMUKHI/PUNJABI UNICODE MANDATORY (U+0A00–U+0A7F):\n"
                "Output ONLY Gurmukhi Unicode characters.\n"
                "CRITICAL: ੰ (tippi, RIGHT) ≠ ਂ (bindi, LEFT) | ੱ (addak) NEVER drop | ਣ ≠ ਨ | ਲ਼ ≠ ਲ."
            ),
            "kannada": (
                "⚠️ KANNADA UNICODE MANDATORY (U+0C80–U+0CFF):\n"
                "Output ONLY Kannada Unicode characters.\n"
                "CRITICAL: ್ (virama) NEVER drop | ಳ ≠ ಲ (bar is critical) | ಷ ≠ ಸ | ಣ ≠ ನ."
            ),
            "bengali": (
                "CRITICAL Bengali confusables — transcribe letter by letter:\n"
                "  ্ (hasanta) NEVER drop | ং ≠ ঁ ≠ ঃ | ছ ≠ হ ≠ ট | ড ≠ ভ | ৎ ≠ ফ | ঐ ≠ এ."
            ),
            "tamil": (
                "CRITICAL Tamil confusables:\n"
                "  ் (pulli) NEVER drop | ல ≠ ள ≠ ழ | ண ≠ ந ≠ ன | ற ≠ ர | vowel length matters."
            ),
            "devanagari": (
                "CRITICAL Devanagari confusables:\n"
                "  ् (halant) NEVER drop | ं ≠ ँ | ि (LEFT) ≠ ी (RIGHT) | ण ≠ न | ष ≠ श."
            ),
        }

        script_rule = _SCRIPT_RULES.get(script_display.lower(), "")

        if direction == "rtl":
            ocr_prompt = (
                f"You are a precise text extraction engine for {lang_display} (right-to-left script).\n"
                "Transcribe ALL text visible in this image EXACTLY as printed.\n"
                "Rules:\n"
                "• Read every line RIGHT TO LEFT.\n"
                "• Preserve every diacritic, hamza, and nukta exactly.\n"
                "• Do NOT translate, summarize, or reorder.\n"
                "• Output ONLY the raw transcribed text, line by line.\n"
                + (f"\n{script_rule}\n" if script_rule else "")
            )
        else:
            ocr_prompt = (
                f"You are a precise text extraction engine for {lang_display} ({script_display} script).\n"
                "Transcribe ALL text visible in this image EXACTLY as printed.\n"
                "Rules:\n"
                "• Preserve every diacritic, matra, virama, anusvara, pulli, and vowel sign exactly.\n"
                "• Do NOT translate, summarize, reformat, or add structure.\n"
                "• Output ONLY the raw transcribed text, line by line, top to bottom.\n"
                "• Preserve question numbers exactly as printed.\n"
                + (f"\n{script_rule}\n" if script_rule else "")
            )

        # Choose model: Pro for hard legacy scripts, Flash for everything else
        from bulletproof.constants import MODEL_FLASH, MODEL_PRO
        use_pro   = script_display.lower() in _PRO_SCRIPTS
        ocr_model = MODEL_PRO if use_pro else MODEL_FLASH
        timeout   = 150.0 if use_pro else 45.0

        client = genai.Client(api_key=get_next_key())

        def _call():
            return client.models.generate_content(
                model=ocr_model,
                contents=[pil_img, ocr_prompt],
                config=types.GenerateContentConfig(temperature=0.0, max_output_tokens=2048 if use_pro else 1024)
            )

        import asyncio as _asyncio
        async with SCAN_TEXT_AI_SEMAPHORE:
            res = await _asyncio.wait_for(_asyncio.to_thread(_call), timeout=timeout)
        extracted_text = (res.text or "").strip()

        # Safety check: if Pro returned empty or pure ASCII for a regional script,
        # retry with explicit Unicode-range instruction
        if use_pro and extracted_text:
            import re as _re
            ascii_ratio = len(_re.findall(r'[a-zA-Z]', extracted_text)) / max(len(extracted_text), 1)
            if ascii_ratio > 0.5:
                # More than 50% ASCII in a regional script response → model output garbage
                # Retry with stronger Unicode-force prompt
                force_prompt = (
                    f"OCR this image. Output ONLY {lang_display} Unicode text.\n"
                    "Do NOT output any Latin letters, English words, or descriptions.\n"
                    "If you see a character you are not sure about, output your best Unicode guess.\n"
                    + (script_rule or "")
                )
                def _retry():
                    return client.models.generate_content(
                        model=MODEL_PRO,
                        contents=[pil_img, force_prompt],
                        config=types.GenerateContentConfig(temperature=0.0)
                    )
                try:
                    async with SCAN_TEXT_AI_SEMAPHORE:
                        retry_res = await _asyncio.wait_for(_asyncio.to_thread(_retry), timeout=90.0)
                    retry_text = (retry_res.text or "").strip()
                    if retry_text:
                        extracted_text = retry_text
                except Exception:
                    pass  # keep original result if retry fails

        return {
            "text":   extracted_text,
            "chars":  len(extracted_text),
            "model":  ocr_model,
            "status": "ok",
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text extraction failed: {str(e)}")

register_scan(app, get_next_key, redis_client)

if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8091")))
    args = parser.parse_args()
    uvicorn.run(app, host="0.0.0.0", port=args.port)
