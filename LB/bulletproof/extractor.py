"""
BULLETPROOF EXTRACTION ENGINE - CORE EXTRACTOR
Handles the actual Gemini API calls with full retry logic,
model escalation, and timeout management.
"""
import asyncio
import json
import re
from PIL import Image
from google import genai
from google.genai import types

from .constants import MODEL_FLASH, MODEL_PRO, PageType
from .prompts import build_qp_prompt, build_ms_prompt
from .validator import validate_extraction, ValidationError


# ─────────────────────────────────────────────────────────────────────────────
# PYDANTIC SCHEMAS (same as your original but kept here for reference)
# ─────────────────────────────────────────────────────────────────────────────
# (These stay in your main.py — imported here via the log_to_client pattern)


# Page types that have no reliable text layer — OCR pre-pass helps these most
VISION_ONLY_TYPES = {
    PageType.LEGACY_ENCODED,
    PageType.IMAGE_DOMINANT,
    PageType.SCANNED,
    PageType.RTL_LEGACY,
    PageType.RTL_UNICODE,
    PageType.MIXED_BILINGUAL,
}


# ─────────────────────────────────────────────────────────────────────────────
# TWO-PASS OCR PRE-PASS
# For vision-only pages, run a fast Flash call first to get clean regional text.
# That text is then injected into the main extraction prompt as grounding —
# the same way UNICODE_CLEAN mode uses the PDF text layer.
# ─────────────────────────────────────────────────────────────────────────────

