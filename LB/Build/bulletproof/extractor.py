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

    # Build the prompt
    if mode == "qp":
        prompt = build_qp_prompt(classification, profile_dict, target_language)
    else:
        prompt = build_ms_prompt(classification, profile_dict, target_language, target_set)

    # Determine starting model
    start_model = classification.get("model", MODEL_FLASH)
    current_model = start_model

    # Timeout per model
    TIMEOUT = {MODEL_FLASH: 240.0, MODEL_PRO: 360.0}

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
                        temperature=0.0,  # Minimum: no creativity, max accuracy
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

        tasks = [
            asyncio.create_task(
                extract_page(
                    job_id       = job_id,
                    page_num     = item[0],
                    pil_image    = item[1],
                    classification = item[2],
                    profile_dict = profile_dict,
                    target_language = target_language,
                    api_key      = api_key,
                    response_schema = response_schema,
                    log_fn       = log_fn,
                    mode         = mode,
                    target_set   = target_set,
                )
            )
            for item in batch
        ]

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
