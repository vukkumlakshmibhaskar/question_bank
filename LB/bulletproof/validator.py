"""Basic validation helpers for extracted question rows."""
import re
from .constants import SCRIPT_UNICODE_RANGES

def script_ratio(text: str, script: str) -> float:
    if not text:
        return 0.0
    lo, hi = SCRIPT_UNICODE_RANGES.get(script, (0, 0))
    if lo == 0:
        return 1.0
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 0.0
    hits = sum(1 for c in chars if lo <= ord(c) <= hi)
    return hits / len(chars)

def is_correct_script(text: str, script: str, threshold: float = 0.25) -> bool:
    clean = text.strip()
    if len(clean) < 10:
        return True
    if script in ("latin", "unknown", "english"):
        return True
    return script_ratio(clean, script) >= threshold

def has_correct_answer(row: dict) -> bool:
    return any(row.get(f"Option{n} Is Correct?") == "Yes" for n in range(1, 5))

def is_mcq_row(row: dict) -> bool:
    try:
        return int(row.get("No. of Options/Blanks (Mandatory)") or 0) > 0
    except Exception:
        return False

def confidence_score(row: dict) -> int:
    score  = 100
    q_text = str(row.get("Question text(Mandatory)", "") or "")
    if not q_text.strip():
        score -= 40
        
    if is_mcq_row(row):
        opts = [str(row.get(f"Option{n} (Mandatory)", "") or "").strip() for n in range(1, 5)]
        if sum(1 for o in opts if o) < 2:
            score -= 20
            
    return max(0, score)
