"""
download_fonts.py  — v2 (fixed URLs)
=====================================
Run this ONCE next to your main API file.

Usage:
    python download_fonts.py

All fonts come from the official notofonts/noto-fonts monorepo on GitHub
via raw.githubusercontent.com — no release ZIPs, no version guessing.

After it finishes your folder will look like:
    your_project/
    ├── main.py
    ├── download_fonts.py
    └── fonts/
        ├── NotoSansDevanagari-Regular.ttf
        ├── NotoSansTelugu-Regular.ttf
        ├── NotoSansTamil-Regular.ttf
        ├── NotoSansKannada-Regular.ttf
        ├── NotoSansMalayalam-Regular.ttf
        ├── NotoSansBengali-Regular.ttf
        ├── NotoSansGujarati-Regular.ttf
        ├── NotoSansGurmukhi-Regular.ttf
        ├── NotoSansOriya-Regular.ttf
        ├── NotoNastaliqUrdu-Regular.ttf
        ├── NotoSansMeeteiMayek-Regular.ttf
        ├── NotoSansOlChiki-Regular.ttf
        └── Arial.ttf
"""

import os
import shutil
import sys
import urllib.request

FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")

# ---------------------------------------------------------------------------
# All URLs use the notofonts/noto-fonts monorepo — single source of truth.
# Pattern:
#   https://raw.githubusercontent.com/notofonts/noto-fonts/refs/heads/main
#   /hinted/ttf/<FolderName>/<FileName>.ttf
# ---------------------------------------------------------------------------
_BASE = (
    "https://raw.githubusercontent.com/notofonts/noto-fonts"
    "/refs/heads/main/hinted/ttf"
)

FONT_DOWNLOADS = {
    "NotoSansDevanagari-Regular.ttf":  f"{_BASE}/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
    "NotoSansTelugu-Regular.ttf":      f"{_BASE}/NotoSansTelugu/NotoSansTelugu-Regular.ttf",
    "NotoSansTamil-Regular.ttf":       f"{_BASE}/NotoSansTamil/NotoSansTamil-Regular.ttf",
    "NotoSansKannada-Regular.ttf":     f"{_BASE}/NotoSansKannada/NotoSansKannada-Regular.ttf",
    "NotoSansMalayalam-Regular.ttf":   f"{_BASE}/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf",
    "NotoSansBengali-Regular.ttf":     f"{_BASE}/NotoSansBengali/NotoSansBengali-Regular.ttf",
    "NotoSansGujarati-Regular.ttf":    f"{_BASE}/NotoSansGujarati/NotoSansGujarati-Regular.ttf",
    "NotoSansGurmukhi-Regular.ttf":    f"{_BASE}/NotoSansGurmukhi/NotoSansGurmukhi-Regular.ttf",
    "NotoSansOriya-Regular.ttf":       f"{_BASE}/NotoSansOriya/NotoSansOriya-Regular.ttf",
    "NotoNastaliqUrdu-Regular.ttf":    f"{_BASE}/NotoNastaliqUrdu/NotoNastaliqUrdu-Regular.ttf",
    "NotoSansMeeteiMayek-Regular.ttf": f"{_BASE}/NotoSansMeeteiMayek/NotoSansMeeteiMayek-Regular.ttf",
    "NotoSansOlChiki-Regular.ttf":     f"{_BASE}/NotoSansOlChiki/NotoSansOlChiki-Regular.ttf",
}

# System Arial — searched in order, first found is copied
ARIAL_SEARCH_PATHS = [
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]

