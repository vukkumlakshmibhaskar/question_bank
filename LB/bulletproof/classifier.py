"""
Page classifier: determines zoom, scanned vs text, legacy font detection.
"""
import re
from .constants import LEGACY_FONT_MAP, SCRIPT_UNICODE_RANGES

_PUA_RE = re.compile(r"[\uE000-\uF8FF]")


def classify_page(page) -> dict:
    raw_text = page.get_text("text") or ""
    alpha    = re.sub(r"[^a-zA-Z]", "", raw_text)
    is_scanned  = len(alpha) < 30
    has_pua     = bool(_PUA_RE.search(raw_text))

    encoding_type = "unicode"
    script        = "unknown"
    is_legacy     = has_pua

    try:
        for xref, ext, mtype, basefont, name, encoding, referencer in page.get_fonts(full=True):
            fn = (basefont or name or "").lower()
            for key, (scr, enc) in LEGACY_FONT_MAP.items():
                if key in fn:
                    is_legacy, encoding_type, script = True, enc, scr
                    break
            if is_legacy:
                break
    except Exception:
        pass

    if script == "unknown" and not is_scanned:
        script = _infer_script(raw_text)

    zoom = 2.5 if (is_scanned or is_legacy) else 2.0

    return {
        "is_scanned":     is_scanned,
        "is_legacy_font": is_legacy,
        "zoom":           zoom,
        "encoding_type":  encoding_type,
        "script":         script,
        "raw_text":       raw_text,
        "alpha_len":      len(alpha),
    }


def _infer_script(text: str) -> str:
    counts = {}
    for ch in text:
        cp = ord(ch)
        for name, (lo, hi) in SCRIPT_UNICODE_RANGES.items():
            if lo <= cp <= hi:
                counts[name] = counts.get(name, 0) + 1
                break
    return max(counts, key=counts.get) if counts else "latin"
