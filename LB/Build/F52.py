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
import random
import multiprocessing
from datetime import datetime
from PIL import Image
from typing import List, Optional, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Request, Form
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from google import genai
from google.genai import types
from dotenv import load_dotenv

import redis.asyncio as aioredis

load_dotenv()

# ==========================================
# MULTI-KEY POOL CONFIGURATION
# ==========================================
raw_keys = os.getenv("GEMINI_API_KEYS", os.getenv("GEMINI_API_KEY", "DUMMY_KEY"))
API_KEYS = [k.strip() for k in raw_keys.split(",") if k.strip()]

if not API_KEYS or API_KEYS == ["DUMMY_KEY"]:
    print("⚠️  WARNING: No valid GEMINI_API_KEYS found. Set them in your .env file.")
    API_KEYS = ["DUMMY_KEY"]

_key_cycle = itertools.cycle(API_KEYS)
_key_lock  = threading.Lock()

def get_next_key() -> str:
    """Thread-safe round-robin key rotation."""
    with _key_lock:
        return next(_key_cycle)

print(f"✅  Key pool loaded: {len(API_KEYS)} key(s) available for rotation.")

# ==========================================
# STATE MANAGEMENT
# ==========================================
redis_client = None

async def get_job_state(job_id):
    if not redis_client: return None
    data = await redis_client.get(f"job:{job_id}")
    return json.loads(data) if data else None

async def save_job_state(job_id, state):
    if redis_client:
        await redis_client.set(f"job:{job_id}", json.dumps(state))

async def delete_job_state(job_id):
    if redis_client:
        await redis_client.delete(f"job:{job_id}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_db = os.getenv("REDIS_DB", "0")
    redis_client = aioredis.from_url(f"redis://localhost:6379/{redis_db}", decode_responses=True)
    os.makedirs("workspace", exist_ok=True)
    yield
    await redis_client.aclose()

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/workspace/{file_path:path}")
async def serve_workspace_files(file_path: str):
    full_path = os.path.join("workspace", file_path)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(full_path, headers={"Access-Control-Allow-Origin": "*"})

if os.path.exists("build"):
    app.mount("/static", StaticFiles(directory="build/static"), name="static")
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        if full_path.startswith("workspace/"): 
            raise HTTPException(status_code=404)
        return FileResponse("build/index.html")

async def log_to_client(job_id, text, log_type="info", data=None):
    if not redis_client: return
    payload = {"type": log_type, "text": text}
    if data is not None: payload["data"] = data
    await redis_client.publish(f"logs:{job_id}", json.dumps(payload))

def get_base_name(filename):
    match = re.search(r'^(?:qp|ms|QP|MS)_(.*?)(?:_[a-zA-Z0-9]{15,})?\.pdf$', filename)
    base = match.group(1) if match else filename.replace('.pdf', '')
    base = base.replace('.pdf', '').replace('.PDF', '')
    return re.sub(r'[^a-zA-Z0-9_]', '', base) or "Document"

def normalize_qno(qno): return re.sub(r'[^0-9a-zA-Z]', '', str(qno)).lower()    

def extract_json_from_text(raw_text):
    match = re.search(r'```json\n(.*?)```', raw_text, re.DOTALL)
    if match: return match.group(1)
    if raw_text.strip().startswith('{') or raw_text.strip().startswith('['): return raw_text
    return raw_text

def strip_bullets(text):
    if not text: return text
    cleaned = str(text).replace('_x000d_', '').replace('\r', '')
    cleaned = re.sub(r'^\s*\([a-zivx]+\)\s*|^\s*[a-zivx]+\)\s*', '', cleaned, flags=re.IGNORECASE)
    return cleaned.strip()

def format_mode(mode_str, has_img):
    if has_img: return "Image"
    if not mode_str: return "General"
    m = str(mode_str).lower()
    if "image" in m: return "Image"
    if "mcq" in m or "general" in m or "text" in m: return "General"
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

# ==========================================
# PYDANTIC SCHEMAS
# ==========================================
class DocumentProfile(BaseModel):
    qp_subject_or_code: str = Field(description="Subject name or code.")
    ms_subject_or_code: str = Field(description="Subject name or code.")
    is_matching_pair: bool = Field(description="True ONLY if QP and MS belong to the exact same subject and exam.")
    primary_language: str = Field(description="The primary language detected.")

class ParsedQuestion(BaseModel):
    is_actual_test_question: bool = Field(description="Strictly True for exam questions. FALSE for instructions.")
    q_sno: str = Field(description="Question Number. Do NOT include sub-parts here.")
    question_type: str = Field(description="standard")
    parent_q_sno: str = Field(default="")
    mode_of_question: str = Field(default="general - General MCQ")
    objective_type: str = Field(description="MUST BE EXACTLY ONE: '1 Mark (MCQ)', '1x2=2 Marks (with two sub-points)', 'Fill in the blanks', 'match the column', 'paragraph or case-based questions', 'one-word questions', 'True False', 'Flow Chart', 'Diagram Based', 'Map-Based', 'None'")
    type_of_question: str = Field(default="Objective-Type Questions", description="MUST BE EXACTLY ONE: 'Objective-Type Questions', '1 Mark (MCQ)', 'Very Short Answer (VSA)', 'Short Answer (SA)', 'Long Answer Type (LA)', 'Skill (Map)'")
    question_header: str = Field(description="Headers like 'SECTION A'.")
    question_text_english: str = Field(description="The FULL English text of the question. Combine all sub-parts (a, b, c) into this single text box.")
    justification_for_crop: str = Field(default="None", description="Describe the visual drawing. If text/math, write 'None'.")
    requires_crop: bool = Field(description="FALSE for text/math. TRUE ONLY for actual visual diagrams.")
    crop_box_2d: Optional[List[int]] = None
    option_1_english: str = Field(default="")
    opt1_requires_crop: bool = Field(default=False)
    opt1_crop_box: Optional[List[int]] = None
    opt1_mode: str = Field(default="general - MCQ type")
    option_2_english: str = Field(default="")
    opt2_requires_crop: bool = Field(default=False)
    opt2_crop_box: Optional[List[int]] = None
    opt2_mode: str = Field(default="general - MCQ type")
    option_3_english: str = Field(default="")
    opt3_requires_crop: bool = Field(default=False)
    opt3_crop_box: Optional[List[int]] = None
    opt3_mode: str = Field(default="general - MCQ type")
    option_4_english: str = Field(default="")
    opt4_requires_crop: bool = Field(default=False)
    opt4_crop_box: Optional[List[int]] = None
    opt4_mode: str = Field(default="general - MCQ type")
    marks: str = Field(default="")
    blooms_taxonomy: str = Field(default="Understanding", description="Strictly choose ONE: 'Knowledge', 'Understanding', 'Application'")
    difficulty_level: str = Field(default="Medium")
    lesson_module: str = Field(default="")
    chapter: str = Field(default="")

class PageExtractionResult(BaseModel):
    detected_question_numbers: List[str] = Field(description="List EVERY question individually.")
    language_detected: str = ""
    subject_name: str = ""
    subject_code: str = ""
    class_grade: str = ""
    questions: List[ParsedQuestion]

class AnswerKeyItem(BaseModel):
    q_sno: str = Field(default="", description="Question number. Do NOT include sub-parts here.")
    correct_option_letter: str = Field(default="", description="If MCQ, output single letter (A, B, C, D). If subjective, leave BLANK.")
    full_answer_text: str = Field(default="", description="FULL text of ENGLISH answer. Combine all sub-answers here.")
    marks_awarded: str = Field(default="")
    justification_for_crop: str = Field(default="None")
    requires_crop: bool = Field(description="FALSE for math/text. TRUE ONLY for actual drawn visual diagrams.")
    diagram_flag: bool = Field(default=False)
    crop_box_2d: Optional[List[int]] = None

class AnswerKeyPage(BaseModel):
    detected_question_numbers: List[str] = Field(description="List EVERY question individually.")
    answers: List[AnswerKeyItem]

# ==========================================
# EXTRACTION FUNCTIONS
# ==========================================
async def scout_document_profile(job_id: str, qp_doc: fitz.Document, ms_doc: fitz.Document) -> DocumentProfile:
    await log_to_client(job_id, f"   ↳ [PHASE 1] Initializing Core Vision Processor...", "info")
    prompt = "Analyze these pages. Extract Subject Name and Code."
    images = [Image.open(io.BytesIO(qp_doc[0].get_pixmap(matrix=fitz.Matrix(1.0, 1.0)).tobytes("jpeg", 85)))]
    
    for attempt in range(4):
        client = genai.Client(api_key=get_next_key())
        try:
            def _generate():
                return client.models.generate_content(
                    model='gemini-2.5-pro', contents=images + [prompt],
                    config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=DocumentProfile, temperature=0.1)
                )
            res = await asyncio.wait_for(asyncio.to_thread(_generate), timeout=240.0)
            parsed = json.loads(extract_json_from_text(res.text))
            recursively_clean_nulls(parsed)
            return DocumentProfile(**parsed)
        except asyncio.TimeoutError:
            await log_to_client(job_id, f"      ⏳ [TIMEOUT] Google's server ghosted us. Retrying with next key...", "warning")
            continue
        except Exception as e:
            err = str(e).lower()
            if "503" in err:
                await log_to_client(job_id, f"      ⏳ Google server overloaded (503). Retrying in 15s...", "warning")
                await asyncio.sleep(15)
                continue
            elif "429" in err or "quota" in err or "rate" in err or "exhaust" in err:
                await log_to_client(job_id, f"      🔄 Rate Limited (429) on this key. Rotating to next key...", "warning")
                continue
            else:
                continue
                
    await log_to_client(job_id, "      ⚠️ Failed to scout profile after 4 attempts. Using Defaults.", "warning")
    return DocumentProfile(qp_subject_or_code="Unknown", ms_subject_or_code="Unknown", is_matching_pair=True, primary_language="English")