async def ocr_page_text(
    job_id:    str,
    page_num:  int,
    pil_image: Image.Image,
    cfg:       dict,
    api_key:   str,
    log_fn,
) -> str:
    """
    OCR Pre-Pass: Ask Gemini Flash to ONLY transcribe text from the image.
    No structuring, no JSON, no question detection — pure transcription.

    Returns the raw regional text string, or "" on failure.
    This text is then used as grounding in the main extraction pass,
    giving every regional language the same quality as English scan text.
    """
    script    = cfg.get("script", "latin")
    direction = cfg.get("direction", "ltr")
    lang_name = cfg.get("folder_name", "regional language")

    if direction == "rtl":
        ocr_prompt = (
            f"You are a precise OCR engine for {lang_name} (Nastaliq script, RIGHT TO LEFT).\n"
            "Transcribe ALL text visible in this image EXACTLY as printed.\n"
            "Rules:\n"
            "• Read every line RIGHT TO LEFT.\n"
            "• Preserve every diacritic, every hamza, every nukta exactly.\n"
            "• Do NOT translate, summarize, or reorder.\n"
            "• Do NOT output JSON, headings, or explanations.\n"
            "• Output ONLY the raw transcribed text, line by line."
        )
    else:
        _SCRIPT_WARN = {
            "gurmukhi": (
                "CRITICAL -- Gurmukhi confusables: tippi (dot RIGHT) vs bindi (dot LEFT) | "
                "addak NEVER drop | short-i LEFT vs long-i RIGHT | ਣ curled vs ਨ straight | "
                "ਸ਼/ਖ਼/ਗ਼/ਜ਼/ਫ਼ subscript dot changes meaning. Read EVERY word letter by letter."
            ),
            "bengali": (
                "CRITICAL -- Bengali confusables (from audit):\n"
                "HIGH-RISK WORDS — transcribe letter by letter:\n"
                "  ছৌয়াছুঁয়ি ← NOT হৈঁয়াহিয়ি | চোট্টি/চোটি ← NOT টোটি\n"
                "  শোনপাংশু ← NOT শোনপাকসু | আর্যদের ← NOT আর্টের\n"
                "  ধ্বংস ← NOT হংসস | ডুমুরের ফুল ← NOT ভূম্যুর ফল\n"
                "  তীর্থের কাক ← NOT ঠোঁটের ডাক | ঐলিৎ ← NOT এলিফ\n"
                "  তীর (arrow) ← NOT তাঁর (his) | বজ্রবিদারণ ← NOT অজবিজরন\n"
                "  মন্ত্রতন্ত্র ← NOT মস্তবড় | অঙ্গ বঙ্গ ← NOT অন্ধ বঙ্গ\n"
                "  পিৃতমুণ্ডা ← NOT পূর্ণিমৃত্যু | ভাঙা ← NOT ভাল\n"
                "  কঙ্কাল ← NOT জঞ্জাল | শ্রমের ← NOT অঙ্কের\n"
                "LETTER RULES:\n"
                "  ছ ≠ হ ≠ ট ≠ ঠ | চ ≠ ট | ড ≠ ভ | ৎ ≠ ফ | ঐ ≠ এ\n"
                "  ্ (hasanta) NEVER drop — forms র্য ধ্ব ত্ত ক্ষ etc.\n"
                "  ং (anusvara) ≠ ঁ (chandrabindu) ≠ ঃ (visarga)\n"
                "  Do NOT guess any word — transcribe EXACTLY what is printed."
            ),
            "telugu": (
                "CRITICAL -- Telugu confusables (from audit):\n"
                "HIGH-RISK CONTENT WORDS — read each letter from image:\n"
                "  నామధేయం ← NOT నాయకుడయం | పానుగంటివారి ← NOT సానుగతినేగాని\n"
                "  అపారము ← NOT ఆనందము | నిత్యం ← NOT సత్యం\n"
                "  పక్షి ← NOT వృక్ష | ఉత్తరము ← NOT తటస్థము\n"
                "  తాళ్ళపాక తిమ్మక్క ← read left column — NOT the right-column match\n"
                "  Q6/Q7/Q8/Q9 items — read each question's own items only.\n"
                "  Do NOT carry Q7 items into Q6 or Q8 items into Q7 (shift error).\n"
                "LETTER RULES:\n"
                "  న ≠ స ≠ శ | అ ≠ ఆ | ట ≠ డ\n"
                "  ్ (virama) NEVER drop — forms all conjuncts\n"
                "  Do NOT substitute a similar-sounding Telugu word — read exactly."
            ),
        }.get(script, "")
        ocr_prompt = (
            f"You are a precise OCR engine for {lang_name} ({script} script).\n"
            "Transcribe ALL text visible in this image EXACTLY as printed.\n"
            "Rules:\n"
            f"• Preserve every diacritic, matra, virama, anusvara, and vowel sign exactly.\n"
            "• Do NOT translate, summarize, or add structure.\n"
            "• Do NOT output JSON, headings, or explanations.\n"
            "• Output ONLY the raw transcribed text, line by line.\n"
            + (f"\n{_SCRIPT_WARN}\n" if _SCRIPT_WARN else "")
        )

    try:
        await log_fn(
            job_id,
            f"      🔍 [Pg {page_num}] OCR pre-pass (Flash)...",
            "info"
        )
        client = genai.Client(api_key=api_key)

        _ocr_model = (
            MODEL_PRO if cfg.get("script") in ("gurmukhi", "bengali", "telugu")
            else MODEL_FLASH
        )
        def _ocr_call():
            return client.models.generate_content(
                model=_ocr_model,
                contents=[pil_image, ocr_prompt],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    max_output_tokens=4096,
                )
            )
        _ocr_timeout = 180.0 if _ocr_model == MODEL_PRO else 60.0
        res = await asyncio.wait_for(asyncio.to_thread(_ocr_call), timeout=_ocr_timeout)
        ocr_text = (res.text or "").strip()
        if len(ocr_text) > 6000:
            ocr_text = ocr_text[:6000]
            await log_fn(job_id, f"      ⚠️ [Pg {page_num}] OCR output truncated to 6000 chars.", "warning")
        if ocr_text:
            await log_fn(job_id, f"      ✅ [Pg {page_num}] OCR pre-pass got {len(ocr_text)} chars.", "info")
        return ocr_text
    except asyncio.TimeoutError:
        await log_fn(job_id, f"      ⚠️ [Pg {page_num}] OCR timeout. Vision-only.", "warning")
        return ""
    except Exception as e:
        await log_fn(job_id, f"      ⚠️ [Pg {page_num}] OCR failed ({str(e)[:60]}). Vision-only.", "warning")
        await asyncio.sleep(3)
        return ""


