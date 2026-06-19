"""
BULLETPROOF EXTRACTION ENGINE - PAGE CLASSIFIER
Determines the exact type of every PDF page before extraction begins.
"""
import re
import fitz
from typing import Optional
from .constants import (
    PageType, SCRIPT_UNICODE_RANGES, LEGACY_FONT_MAP, LANGUAGE_CONFIG
)


def classify_page(page: fitz.Page, expected_lang: str = "auto") -> dict:
    """
    Classify a single PDF page into a PageType with full metadata.

    Returns dict:
    {
        "type":          PageType,
        "text":          str (reliable text or "" if unreliable),
        "raw_text":      str (always the raw PyMuPDF output),
        "has_images":    bool,
        "script":        str (detected script name),
        "lang_config":   dict (from LANGUAGE_CONFIG),
        "zoom":          float,
        "use_png":       bool,
        "model":         str (starting model to use),
        "fonts":         list,
        "debug":         dict,
    }
    """
    cfg = LANGUAGE_CONFIG.get(expected_lang, LANGUAGE_CONFIG.get("english"))

    raw_text   = page.get_text("text").strip()
    fonts      = _get_page_fonts(page)
    has_images = len(page.get_images()) > 0
    image_area_ratio = _get_image_area_ratio(page)

    debug = {
        "raw_text_len":    len(raw_text),
        "fonts":           [f[0] for f in fonts],
        "has_images":      has_images,
        "image_area_ratio": image_area_ratio,
    }

    # ── STEP 1: Check for Urdu (force vision-only regardless of encoding) ──
    if expected_lang == "urdu" or cfg.get("always_vision_only"):
        page_type = _classify_urdu_page(raw_text, fonts, has_images)
        return _build_result(page_type, "", raw_text, has_images, cfg, fonts, debug)

    # ── STEP 2: Near-empty / cover page ──────────────────────────────────
    printable = [c for c in raw_text if c.isprintable() and not c.isspace()]
    if len(printable) < 30 and not has_images:
        return _build_result(
            PageType.NEAR_EMPTY, raw_text, raw_text, has_images, cfg, fonts, debug
        )

    # ── STEP 3: Image-dominant detection ─────────────────────────────────
    # If image covers >60% of page AND text is <50 chars → image-based
    if image_area_ratio > 0.60 and len(raw_text) < 80:
        return _build_result(
            PageType.IMAGE_DOMINANT, "", raw_text, has_images, cfg, fonts, debug
        )

    # ── STEP 4: Font-based legacy detection ──────────────────────────────
    legacy_hit = _check_legacy_fonts(fonts)
    if legacy_hit:
        font_script, encoding_type = legacy_hit
        debug["legacy_font_detected"] = encoding_type

        # If the legacy font IS unicode despite being "known", trust text
        if encoding_type == "unicode":
            pass  # fall through to unicode analysis
        else:
            # Full legacy encoding - text is garbage
            ptype = PageType.RTL_LEGACY if cfg.get("direction") == "rtl" else PageType.LEGACY_ENCODED
            return _build_result(ptype, "", raw_text, has_images, cfg, fonts, debug)

    # ── STEP 5: Unicode script analysis ──────────────────────────────────
    total_chars = max(len(printable), 1)
    script_counts = _count_script_chars(raw_text)
    ascii_count   = sum(1 for c in printable if ord(c) < 128)

    ascii_ratio    = ascii_count / total_chars
    regional_total = sum(script_counts.values())
    regional_ratio = regional_total / total_chars

    debug["ascii_ratio"]    = round(ascii_ratio, 3)
    debug["regional_ratio"] = round(regional_ratio, 3)
    debug["script_counts"]  = {k: v for k, v in script_counts.items() if v > 0}

    # Detect dominant script
    dominant_script = max(script_counts, key=script_counts.get) if regional_total > 0 else "latin"
    dominant_count  = script_counts.get(dominant_script, 0)

    # ── STEP 6: Scanned page detection ───────────────────────────────────
    # Very high image coverage + very low text = scanned
    if image_area_ratio > 0.85 and regional_ratio < 0.05 and ascii_ratio > 0.90:
        # Could be scanned, or could be instructions page in English
        if len(raw_text) < 100:
            return _build_result(
                PageType.SCANNED, "", raw_text, has_images, cfg, fonts, debug
            )

    # ── STEP 7: Legacy detection by character ratio ───────────────────────
    # ASCII ratio too high for a supposedly regional language document
    expected_script = cfg.get("script", "")
    if expected_script != "latin" and ascii_ratio > 0.80 and total_chars > 50:
        # Should have lots of regional chars, but mostly ASCII → legacy font
        debug["legacy_by_ratio"] = True
        ptype = PageType.RTL_LEGACY if cfg.get("direction") == "rtl" else PageType.LEGACY_ENCODED
        return _build_result(ptype, "", raw_text, has_images, cfg, fonts, debug)

    # ── STEP 8: Bilingual detection ───────────────────────────────────────
    scripts_with_content = [s for s, c in script_counts.items() if c > 5]
    is_bilingual_doc = cfg.get("bilingual", False)

    if len(scripts_with_content) >= 2 or is_bilingual_doc:
        if regional_ratio > 0.25:
            return _build_result(
                PageType.MIXED_BILINGUAL, raw_text, raw_text, has_images, cfg, fonts, debug
            )

    # ── STEP 9: RTL Unicode (Urdu with proper Unicode fonts) ─────────────
    if dominant_script == "arabic" and regional_ratio > 0.25:
        return _build_result(
            PageType.RTL_UNICODE, raw_text, raw_text, has_images, cfg, fonts, debug
        )

    # ── STEP 10: Clean Unicode regional ──────────────────────────────────
    if regional_ratio > 0.30 and dominant_count > 10:
        return _build_result(
            PageType.UNICODE_CLEAN, raw_text, raw_text, has_images, cfg, fonts, debug
        )

    # ── STEP 11: Fallback - insufficient evidence ─────────────────────────
    # When in doubt, force vision only for non-English
    if expected_script != "latin":
        return _build_result(
            PageType.LEGACY_ENCODED, "", raw_text, has_images, cfg, fonts, debug
        )

    # English / Latin - use whatever text we have
    return _build_result(
        PageType.UNICODE_CLEAN, raw_text, raw_text, has_images, cfg, fonts, debug
    )