async def extract_page_vision(job_id: str, page: fitz.Page, page_num: int, profile: DocumentProfile):
    job_state = await get_job_state(job_id)
    if job_state and job_state.get("cancel_requested"): return {}
    
    local_raw_text = page.get_text("text").strip()
    alpha_text = re.sub(r'[^a-zA-Z]', '', local_raw_text)
    is_scanned_image = len(alpha_text) < 30
    
    if not is_scanned_image:
        grounding_rule = "STRICT TEXT GROUNDING: I am providing the EXACT extracted text below. Use the image ONLY to understand the layout and geometry for cropping. You MUST rely heavily on the provided LOCAL RAW TEXT. Do not hallucinate words."
        text_block = f"LOCAL RAW TEXT:\n\"\"\"{local_raw_text}\"\"\""
        base_zoom = 1.5
    else:
        grounding_rule = "VISION TRANSCRIBER MODE (CRITICAL): This is a scanned image. There is NO raw text provided. You MUST act as a human transcriber. Manually read, type out, and transcribe the FULL English question text and English options directly from the image into the JSON fields. NEVER leave fields blank if text is visible."
        text_block = "LOCAL RAW TEXT: [EMPTY - SCANNED DOCUMENT. YOU MUST TRANSCRIBE FROM THE HIGH-RESOLUTION IMAGE]"
        base_zoom = 3.0
    
    base_prompt = f"""
    ROLE: Expert English-Medium Exam Data Extractor.
    YOU ARE A DEEP REASONING ENGINE. 
    
    CRITICAL RULES:
    1. BILINGUAL PURGE: STRICTLY IGNORE ALL HINDI SCRIPT (Devanagari). Only extract the English text.
    2. {grounding_rule}
    3. SMART GROUPING (NO OPTIONS): If a reading passage or main instruction is followed by sub-questions (e.g., (i), (ii)) that DO NOT have multiple-choice options, combine the passage and ALL sub-questions into a SINGLE question JSON object. You MUST format it vertically using newline characters (\\n). 
       WRONG: "Passage... (i) text (ii) text"
       CORRECT: "Passage...\\n(i) text\\n(ii) text"
    4. SMART SPLITTING (WITH OPTIONS): If the sub-questions HAVE multiple-choice options (A, B, C, D), you MUST split them into separate JSON objects. Place the reading passage into the `question_header` field, and put each sub-question into its own row so its options can be mapped correctly.
    5. QUESTION NUMBERING: Extract the EXACT Arabic numeral printed for the English question. Do not guess.
    6. NO LATEX ALLOWED: Write all math using standard human-readable keyboard text with Unicode.
    7. THE PHANTOM '1' BUG: Ignore stray numbers like page numbers.
    8. DO NOT BE LAZY: If you see a question in the image, you MUST type out its text in the `question_text_english` field.
    
    EXPECTED JSON STRUCTURE EXAMPLE (Grouped Sub-Questions):
    {{
      "detected_question_numbers": ["6"],
      "questions": [
        {{
          "is_actual_test_question": true,
          "q_sno": "6",
          "question_header": "",
          "question_text_english": "Read the passage:\\nThis is a story.\\n(i) What happened?\\n(ii) Why did it happen?",
          "requires_crop": false
        }}
      ]
    }}

    {text_block}
    """
    
    has_images = len(page.get_images()) > 0
    final_zoom = base_zoom if not has_images else max(base_zoom, 1.5)
    pil_img = Image.open(io.BytesIO(page.get_pixmap(matrix=fitz.Matrix(final_zoom, final_zoom)).tobytes("jpeg", 85)))
    
    current_model_name = "gemini-2.5-flash"
    
    for attempt in range(5):
        client = genai.Client(api_key=get_next_key())
        try:
            await log_to_client(job_id, f"      📡 [QP Pg {page_num}] Uploading DATA...", "info")
            def _generate():
                return client.models.generate_content(
                    model=current_model_name, contents=[pil_img, base_prompt],
                    config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=PageExtractionResult, temperature=0.1)
                )
            res = await asyncio.wait_for(asyncio.to_thread(_generate), timeout=240.0)
            await log_to_client(job_id, f"      ✅ [QP Pg {page_num}] API returned data successfully.", "success")
            raw_text = extract_json_from_text(res.text)
            
            if not raw_text or len(raw_text.strip()) == 0: 
                raise ValueError("validation: empty response")
                
            safe_json_text = re.sub(r'(?<!\\)\\(?![nrt"\\/])', r'\\\\', raw_text)
            parsed_data = json.loads(safe_json_text)
            recursively_clean_nulls(parsed_data)
            
            if current_model_name == "gemini-2.5-flash":
                extracted_qs = len([q for q in parsed_data.get('questions', []) if q.get('is_actual_test_question')])
                if extracted_qs == 0 and len(alpha_text) > 30:
                    raise ValueError(f"validation: complete extraction failure (0 questions)")
                
                for q in parsed_data.get('questions', []):
                    if q.get('is_actual_test_question'):
                        q_sno_str = str(q.get('q_sno', '')).strip()
                        if not q_sno_str:
                            raise ValueError("validation: missing q_sno")
                        if not re.search(r'\d', q_sno_str):
                            raise ValueError(f"validation: {q_sno_str} is a sub-bullet, not a main question")
            
            return parsed_data
            
        except asyncio.TimeoutError:
            await log_to_client(job_id, f"      ⏳ [TIMEOUT] QP Page {page_num}. Rotating key and retrying...", "warning")
            continue
        except Exception as e:
            err = str(e).lower()
            if "503" in err:
                await log_to_client(job_id, f"      ⏳ [QP Pg {page_num}] server overloaded (503). Retrying in 15s...", "warning")
                await asyncio.sleep(15)
                continue
            elif "429" in err or "quota" in err or "rate" in err or "exhaust" in err:
                await log_to_client(job_id, f"      🔄 [QP Pg {page_num}] Rate Limited (429). Rotating to next key...", "warning")
                continue
            elif "format" in err or "schema" in err or "validation" in err or "json" in err:
                if current_model_name == "gemini-2.5-flash":
                    await log_to_client(job_id, f"      🔄 Flash failed audit on QP Page {page_num}. Escalating to Pro...", "warning")
                    current_model_name = "gemini-2.5-pro"
                    continue 
                else:
                    if attempt >= 4:
                        await log_to_client(job_id, f"      ⚠️ Failed to parse QP page {page_num} even with Pro. Bypassing.", "warning")
                        return {}
                    continue
            else:
                if attempt >= 4: return {}
                await asyncio.sleep(2)
                continue
    return {}