async def extract_page(
    job_id:        str,
    page_num:      int,
    pil_image:     Image.Image,
    classification: dict,
    profile_dict:  dict,
    target_language: str,
    api_key:       str,
    response_schema,
    log_fn,        # log_to_client coroutine
    mode:          str = "qp",     # "qp" or "ms"
    target_set:    str = "A",
) -> dict:
    """
    Extract data from a single pre-rendered page image.

    Smart retry strategy:
    - Attempt 1-2: Use starting model (Flash or Pro based on page type)
    - Attempt 3:   Escalate to Pro if started with Flash
    - Attempt 4-5: Pro with longer timeout
    - Returns {} on total failure (page is skipped, not crashed)
    """
    client  = genai.Client(api_key=api_key)
    pg_type = classification["type"]

    # ── TWO-PASS: OCR pre-pass for vision-only pages ────────────────────────
    # Run a fast Flash OCR call first to get clean regional text grounding.
    # This text is injected into the classification so the prompt builder
    # treats the page like UNICODE_CLEAN (text-grounded) instead of vision-only.
    cfg = classification.get("lang_config", {})
    ocr_text = ""
    if pg_type in VISION_ONLY_TYPES and cfg.get("script", "latin") != "latin":
        ocr_text = await ocr_page_text(
            job_id=job_id,
            page_num=page_num,
            pil_image=pil_image,
            cfg=cfg,
            api_key=api_key,
            log_fn=log_fn,
        )
        if ocr_text:
            # Inject OCR text as grounding into classification
            # The prompt builder will use this as reference text
            classification = dict(classification)  # shallow copy — don't mutate original
            classification["ocr_text"] = ocr_text

    # Build the prompt (now with OCR text injected if available)
    if mode == "qp":
        prompt = build_qp_prompt(classification, profile_dict, target_language)
    else:
        prompt = build_ms_prompt(classification, profile_dict, target_language, target_set)

    # Determine starting model
    start_model = classification.get("model", MODEL_FLASH)
    current_model = start_model

    # Timeout per model
    TIMEOUT = {MODEL_FLASH: 120.0, MODEL_PRO: 300.0}

    for attempt in range(5):
        try:
            await log_fn(
                job_id,
                f"      📡 [Pg {page_num}] [{current_model.split('-')[1].upper()}] "
                f"[{pg_type.value}] Attempt {attempt+1}...",
                "info"
            )

            def _call_api():
                return client.models.generate_content(
                    model=current_model,
                    contents=[pil_image, prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=response_schema,
                        temperature=0.0,
                        max_output_tokens=8192,
                    )
                )

            timeout = TIMEOUT.get(current_model, 300.0)
            res = await asyncio.wait_for(asyncio.to_thread(_call_api), timeout=timeout)

            await log_fn(job_id, f"      ✅ [Pg {page_num}] API success.", "success")

            # Parse response
            parsed = _safe_parse_json(res.text)
            if parsed is None:
                raise ValueError("validation: empty or unparseable JSON response")

            # Validate output
            try:
                parsed = validate_extraction(parsed, classification, page_num)
            except ValidationError as ve:
                raise ValueError(f"validation: {ve}")

            return parsed

        except asyncio.TimeoutError:
            await log_fn(job_id,
                f"      ⏳ [Pg {page_num}] TIMEOUT after {timeout:.0f}s. "
                f"{'Escalating to Pro...' if current_model == MODEL_FLASH else 'Retrying...'}",
                "warning")
            if current_model == MODEL_FLASH:
                current_model = MODEL_PRO
            await asyncio.sleep(3)
            continue

        except Exception as e:
            err_str = str(e).lower()

            # Rate limiting
            if "429" in err_str or "quota" in err_str or "rate" in err_str or "exhaust" in err_str:
                wait = 60 if attempt >= 2 else 30
                await log_fn(job_id,
                    f"      🛑 [Pg {page_num}] Rate limited (429). Waiting {wait}s...",
                    "warning")
                await asyncio.sleep(wait)
                continue

            # Server overload
            if "503" in err_str or "overload" in err_str or "unavailable" in err_str:
                wait = 20 + (attempt * 10)
                await log_fn(job_id,
                    f"      ⏳ [Pg {page_num}] Server overload (503). Waiting {wait}s...",
                    "warning")
                await asyncio.sleep(wait)
                continue

            # Validation failure → escalate to Pro
            if "validation" in err_str or "schema" in err_str or "json" in err_str or "format" in err_str:
                if current_model == MODEL_FLASH and attempt < 3:
                    await log_fn(job_id,
                        f"      🔄 [Pg {page_num}] Flash failed validation. Escalating to Pro...",
                        "warning")
                    current_model = MODEL_PRO
                    await asyncio.sleep(2)
                    continue
                elif attempt >= 3:
                    await log_fn(job_id,
                        f"      ⚠️ [Pg {page_num}] Repeated validation failure. Skipping page.",
                        "warning")
                    return {}
                await asyncio.sleep(2)
                continue

            # Auth error — fatal, no point retrying
            if "api_key" in err_str or "unauthorized" in err_str or "permission" in err_str:
                await log_fn(job_id,
                    f"      🔴 [Pg {page_num}] API authentication error. Check API key.",
                    "error")
                return {}

            # Generic error
            if attempt >= 4:
                await log_fn(job_id,
                    f"      ⚠️ [Pg {page_num}] Failed after 5 attempts: {str(e)[:100]}",
                    "warning")
                return {}

            await asyncio.sleep(2 ** attempt)  # Exponential backoff
            continue

    await log_fn(job_id, f"      ⚠️ [Pg {page_num}] All retries exhausted.", "warning")
    return {}


