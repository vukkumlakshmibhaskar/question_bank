"""
BULLETPROOF EXTRACTION ENGINE - IMAGE CAPTURE
Captures page images at the correct resolution and format for each script type.
Rule: NEVER send JPEG to the AI for any regional language. Always PNG.
"""
import io
import fitz
from PIL import Image
from .constants import PageType


def capture_page_image(page: fitz.Page, classification: dict) -> bytes:
    """
    Capture a page as PNG bytes, optimized for the page type and script.
    Always returns PNG (never JPEG) for non-English scripts.
    """
    zoom     = classification["zoom"]
    use_png  = classification["use_png"]
    pg_type  = classification["type"]

    # Apply zoom matrix
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)

    if use_png:
        return pix.tobytes("png")
    else:
        # English / Latin only - JPEG is fine
        return pix.tobytes("jpeg", 90)


def capture_page_pil(page: fitz.Page, classification: dict) -> Image.Image:
    """
    Returns a PIL Image object directly (what Gemini API needs).
    """
    raw = capture_page_image(page, classification)
    return Image.open(io.BytesIO(raw))


def capture_region(
    page: fitz.Page,
    classification: dict,
    bbox_normalized: list,  # [ymin, xmin, ymax, xmax] in 0-1000 scale
) -> bytes:
    """
    Capture a specific region of a page (for crop boxes).
    bbox_normalized: [ymin, xmin, ymax, xmax] where 1000 = full dimension
    """
    zoom   = classification["zoom"]
    use_png = classification["use_png"]

    mat  = fitz.Matrix(zoom, zoom)
    pix  = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)

    import numpy as np
    import cv2
    h, w = pix.height, pix.width

    ymin, xmin, ymax, xmax = bbox_normalized
    y1 = max(0, int((ymin / 1000) * h) - int(h * 0.01))
    x1 = max(0, int((xmin / 1000) * w) - int(w * 0.01))
    y2 = min(h, int((ymax / 1000) * h) + int(h * 0.01))
    x2 = min(w, int((xmax / 1000) * w) + int(w * 0.01))

    if y1 >= y2 or x1 >= x2:
        return b""

    # Convert pix to numpy
    img_arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(h, w, 3)
    crop    = img_arr[y1:y2, x1:x2]

    # Encode
    fmt = ".png" if use_png else ".jpg"
    success, buf = cv2.imencode(fmt, cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
    return buf.tobytes() if success else b""


def prerender_all_pages(
    doc: fitz.Document,
    classifications: list,
) -> list:
    """
    Pre-render ALL page images at document load time.
    Returns list of PIL Images, one per page.
    Cache this — never re-render during extraction.
    """
    images = []
    for i, clf in enumerate(classifications):
        page = doc[i]
        pil_img = capture_page_pil(page, clf)
        images.append(pil_img)
    return images