async def extract_answer_key(job_id: str, ms_doc: fitz.Document, doc_images_dir: str, ms_ui_pages_dir: str, base_name: str, profile: DocumentProfile, target_set: str, sub_code: str, ms_pages_to_scan: list) -> tuple:
    
    await log_to_client(job_id, f"   ↳ 📋 MS AI Extraction Disabled. Preparing MS pages for manual review...", "info")
    
    for page_num in range(len(ms_doc)):
        page = ms_doc[page_num]
        ms_ui_filename = f"ms_page_{page_num + 1}.png"
        ms_ui_path = os.path.join(ms_ui_pages_dir, ms_ui_filename)
        page.get_pixmap(matrix=fitz.Matrix(4, 4)).save(ms_ui_path, "jpeg", 85)
    return {}, {}

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
        
        sc_prefix = f"{subject_code}_" if subject_code else ""
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
    try:
        job_state = await get_job_state(job_id)
        if not job_state: return
        
        await log_to_client(job_id, f"Initializing Engine Core for SET {target_set}...", "info")
        await log_to_client(job_id, "5", "progress")
        
        if not job_state.get("qp_doc_path") and files_info:
            pairs = {}
            for f in files_info:
                base = get_base_name(f['name'])
                if base not in pairs: pairs[base] = {}
                if f['name'].lower().startswith('qp'): pairs[base]['qp'] = f['path']
                if f['name'].lower().startswith('ms'): pairs[base]['key'] = f['path']
            
            valid_pair_found = False
            for b_name, paths in pairs.items():
                if 'qp' not in paths or 'key' not in paths: continue
                ms_doc, qp_doc = fitz.open(paths['key']), fitz.open(paths['qp'])
                doc_profile = await scout_document_profile(job_id, qp_doc, ms_doc)
                
                valid_pair_found = True
                job_state["qp_doc_path"] = paths['qp']
                job_state["ms_doc_path"] = paths['key']
                job_state["base_name"] = b_name
                job_state["doc_profile"] = doc_profile.model_dump()
                ms_doc.close()
                qp_doc.close()
                break 
                
            if not valid_pair_found:
                await log_to_client(job_id, "No valid pairs found. Halting Engine.", "error")
                await log_to_client(job_id, "ALL_DONE", "system_control")
                return
            await save_job_state(job_id, job_state)
            
        base_name = job_state["base_name"]
        doc_images_dir = os.path.join(job_folder, "images", base_name)
        ui_pages_dir = os.path.join(job_folder, "ui_pages", base_name)
        ms_ui_pages_dir = os.path.join(job_folder, "ms_ui_pages", base_name)
        
        os.makedirs(doc_images_dir, exist_ok=True)
        os.makedirs(ui_pages_dir, exist_ok=True)
        os.makedirs(ms_ui_pages_dir, exist_ok=True)
        
        qp_doc = fitz.open(job_state["qp_doc_path"])
        ms_doc = fitz.open(job_state["ms_doc_path"])
        doc_profile = DocumentProfile(**job_state["doc_profile"])
        
        raw_code = str(doc_profile.qp_subject_or_code)
        match_code = re.search(r'\b\d{3}\b', raw_code)
        sub_code = match_code.group(0) if match_code else re.sub(r'[^a-zA-Z0-9]', '', raw_code)[:3]

        await log_to_client(job_id, "⏳ Taking a breather to align models...", "warning")
        await asyncio.sleep(3)
        
        job_state = await get_job_state(job_id)
        if job_state.get("cancel_requested"): return
        
        job_state["set_boundaries"] = {"A": 0, "B": -1, "C": -1}
        for p_num in range(len(qp_doc)):
            page_text = qp_doc[p_num].get_text("text").upper()
            if re.search(r'SET.{0,15}\bB\b', page_text) and job_state["set_boundaries"]["B"] == -1: 
                job_state["set_boundaries"]["B"] = p_num
            if re.search(r'SET.{0,15}\bC\b', page_text) and job_state["set_boundaries"]["C"] == -1: 
                job_state["set_boundaries"]["C"] = p_num
        
        if job_state["set_boundaries"]["B"] == -1 and len(qp_doc) > 30:
            pages_per_set = len(qp_doc) // 3
            job_state["set_boundaries"]["B"] = pages_per_set
            job_state["set_boundaries"]["C"] = pages_per_set * 2
            
        await save_job_state(job_id, job_state)

        ms_pages_to_scan = list(range(len(ms_doc))) 
        ms_b_start, ms_c_start = -1, -1
        for p_num in range(len(ms_doc)):
            page_text = ms_doc[p_num].get_text("text").upper()
            if re.search(r'\n\s*SET\s*[-_]?\s*B\s*\n', page_text) or re.search(r'MARKING SCHEME.{0,15}\bB\b', page_text):
                if ms_b_start == -1 and p_num > 1: ms_b_start = p_num
            if re.search(r'\n\s*SET\s*[-_]?\s*C\s*\n', page_text) or re.search(r'MARKING SCHEME.{0,15}\bC\b', page_text):
                if ms_c_start == -1 and p_num > 1: ms_c_start = p_num
                
        if ms_b_start != -1:
            if target_set == "A": ms_pages_to_scan = list(range(0, ms_b_start))
            elif target_set == "B": ms_pages_to_scan = list(range(ms_b_start, ms_c_start if ms_c_start != -1 else len(ms_doc)))
            elif target_set == "C" and ms_c_start != -1: ms_pages_to_scan = list(range(ms_c_start, len(ms_doc)))
        
        await log_to_client(job_id, f"   ↳ MS Boundary Logic: Locked {len(ms_pages_to_scan)} pages for MS SET {target_set}.", "system_control")

        ms_answers, ms_images = await extract_answer_key(
            job_id, ms_doc, doc_images_dir, ms_ui_pages_dir, base_name, doc_profile, target_set, sub_code, ms_pages_to_scan
        )
        
        set_boundaries = job_state["set_boundaries"]
        total_len = len(qp_doc)
        b_start = set_boundaries["B"] if set_boundaries["B"] != -1 else total_len
        c_start = set_boundaries["C"] if set_boundaries["C"] != -1 else total_len

        pages_a = b_start
        pages_b = c_start - b_start if set_boundaries["B"] != -1 else 0
        pages_c = total_len - c_start if set_boundaries["C"] != -1 else 0
        await log_to_client(job_id, f"Boundary Lock Active: Set A ({pages_a} pgs), Set B ({pages_b} pgs), Set C ({pages_c} pgs)", "system_control")
        
        if target_set == "A":
            end_page = set_boundaries["B"] if set_boundaries["B"] != -1 else len(qp_doc)
            pages_to_scan = list(range(0, end_page))
        elif target_set == "B":
            if set_boundaries["B"] == -1: pages_to_scan = []
            else:
                end_page = set_boundaries["C"] if set_boundaries["C"] != -1 else len(qp_doc)
                pages_to_scan = list(range(set_boundaries["B"], end_page))
        elif target_set == "C":
            if set_boundaries["C"] == -1: pages_to_scan = []
            else: pages_to_scan = list(range(set_boundaries["C"], len(qp_doc)))
        else: pages_to_scan = list(range(0, len(qp_doc)))
            
        total_pages_to_scan = len(pages_to_scan)
        if total_pages_to_scan > 0:
            await log_to_client(job_id, f"   ↳ Structural Boundary Logic: Locked {total_pages_to_scan} pages for SET {target_set}.", "system_control")
        
        await log_to_client(job_id, "", "page_map_init", {"total": total_pages_to_scan})

        doc_meta = {"language": "", "subject": "", "class": "", "code": sub_code}
        emergency_stop = False
        
        # ── Reduced batch size to avoid rate limits ──────────────────
        BATCH_SIZE = 3
        master_blueprint = set()
        processed_qnos = set()
        last_seen_ms_url = ""

        for i in range(0, total_pages_to_scan, BATCH_SIZE):
            job_state = await get_job_state(job_id) 
            if job_state.get("cancel_requested") or emergency_stop: break
                
            batch_pages = pages_to_scan[i : i + BATCH_SIZE]
            tasks = []
            
            for idx_offset, page_num in enumerate(batch_pages):
                current_idx = i + idx_offset
                progress_pct = int(30 + ((current_idx + 1) / total_pages_to_scan) * 70)
                await log_to_client(job_id, str(progress_pct), "progress")
                await log_to_client(job_id, "", "page_map_update", {"page": current_idx + 1, "status": "scanning"})
                
                page = qp_doc[page_num]
                ui_page_filename = f"page_{page_num + 1}.png"
                ui_page_path = os.path.join(ui_pages_dir, ui_page_filename)
                page.get_pixmap(matrix=fitz.Matrix(4, 4)).save(ui_page_path, "jpeg", 85)
                
                async def delayed_qp_extract(j_id, pg, p_num, prof):
                    return await extract_page_vision(j_id, pg, p_num, prof)

                tasks.append(asyncio.create_task(delayed_qp_extract(job_id, page, page_num + 1, doc_profile)))
            
            start_page = i + 1
            end_page_log = min(i + len(batch_pages), total_pages_to_scan)
            await log_to_client(job_id, f"   ↳ [SET {target_set}] Concurrently analyzing pages {start_page} to {end_page_log}...", "info")
            
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for idx_offset, page_res in enumerate(batch_results):
                if emergency_stop: break
                
                page_num = batch_pages[idx_offset]
                current_idx = i + idx_offset
                page_image_url = f"/workspace/{job_id}/ui_pages/{base_name}/page_{page_num + 1}.png"
                
                if isinstance(page_res, Exception):
                    continue 
                    
                if page_res:
                    for k in ["language_detected", "subject_name", "class_grade", "subject_code"]:
                        val = page_res.get(k)
                        target_key = k.split('_')[0]
                        if val and not doc_meta.get(target_key): doc_meta[target_key] = val
                        
                    if 'detected_question_numbers' in page_res:
                        for num in page_res['detected_question_numbers']:
                            clean_num = str(num).strip().lower()
                            if 'note' not in clean_num and 'instruction' not in clean_num:
                                master_blueprint.add(normalize_qno(clean_num))

                page_questions = page_res.get('questions', []) if page_res else []
                
                valid_for_crop = []
                valid_questions_to_process = []
                trashed_count = 0
                
                for q in page_questions:
                    if emergency_stop: break 

                    if not q.get('is_actual_test_question') or len(str(q.get('q_sno', ''))) == 0: 
                        trashed_count += 1
                        continue
                    
                    q_sno_str = str(q.get('q_sno', '')).strip()

                    justification = str(q.get('justification_for_crop', '')).strip().lower()
                    if 'none' in justification or justification == '':
                        q['requires_crop'] = False
                        q['opt1_requires_crop'] = False
                        q['opt2_requires_crop'] = False
                        q['opt3_requires_crop'] = False
                        q['opt4_requires_crop'] = False

                    valid_for_crop.append(q)
                    valid_questions_to_process.append(q)
                
                if trashed_count > 0:
                    job_state["stats"]["trash"] += trashed_count
                    await save_job_state(job_id, job_state) 
                    await log_to_client(job_id, "", "stats", job_state["stats"])

                if not valid_questions_to_process:
                    await log_to_client(job_id, "", "page_map_update", {"page": current_idx + 1, "status": "bypassed"})
                else:
                    await log_to_client(job_id, "", "page_map_update", {"page": current_idx + 1, "status": "done"})
                    
                ui_page_path = os.path.join(ui_pages_dir, f"page_{page_num + 1}.png")
                page_img_paths = await asyncio.to_thread(process_qp_crops_sync, ui_page_path, valid_for_crop, doc_images_dir, sub_code, base_name)

                for q in valid_questions_to_process:
                    q_sno_str = str(q.get('q_sno', '')).strip()
                    norm_qno = normalize_qno(q_sno_str)
                    composite_key = f"{target_set}_{norm_qno}"
                    
                    ms_data = ms_answers.get(composite_key, {})
                    ms_full_text = str(ms_data.get('full_answer_text', '')).strip()
                    
                    current_ms_url = ms_data.get('ms_page_url', '')
                    if current_ms_url: last_seen_ms_url = current_ms_url
                    else: ms_data['ms_page_url'] = last_seen_ms_url
                    
                    is_duplicate_flag = "No"
                    if target_set != "A" and ("same_as_set_a" in ms_full_text.lower() or "same as" in ms_full_text.lower() or "same" in ms_full_text.lower().split()):
                        job_state["stats"]["duplicates"] += 1
                        await save_job_state(job_id, job_state)
                        await log_to_client(job_id, "", "stats", job_state["stats"])
                        await log_to_client(job_id, f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️ Q{q_sno_str} is a duplicate of Set A. Flagged for review.", "warning")
                        is_duplicate_flag = "Yes"

                    processed_qnos.add(norm_qno)
                    
                    primary_ref = ms_data.get("primary_ref", norm_qno)
                    ms_img_name = ms_images.get(f"{target_set}_{normalize_qno(primary_ref)}", '')
                    
                    q_imgs = page_img_paths.get(composite_key, {})
                    q_eng = strip_bullets(str(q.get('question_text_english', '')).strip())
                    
                    o1_eng = strip_bullets(str(q.get('option_1_english', '')).strip())
                    o2_eng = strip_bullets(str(q.get('option_2_english', '')).strip())
                    o3_eng = strip_bullets(str(q.get('option_3_english', '')).strip())
                    o4_eng = strip_bullets(str(q.get('option_4_english', '')).strip())
                    
                    opt1_img, opt2_img, opt3_img, opt4_img = q_imgs.get('opt1', ''), q_imgs.get('opt2', ''), q_imgs.get('opt3', ''), q_imgs.get('opt4', '')
                    num_options = sum([bool(o1_eng or opt1_img), bool(o2_eng or opt2_img), bool(o3_eng or opt3_img), bool(o4_eng or opt4_img)])

                    ms_letter_raw = str(ms_data.get('correct_option_letter', '')).strip().upper()
                    
                    ms_letter = ""
                    correct_idx = 0
                    
                    if num_options == 0:
                        is_mcq = False
                        correct_idx = 1
                        if ms_full_text and "same as" not in ms_full_text.lower(): 
                            o1_eng = ms_full_text
                    else:
                        is_mcq = True
                        match = re.search(r'\b([A-D])\b', ms_letter_raw.replace('.', ' '))
                        if match: ms_letter = match.group(1)
                        else:
                            match_any = re.search(r'[A-D]', ms_letter_raw)
                            ms_letter = match_any.group() if match_any else ''
                        
                        correct_idx = {'A':1, 'B':2, 'C':3, 'D':4}.get(ms_letter, 0)
                        
                        if correct_idx == 0 and ms_full_text:
                            ms_clean = re.sub(r'[^a-zA-Z0-9]', '', ms_full_text.lower())
                            if ms_clean:
                                if o1_eng and re.sub(r'[^a-zA-Z0-9]', '', o1_eng.lower()) in ms_clean: correct_idx = 1
                                elif o2_eng and re.sub(r'[^a-zA-Z0-9]', '', o2_eng.lower()) in ms_clean: correct_idx = 2
                                elif o3_eng and re.sub(r'[^a-zA-Z0-9]', '', o3_eng.lower()) in ms_clean: correct_idx = 3
                                elif o4_eng and re.sub(r'[^a-zA-Z0-9]', '', o4_eng.lower()) in ms_clean: correct_idx = 4

                    final_marks = str(ms_data.get('marks_awarded', '')).strip()
                    if not final_marks: final_marks = str(q.get('marks', '')).strip()

                    calc_marks = final_marks.lower().replace('½', '0.5').replace('¼', '0.25')
                    try: m_val = sum(float(x) for x in calc_marks.split('+') if x.strip())
                    except: m_val = 1.0 
                    
                    if m_val <= 2: comp = "Easy"
                    elif m_val >= 5: comp = "Hard"
                    else: comp = "Medium"

                    if num_options > 0 or is_mcq:
                        final_q_type = "1 Mark (MCQ)"
                        final_obj_type = "1 Mark (MCQ)"
                    else:
                        q_type_raw = str(q.get('type_of_question', '')).lower()
                        if 'mcq' in q_type_raw or '1 mark' in q_type_raw: final_q_type = "1 Mark (MCQ)"
                        elif 'very short' in q_type_raw or 'vsa' in q_type_raw: final_q_type = "Very Short Answer (VSA)"
                        elif 'long' in q_type_raw or 'la' in q_type_raw: final_q_type = "Long Answer Type (LA)"
                        elif 'skill' in q_type_raw or 'map' in q_type_raw: final_q_type = "Skill (Map)"
                        elif 'short' in q_type_raw or 'sa' in q_type_raw: final_q_type = "Short Answer (SA)"
                        else: final_q_type = "Objective-Type Questions"

                        obj_raw = str(q.get('objective_type', '')).lower()
                        if 'fill' in obj_raw or 'blank' in obj_raw: final_obj_type = "Fill in the blanks"
                        elif 'match' in obj_raw: final_obj_type = "match the column"
                        elif 'paragraph' in obj_raw or 'case' in obj_raw: final_obj_type = "paragraph or case-based questions"
                        elif 'one-word' in obj_raw or 'one word' in obj_raw: final_obj_type = "one-word questions"
                        elif 'true' in obj_raw or 'false' in obj_raw: final_obj_type = "True False"
                        elif 'flow' in obj_raw: final_obj_type = "Flow Chart"
                        elif 'diagram' in obj_raw: final_obj_type = "Diagram Based"
                        elif 'map' in obj_raw: final_obj_type = "Map-Based"
                        elif '1x2' in obj_raw: final_obj_type = "1x2=2 Marks (with two sub-points)"
                        elif 'mcq' in obj_raw: final_obj_type = "1 Mark (MCQ)"
                        else: final_obj_type = "None"

                    raw_bloom = str(q.get('blooms_taxonomy', 'Understanding')).strip().title()
                    if "Rememb" in raw_bloom or "Know" in raw_bloom: final_bloom = "Knowledge"
                    elif "App" in raw_bloom: final_bloom = "Application"
                    else: final_bloom = "Understanding"

                    ms_has_diagram = ms_data.get('diagram_flag', False) or ms_data.get('requires_crop', False)
                    needs_manual_crop = "Yes" if (ms_has_diagram and not q_imgs.get('main')) else "No"
                    
                    if q_imgs.get('main') or ms_img_name: job_state["stats"]["diagrams"] += 1

                    ans_display = ms_letter if (is_mcq and ms_letter) else "Descriptive -> Opt1"
                    log_msg = f"[{datetime.now().strftime('%H:%M:%S')}] ✓ Processed Q{q_sno_str} | Marks: {final_marks} | Options: {num_options} | Answer: {ans_display}"
                    await log_to_client(job_id, log_msg, "success")

                    confidence_score = 100
                    if not q_eng.strip():
                        confidence_score -= 40
                    if is_mcq and num_options < 2:
                        confidence_score -= 30
                    if not ms_letter and is_mcq:
                        confidence_score -= 15
                    if q_imgs.get('main') and 'diagram' not in q_eng.lower() and 'figure' not in q_eng.lower():
                        confidence_score -= 10
                    final_confidence = max(0, confidence_score)

                    job_state["parsed_data"].append({
                        "Sl.No": q_sno_str,
                        "Class": doc_meta.get("class", ""),
                        "Subject Name": doc_meta.get("subject", ""),
                        "Subject Code": doc_meta.get("code", ""),
                        "SET Name": target_set,
                        "Lesson/Module": q.get('lesson_module', ''),
                        "Chapter": q.get('chapter', ''),
                        "Translate Language": "English",
                        "Question Mode (Mandatory)": format_mode(q.get('mode_of_question'), bool(q_imgs.get('main'))),
                        "Question text(Mandatory)": q_eng,
                        "Question Type (Mandatory)": "Standard", 
                        "Question Translate": "", "Question Translate Image": "", 
                        "If Question is Image, Specify Image Name": q_imgs.get('main', ''),
                        "Marks (Mandatory)": final_marks, "Negative Marks": "",
                        "No. of Options/Blanks (Mandatory)": str(num_options) if is_mcq else "0",
                        "Repeat Question Id (Optional)": "",
                        "Option1 Mode (Mandatory)": format_mode(q.get('opt1_mode'), bool(opt1_img)),
                        "Option1 (Mandatory)": o1_eng, "Option1 Translate": "", "Option1 Translate Image": "",
                        "If Option1 is Image, Specify Image Name": opt1_img, "Option1 Is Correct?": "Yes" if correct_idx == 1 or not is_mcq else "No",
                        "Option2 Mode (Mandatory)": format_mode(q.get('opt2_mode'), bool(opt2_img)),
                        "Option2 (Mandatory)": o2_eng, "Option2 Translate": "", "Option2 Translate Image": "",
                        "If Option2 is Image, Specify Image Name": opt2_img, "Option2 Is Correct?": "Yes" if correct_idx == 2 else ("No" if is_mcq else ""),
                        "Option3 Mode (Mandatory)": format_mode(q.get('opt3_mode'), bool(opt3_img)),
                        "Option3 (Mandatory)": o3_eng, "Option3 Translate": "", "Option3 Translate Image": "",
                        "If Option3 is Image, Specify Image Name": opt3_img, "Option3 Is Correct?": "Yes" if correct_idx == 3 else ("No" if is_mcq else ""),
                        "Option4 Mode (Mandatory)": format_mode(q.get('opt4_mode'), bool(opt4_img)),
                        "Option4 (Mandatory)": o4_eng, "Option4 Translate": "", "Option4 Translate Image": "",
                        "If Option4 is Image, Specify Image Name": opt4_img, "Option4 Is Correct?": "Yes" if correct_idx == 4 else ("No" if is_mcq else ""),
                        "Option5 Mode (Mandatory)": "", "Option5 (Mandatory)": "", "Option5 Translate": "", "Option5 Translate Image": "", "If Option5 is Image, Specify Image Name": "", "Option5 Is Correct?": "",
                        "Option6 Mode (Mandatory)": "", "Option6 (Mandatory)": "", "Option6 Translate": "", "Option6 Translate Image": "", "If Option6 is Image, Specify Image Name": "", "Option6 Is Correct?": "",
                        "IsNestedMainQuestionType": "No", "NoofNestedQuestions": "", "Parent Question No(if it is nested sub question)": "",
                        "NIOS Filename": f"{base_name}.pdf",
                        "Question Complexity": comp,
                        "Objective Type Questions": final_obj_type,
                        "Question Header": q.get('question_header', ''),
                        "Answer_Diagram_Image": ms_img_name,
                        "Bloom's Taxonomy": final_bloom,
                        "Type of question (Mandatory)": final_q_type,
                        "Duplicate_Flag": is_duplicate_flag,
                        "MS_Diagram_Flag": needs_manual_crop,
                        "Page_Number": str(page_num + 1),       
                        "Page_Image_URL": page_image_url,
                        "MS_Page_Image_URL": ms_data.get('ms_page_url', ''),
                        "Extraction_Confidence": str(final_confidence),
                        "Is_Verified": "No"
                    })
                    job_state["stats"]["parsed"] = len(job_state["parsed_data"])
                    
                await save_job_state(job_id, job_state)
                await log_to_client(job_id, "", "stats", job_state["stats"])

        ms_doc.close()
        qp_doc.close()

        if not job_state.get("cancel_requested"):
            job_state["completed_sets"].append(target_set)
            target_ext = job_state.get("target_extraction", "ALL")
            
            if target_ext != "ALL":
                await save_job_state(job_id, job_state)
                await log_to_client(job_id, "ALL_DONE", "system_control")
            else:
                if target_set == "A" and job_state["set_boundaries"]["B"] == -1:
                    job_state["completed_sets"].extend(["B", "C"])
                    await save_job_state(job_id, job_state)
                    await log_to_client(job_id, "ALL_DONE", "system_control") 
                elif target_set == "B" and job_state["set_boundaries"]["C"] == -1:
                    if "C" not in job_state["completed_sets"]: job_state["completed_sets"].append("C")
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
        error_msg = str(e).lower()
        if "429" in error_msg or "quota" in error_msg or "rate" in error_msg or "503" in error_msg: 
            safe_error = "Server traffic limit reached. Engine cooling down."
        elif "api_key" in error_msg or "unauthorized" in error_msg: safe_error = "System configuration error."
        else: safe_error = f"Engine disruption: {str(e)}"
        await log_to_client(job_id, safe_error, "error")
        await log_to_client(job_id, "ALL_DONE", "system_control")

# ==========================================
# FASTAPI ENDPOINTS
# ==========================================
@app.get("/api-status")
async def get_api_status():
    return {
        "current": len(API_KEYS),
        "total": len(API_KEYS),
        "message": f"Multi-Key Pool Mode: {len(API_KEYS)} key(s) in rotation"
    }

class SyncData(BaseModel): parsed_data: list

@app.post("/sync-db/{job_id}")
async def sync_db(job_id: str, data: SyncData):
    job_state = await get_job_state(job_id)
    if not job_state:
        job_state = { 
            "status": "completed", "parsed_data": [], "image_map": {}, 
            "cancel_requested": False, "current_set": "A", "completed_sets": [], 
            "ms_master_map": {}, "qp_doc_path": None, "base_name": "Imported_Doc", 
            "stats": {"parsed": len(data.parsed_data), "diagrams": 0, "duplicates": 0, "trash": 0}
        }
    job_state["parsed_data"] = data.parsed_data
    await save_job_state(job_id, job_state)
    return {"status": "synced"}

@app.post("/process-documents")
async def process_documents(background_tasks: BackgroundTasks, files: List[UploadFile] = File(...), target_set: str = Form("ALL")):
    job_id = str(uuid.uuid4())
    job_folder = os.path.join("workspace", job_id)
    os.makedirs(job_folder, exist_ok=True)
    
    saved_files = []
    for file in files:
        file_path = os.path.join(job_folder, file.filename)
        with open(file_path, "wb") as f: f.write(await file.read())
        saved_files.append({"name": file.filename, "path": file_path})
        
    initial_set = "A" if target_set == "ALL" else target_set
        
    initial_state = { "status": "processing", "parsed_data": [], "image_map": {}, "cancel_requested": False, "current_set": initial_set, "target_extraction": target_set, "completed_sets": [], "ms_master_map": {}, "qp_doc_path": None, "base_name": "Document", "stats": {"parsed": 0, "diagrams": 0, "duplicates": 0, "trash": 0}}
    await save_job_state(job_id, initial_state)
    background_tasks.add_task(process_batch_set, job_id, saved_files, job_folder, initial_set)
    return {"job_id": job_id}

@app.post("/continue-set/{job_id}")
async def continue_processing_set(job_id: str, background_tasks: BackgroundTasks, next_set: str):
    job_state = await get_job_state(job_id)
    if not job_state: raise HTTPException(status_code=404)
    job_state["status"] = "processing"
    job_state["current_set"] = next_set
    await save_job_state(job_id, job_state)
    background_tasks.add_task(process_batch_set, job_id, [], os.path.join("workspace", job_id), next_set)
    return {"status": "resumed", "set": next_set}

@app.post("/cancel/{job_id}")
async def cancel_job(job_id: str):
    job_state = await get_job_state(job_id)
    if job_state: 
        job_state["cancel_requested"] = True
        await save_job_state(job_id, job_state)
    return {"status": "cancelled"}

@app.get("/logs/{job_id}")
async def stream_logs(job_id: str, request: Request):
    async def log_generator():
        if not redis_client:
            yield f"data: {json.dumps({'type': 'error', 'text': 'Database disconnected'})}\n\n"
            return
        pubsub = redis_client.pubsub()
        await pubsub.subscribe(f"logs:{job_id}")
        try:
            while True:
                if await request.is_disconnected(): break 
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if message and message["type"] == "message":
                    log_data = message["data"]
                    yield f"data: {log_data}\n\n"
                    log_dict = json.loads(log_data)
                    if log_dict.get("type") == "system_control" and log_dict.get("text") in ["ALL_DONE", "SET_COMPLETE", "HALTED"]:
                        break
        finally:
            await pubsub.unsubscribe(f"logs:{job_id}")
            await pubsub.close()
    return StreamingResponse(log_generator(), media_type="text/event-stream")

@app.get("/data/{job_id}")
async def get_data(job_id: str):
    job_state = await get_job_state(job_id)
    if not job_state: raise HTTPException(status_code=404)
    return job_state

@app.post("/upload-manual-image/{job_id}")
async def upload_manual_image(job_id: str, q_sno: str = Form(...), set_name: str = Form(...), base_name: str = Form(...), field: str = Form(...), subject_code: str = Form(""), source: str = Form("QP"), file: UploadFile = File(...)):
    job_folder = os.path.join("workspace", job_id)
    clean_base = base_name.replace('.pdf', '').replace('.PDF', '')
    images_base_dir = os.path.join(job_folder, "images", clean_base)
    os.makedirs(images_base_dir, exist_ok=True)
    
    clean_qno = normalize_qno(q_sno)
    if "Option 1" in field: suffix = "_opt1"
    elif "Option 2" in field: suffix = "_opt2"
    elif "Option 3" in field: suffix = "_opt3"
    elif "Option 4" in field: suffix = "_opt4"
    elif "Option 5" in field: suffix = "_opt5"
    elif "Option 6" in field: suffix = "_opt6"
    else: suffix = ""
    
    prefix_src = source.lower() 
    sc = f"{re.sub(r'[^a-zA-Z0-9]', '', subject_code)[:3]}_" if subject_code else ""
    ts = datetime.now().strftime("%H-%M-%S")
    filename = f"{subject_code}_{set_name.upper()}_{ts}_{clean_qno.upper()}{suffix}.png"   
    with open(os.path.join(images_base_dir, filename), "wb") as f: 
        f.write(await file.read())
    return {"status": "success", "filename": filename}

class ExportRequest(BaseModel):
    set_name: str
    data: List[dict]

@app.post("/export-zip/{job_id}")
async def export_zip(job_id: str, req: ExportRequest):
    job_folder = os.path.join("workspace", job_id) if job_id != "imported" else "workspace/imported_export"
    os.makedirs(job_folder, exist_ok=True)
    df = pd.DataFrame(req.data)
    zip_path = os.path.join(job_folder, f"Verified_SET_{req.set_name}_{uuid.uuid4().hex[:6]}.zip")
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        excel_path = os.path.join(job_folder, f"SET_{req.set_name}.xlsx")
        df.to_excel(excel_path, index=False)
        zipf.write(excel_path, arcname=f"SET_{req.set_name}.xlsx")
        
        json_path = os.path.join(job_folder, f"SET_{req.set_name}.json")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(req.data, f, indent=4)
        zipf.write(json_path, arcname=f"SET_{req.set_name}.json")
        
        qp_file = df['NIOS Filename'].iloc[0] if not df.empty else 'Unknown.pdf'
        ms_file = qp_file.replace('QP', 'MS').replace('qp', 'ms')
        subject = df['Subject Name'].iloc[0] if not df.empty else 'Unknown'
        cls = df['Class'].iloc[0] if not df.empty else 'Unknown'
        
        meta_text = f"Subject: {subject}\nClass: {cls}\nQP File Name: {qp_file}\nMS File Name: {ms_file}\n"
        meta_path = os.path.join(job_folder, "uploaded_files_info.txt")
        with open(meta_path, 'w', encoding='utf-8') as f:
            f.write(meta_text)
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
async def restore_workspace(job_id: str, background_tasks: BackgroundTasks, files: List[UploadFile] = File(...)):
    job_folder = os.path.join("workspace", job_id)
    os.makedirs(job_folder, exist_ok=True)
    async def unpack_pdfs(files_data):
        for file_name, file_bytes in files_data:
            if file_name.lower().endswith('.zip'):
                try:
                    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z: z.extractall(job_folder) 
                except Exception as e: pass
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
async def delete_row(job_id: str, row_id: str):
    job_state = await get_job_state(job_id)
    if job_state and "parsed_data" in job_state:
        job_state["parsed_data"] = [r for r in job_state["parsed_data"] if r.get("id") != row_id]
        await save_job_state(job_id, job_state)
    return {"status": "deleted"}

@app.delete("/cleanup/{job_id}")
async def cleanup_job(job_id: str):
    job_folder = os.path.join("workspace", job_id)
    try:
        if os.path.exists(job_folder): shutil.rmtree(job_folder)
        await delete_job_state(job_id)
        return {"status": "cleaned"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# ==========================================
# MULTI-PORT LAUNCHER
# ==========================================
def start_server(port: int):
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")

if __name__ == "__main__":
    raw_ports = os.getenv("PORTS", "8081,8082,8083,8084,8085,8086,8087")
    target_ports = [int(p.strip()) for p in raw_ports.split(",") if p.strip()]

    print(f"🚀 Initializing Data Extraction Engine across {len(target_ports)} ports: {target_ports}")
    print(f"🔑 Total API keys in pool: {len(API_KEYS)}")
    
    processes = []
    for port in target_ports:
        p = multiprocessing.Process(target=start_server, args=(port,))
        p.start()
        processes.append(p)
        print(f"✅ Worker booted on port {port}")
        
    try:
        for p in processes:
            p.join()
    except KeyboardInterrupt:
        print("\n🛑 Shutting down all extraction nodes...")
        for p in processes:
            p.terminate()
            p.join()
        print("Done.")