# ─────────────────────────────────────────────────────────────────────────────
# BATCH EXTRACTOR - process N pages concurrently
# ─────────────────────────────────────────────────────────────────────────────

async def extract_batch(
    job_id:      str,
    batch_items: list,   # list of (page_num, pil_image, classification)
    profile_dict: dict,
    target_language: str,
    api_key:     str,
    response_schema,
    log_fn,
    mode:        str = "qp",
    target_set:  str = "A",
    batch_size:  int = 2,
) -> list:
    """
    Process pages in batches of `batch_size`.
    Default batch_size=2: safe for rate limits while maintaining speed.
    For Urdu (always Pro), use batch_size=1 to avoid Pro rate limits.
    """
    results = []

    for i in range(0, len(batch_items), batch_size):
        batch = batch_items[i:i + batch_size]

        # Add inter-batch delay to respect rate limits
        if i > 0:
            await asyncio.sleep(2)

        async def _safe_extract(item):
            try:
                return await asyncio.wait_for(
                    extract_page(
                        job_id=job_id, page_num=item[0], pil_image=item[1],
                        classification=item[2], profile_dict=profile_dict,
                        target_language=target_language, api_key=api_key,
                        response_schema=response_schema, log_fn=log_fn,
                        mode=mode, target_set=target_set,
                    ), timeout=600.0,
                )
            except asyncio.TimeoutError:
                await log_fn(job_id, f"      🔴 [Pg {item[0]}] Hard timeout (600s). Skipped.", "warning")
                return {}
        tasks = [asyncio.create_task(_safe_extract(item)) for item in batch]
        batch_results = await asyncio.gather(*tasks, return_exceptions=True)

        for j, res in enumerate(batch_results):
            if isinstance(res, Exception):
                await log_fn(job_id, f"      ❌ Batch error: {str(res)[:100]}", "warning")
                results.append((batch[j][0], {}))
            else:
                results.append((batch[j][0], res or {}))

    return results


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _safe_parse_json(raw_text: str) -> dict | None:
    """
    Safely parse JSON from Gemini response.
    Handles markdown code blocks, trailing commas, escape issues.
    """
    if not raw_text or not raw_text.strip():
        return None

    text = raw_text.strip()

    # Strip markdown code fences
    if text.startswith("```"):
        text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.MULTILINE)
        text = re.sub(r'\s*```$', '', text, flags=re.MULTILINE)
        text = text.strip()

    # Fix common JSON issues
    # 1. Unescaped backslashes not followed by valid escape chars
    text = re.sub(r'(?<!\\)\\(?![nrtbf"\\/])', r'\\\\', text)

    # 2. Trailing commas before } or ]
    text = re.sub(r',\s*([}\]])', r'\1', text)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Last resort: try to extract just the JSON object
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                pass
        return None


def extract_json_safely(raw_text: str) -> str:
    """Legacy compat: return the cleaned JSON string."""
    result = _safe_parse_json(raw_text)
    if result is None:
        return ""
    return json.dumps(result)