# Liberation Sans — open-source Arial substitute used only if Arial is absent
_LIBERATION_URL = (
    "https://raw.githubusercontent.com/liberationfonts/liberation-fonts"
    "/refs/heads/main/src/LiberationSans-Regular.ttf"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _open_url(url: str, timeout: int = 60):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    return urllib.request.urlopen(req, timeout=timeout)


def download_font(filename: str, url: str, dest_dir: str) -> bool:
    dest = os.path.join(dest_dir, filename)

    if os.path.exists(dest):
        size = os.path.getsize(dest)
        if size > 50_000:
            print(f"  ✓  {filename:50s} already present ({size:,} bytes)")
            return True
        print(f"  ⚠  {filename} looks corrupt ({size} bytes) — re-downloading")
        os.remove(dest)

    print(f"  ↓  {filename:50s} ", end="", flush=True)
    try:
        with _open_url(url) as resp, open(dest, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
        size = os.path.getsize(dest)
        print(f"done  ({size:,} bytes)")
        return True
    except Exception as exc:
        print(f"FAILED\n       → {exc}")
        if os.path.exists(dest):
            os.remove(dest)
        return False


def copy_arial(dest_dir: str) -> bool:
    dest = os.path.join(dest_dir, "Arial.ttf")
    if os.path.exists(dest) and os.path.getsize(dest) > 50_000:
        print(f"  ✓  Arial.ttf                                         already present")
        return True

    for src in ARIAL_SEARCH_PATHS:
        if os.path.exists(src):
            shutil.copy2(src, dest)
            print(f"  ✓  Arial.ttf  copied from  {src}")
            return True

    # Download Liberation Sans as open-source substitute
    print(f"  ↓  Arial not found — downloading Liberation Sans … ", end="", flush=True)
    try:
        with _open_url(_LIBERATION_URL) as resp, open(dest, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
        print(f"done  ({os.path.getsize(dest):,} bytes)")
        return True
    except Exception as exc:
        print(f"FAILED\n       → {exc}")
        return False


def verify_fonts(fonts_dir: str):
    try:
        import fitz
    except ImportError:
        print("\n  [skip] PyMuPDF not installed — skipping fitz verification")
        return

    print("\n── Verifying fonts load correctly with PyMuPDF ──────────────")
    all_ok = True
    for fname in sorted(os.listdir(fonts_dir)):
        if not fname.lower().endswith(".ttf"):
            continue
        path = os.path.join(fonts_dir, fname)
        try:
            font = fitz.Font(fontfile=path)
            font.text_length("test", fontsize=14)   # forces glyph table load
            print(f"  ✓  {fname}")
        except Exception as exc:
            print(f"  ✗  {fname}  →  {exc}")
            all_ok = False

    print()
    if all_ok:
        print("  All fonts verified successfully ✓")
    else:
        print("  Some fonts failed — see ✗ lines above.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print(f"\n{'=' * 64}")
    print("  Noto Font Downloader  v2  —  Bilingual Question Bank API")
    print(f"{'=' * 64}")
    print(f"  Destination : {FONTS_DIR}\n")

    os.makedirs(FONTS_DIR, exist_ok=True)

    print("── Noto script fonts ────────────────────────────────────────")
    failed = []
    for filename, url in FONT_DOWNLOADS.items():
        if not download_font(filename, url, FONTS_DIR):
            failed.append(filename)

    print("\n── English / Latin fallback ─────────────────────────────────")
    if not copy_arial(FONTS_DIR):
        failed.append("Arial.ttf")

    verify_fonts(FONTS_DIR)

    print(f"\n{'=' * 64}")
    if failed:
        print(f"  ⚠  {len(failed)} file(s) failed to download:")
        for f in failed:
            print(f"       •  {f}")
        print(
            "\n  Troubleshooting:"
            "\n   1. Check your internet connection"
            "\n   2. GitHub may be rate-limiting — wait 60 s and re-run"
            "\n   3. Verify the URL manually in a browser:"
            f"\n      {_BASE}/<FolderName>/<FileName>.ttf"
        )
        sys.exit(1)
    else:
        total = len(FONT_DOWNLOADS) + 1
        print(f"  ✓  All {total} fonts ready in ./fonts/")
        print(f"{'=' * 64}\n")


if __name__ == "__main__":
    main()