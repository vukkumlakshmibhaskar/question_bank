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
redis_client = aioredis.from_url(redis_url, decode_responses=True)

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

print(f"✅ LANG Engine key pool: {len(API_KEYS)} key(s) available for rotation.")

# ==========================================
# IN-MEMORY STATE MANAGEMENT
# ==========================================
JOB_STATES = {}  
LOG_QUEUES = {}

async def get_job_state(job_id):
    try:
        data = await redis_client.get(f"job:{job_id}")
        if data:
            return json.loads(data)
    except Exception:
        pass
    return JOB_STATES.get(job_id)

async def save_job_state(job_id, state):
    try:
        await redis_client.set(f"job:{job_id}", json.dumps(state, default=str))
        return
    except Exception:
        pass
    JOB_STATES[job_id] = state

async def delete_job_state(job_id):
    try:
        await redis_client.delete(f"job:{job_id}")
    except Exception:
        pass
    JOB_STATES.pop(job_id, None)

@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs("workspace", exist_ok=True)
    yield
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

if os.path.exists("build"):
    app.mount("/static", StaticFiles(directory="build/static"), name="static")
    @app.get("/{full_path:path}")
    async def serve_react_app(full_path: str):
        if full_path.startswith("workspace/"):
            raise HTTPException(status_code=404)
        return FileResponse("build/index.html")

async def log_to_client(job_id, text, log_type="info", data=None):
    if not redis_client: 
        return
    payload = {"type": log_type, "text": text}
    if data is not None: 
        payload["data"] = data
    await redis_client.publish(f"logs:{job_id}", json.dumps(payload))

def get_base_name(filename):
    match = re.search(r'^(?:qp|ms|QP|MS)_(.*?)(?:_[a-zA-Z0-9]{15,})?\.pdf$', filename)
    base = match.group(1) if match else filename.replace('.pdf', '')
    base = base.replace('.pdf', '').replace('.PDF', '')
    return re.sub(r'[^a-zA-Z0-9_]', '', base) or "Document"

def normalize_qno(qno):
    return re.sub(r'[^0-9a-zA-Z_]', '', str(qno)).lower()

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
    question_header: str = Field(default="")
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
    client = genai.Client(api_key=get_next_key())
    for attempt in range(5):
        try:
            def _gen():
                return client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[pil_img, prompt],
                    config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=DocumentProfile, temperature=0.0)
                )
            res = await asyncio.wait_for(asyncio.to_thread(_gen), timeout=300.0)
            parsed = json.loads(extract_json_from_text(res.text))
            recursively_clean_nulls(parsed)
            return DocumentProfile(**parsed)
        except asyncio.TimeoutError:
            await log_to_client(job_id, f"      ⏳ Scout timeout attempt {attempt+1}. Retrying...", "warning")
            await asyncio.sleep(5 * (attempt + 1))
            continue
        except Exception as e:
            err = str(e).lower()
            await log_to_client(job_id, f"      ❌ Scout error (attempt {attempt+1}): {err[:120]}", "warning")
            if "429" in err or "quota" in err:
                await log_to_client(job_id, "      🛑 Scout rate limited. Waiting 30s...", "warning")
                await asyncio.sleep(30)
            elif "503" in err:
                await log_to_client(job_id, "      ⏳ Scout 503. Waiting 15s...", "warning")
                await asyncio.sleep(15)
            else: await asyncio.sleep(5)
            continue
    await log_to_client(job_id, "      ⚠️ Scout failed — using defaults.", "warning")
    return DocumentProfile(qp_subject_or_code="Unknown", ms_subject_or_code="Unknown", is_matching_pair=True, primary_language="Hindi")

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

class LanguageConfirmation(BaseModel):
    language: str

@app.post("/confirm-language/{job_id}")
async def confirm_language(job_id: str, data: LanguageConfirmation):
    job_state = await get_job_state(job_id)
    if not job_state: raise HTTPException(status_code=404, detail="Job not found")
    job_state["confirmed_language"] = data.language
    job_state["language_confirmed"] = True
    await save_job_state(job_id, job_state)
    await log_to_client(job_id, f"   ↳ User confirmed language: {data.language}", "info")
    return {"status": "confirmed", "language": data.language}

class WorkspaceState(BaseModel):
    workspace: dict

@app.post("/redis/save")
async def redis_save(state: WorkspaceState):
    try:
        await redis_client.set("workspace_state_lp", json.dumps(state.workspace))
        return {"success": True}
    except Exception:
        app.state.workspace = state.workspace
        return {"success": True}

@app.get("/redis/load")
async def redis_load():
    try:
        data = await redis_client.get("workspace_state_lp")
        if data: return {"success": True, "workspace": json.loads(data)}
        return {"success": False, "workspace": {}}
    except Exception:
        ws = getattr(app.state, "workspace", {})
        return {"success": bool(ws), "workspace": ws}

@app.post("/redis/clear")
async def redis_clear():
    try:
        await redis_client.delete("workspace_state_lp")
        return {"success": True}
    except Exception:
        app.state.workspace = {}
        return {"success": True}

@app.post("/process-documents")
async def process_documents(background_tasks: BackgroundTasks, files: List[UploadFile] = File(...), target_set: str = Form("ALL"), target_language: str = Form("Original")):
    job_id = str(uuid.uuid4())
    job_folder = os.path.join("workspace", job_id)
    os.makedirs(job_folder, exist_ok=True)
    LOG_QUEUES[job_id] = asyncio.Queue()
    saved_files = []
    for file in files:
        file_path = os.path.join(job_folder, file.filename)
        with open(file_path, "wb") as f: f.write(await file.read())
        saved_files.append({"name": file.filename, "path": file_path})

    initial_set = "A" if target_set == "ALL" else target_set
    initial_state = {
        "status": "processing", "parsed_data": [], "image_map": {},
        "cancel_requested": False, "current_set": initial_set,
        "target_extraction": target_set, "target_language": target_language,
        "completed_sets": [], "ms_master_map": {}, "qp_doc_path": None,
        "base_name": "Document", "stats": {"parsed": 0, "diagrams": 0, "duplicates": 0, "trash": 0}
    }
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
                    if log_dict.get("type") == "system_control" and log_dict.get("text") in ["ALL_DONE", "SET_COMPLETE", "HALTED"]: break
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
    if "Option 1" in field:   suffix = "_opt1"
    elif "Option 2" in field: suffix = "_opt2"
    elif "Option 3" in field: suffix = "_opt3"
    elif "Option 4" in field: suffix = "_opt4"
    elif "Option 5" in field: suffix = "_opt5"
    elif "Option 6" in field: suffix = "_opt6"
    else:                     suffix = ""

    ts = datetime.now().strftime("%H-%M-%S")
    filename = f"{subject_code}_{set_name.upper()}_{ts}_{clean_qno.upper()}{suffix}.png"
    with open(os.path.join(images_base_dir, filename), "wb") as f: f.write(await file.read())
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
        with open(json_path, 'w', encoding='utf-8') as f: json.dump(req.data, f, indent=4)
        zipf.write(json_path, arcname=f"SET_{req.set_name}.json")

        qp_file = df['NIOS Filename'].iloc[0] if not df.empty else 'Unknown.pdf'
        ms_file = qp_file.replace('QP', 'MS').replace('qp', 'ms')
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
async def restore_workspace(job_id: str, background_tasks: BackgroundTasks, files: List[UploadFile] = File(...)):
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
        LOG_QUEUES.pop(job_id, None)
        return {"status": "cleaned"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=int(os.getenv("PORT", "8091")))
    args = parser.parse_args()
    uvicorn.run(app, host="0.0.0.0", port=args.port)