# ──────────────────────────────────────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────────────────────────────────────

def _classify_urdu_page(raw_text: str, fonts: list, has_images: bool) -> PageType:
    """Special classifier for Urdu - almost always vision-only."""
    legacy_hit = _check_legacy_fonts(fonts)
    if legacy_hit and legacy_hit[1] == "inpage":
        return PageType.RTL_LEGACY  # InPage - definitely vision only

    # Check if we have any Arabic Unicode chars
    arabic_count = sum(
        1 for c in raw_text
        if (0x0600 <= ord(c) <= 0x06FF) or (0xFB50 <= ord(c) <= 0xFDFF)
    )
    if arabic_count > 20:
        return PageType.RTL_UNICODE  # Has real Urdu Unicode

    return PageType.RTL_LEGACY  # Default: force vision for Urdu


def _build_result(
    page_type: PageType,
    reliable_text: str,
    raw_text: str,
    has_images: bool,
    cfg: dict,
    fonts: list,
    debug: dict,
) -> dict:
    """Build the standardized classification result dict."""
    from .constants import MODEL_FLASH, MODEL_PRO, PRO_REQUIRED_TYPES

    # Determine zoom
    base_zoom = cfg.get("min_zoom", 1.5)
    if page_type in (PageType.IMAGE_DOMINANT, PageType.SCANNED):
        zoom = max(base_zoom, 2.5)
    elif page_type in (PageType.RTL_LEGACY, PageType.RTL_UNICODE):
        zoom = max(base_zoom, 2.5)  # Nastaliq needs max quality
    elif page_type == PageType.LEGACY_ENCODED:
        zoom = max(base_zoom, 2.0)
    elif has_images:
        zoom = max(base_zoom, 2.0)
    else:
        zoom = base_zoom

    # PNG vs JPEG
    use_png = (cfg.get("jpeg_quality") is None) or (
        page_type in {PageType.LEGACY_ENCODED, PageType.RTL_LEGACY,
                      PageType.IMAGE_DOMINANT, PageType.SCANNED}
    )

    # Model selection
    if page_type in PRO_REQUIRED_TYPES:
        model = MODEL_PRO
    elif cfg.get("preferred_model") == MODEL_PRO:
        model = MODEL_PRO
    else:
        model = MODEL_FLASH  # May escalate later

    return {
        "type":        page_type,
        "text":        reliable_text,       # Use this in prompt
        "raw_text":    raw_text,            # For debugging
        "has_images":  has_images,
        "script":      cfg.get("script", "unknown"),
        "lang_config": cfg,
        "zoom":        zoom,
        "use_png":     use_png,
        "model":       model,
        "fonts":       [f[0] for f in fonts],
        "debug":       debug,
    }


def _get_page_fonts(page: fitz.Page) -> list:
    """Extract all font names used on this page."""
    try:
        fonts = page.get_fonts(full=True)
        return [(f[3].lower().strip() if f[3] else "", f[4]) for f in fonts]
    except Exception:
        return []


def _check_legacy_fonts(fonts: list) -> Optional[tuple]:
    """
    Check if any font on this page is a known legacy encoding font.
    Returns (script, encoding_type) or None.
    """
    for font_name, _ in fonts:
        fn = font_name.lower()
        for key, value in LEGACY_FONT_MAP.items():
            if key in fn:
                return value
    return None


def _get_image_area_ratio(page: fitz.Page) -> float:
    """Estimate what fraction of the page is covered by images."""
    try:
        page_area = page.rect.width * page.rect.height
        if page_area == 0:
            return 0.0
        img_area = 0.0
        for img in page.get_image_info():
            bbox = img.get("bbox")
            if bbox:
                w = abs(bbox[2] - bbox[0])
                h = abs(bbox[3] - bbox[1])
                img_area += w * h
        return min(1.0, img_area / page_area)
    except Exception:
        return 0.0


def _count_script_chars(text: str) -> dict:
    """Count characters belonging to each Unicode script block."""
    counts = {name: 0 for name in SCRIPT_UNICODE_RANGES}
    for c in text:
        cp = ord(c)
        for name, (start, end) in SCRIPT_UNICODE_RANGES.items():
            if start <= cp <= end:
                counts[name] += 1
    # Merge arabic sub-ranges
    counts["arabic"] = counts.get("arabic", 0) + \
                       counts.pop("arabic_ext", 0) + \
                       counts.pop("arabic_pfa", 0)
    return counts


def classify_document(doc: fitz.Document, expected_lang: str) -> list:
    """
    Classify ALL pages of a document upfront.
    Returns list of classification dicts, one per page.
    This is the pre-flight scan - run once before extraction starts.
    """
    results = []
    type_summary = {}

    for page_num in range(len(doc)):
        page = doc[page_num]
        classification = classify_page(page, expected_lang)
        classification["page_num"] = page_num
        results.append(classification)

        t = classification["type"].value
        type_summary[t] = type_summary.get(t, 0) + 1

    return results, type_summary
