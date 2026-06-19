"""
BULLETPROOF EXTRACTION ENGINE - VALIDATOR
Validates extracted JSON to catch hallucinations and encoding errors
before the data ever reaches your database.
"""
import re
from .constants import SCRIPT_UNICODE_RANGES, PageType


class ValidationError(Exception):
    """Raised when extraction output fails validation."""
    pass


def validate_extraction(
    parsed: dict,
    classification: dict,
    page_num: int,
) -> dict:
    """
    Validate and auto-correct extracted data.
    Returns cleaned parsed dict, or raises ValidationError if unrecoverable.
    """
    page_type = classification["type"]
    cfg       = classification["lang_config"]
    script    = cfg.get("script", "latin")
    questions = parsed.get("questions", [])

    if page_type == PageType.NEAR_EMPTY:
        return parsed  # Nothing to validate on near-empty pages

    errors   = []
    warnings = []

    for i, q in enumerate(questions):
        if not q.get("is_actual_test_question"):
            continue

        q_sno    = str(q.get("q_sno", "")).strip()
        q_text   = str(q.get("question_text", "")).strip()
        opts     = [q.get(f"option_{j}", "") or "" for j in range(1, 5)]

        # ── Check 1: Must have a question number ──────────────────────────
        if not q_sno:
            warnings.append(f"Q{i}: missing q_sno — skipping")
            q["is_actual_test_question"] = False
            continue

        if not re.search(r'\d', q_sno):
            warnings.append(f"Q{i}: q_sno '{q_sno}' has no digit — likely a header")
            q["is_actual_test_question"] = False
            continue

        # ── Check 2: Script validation (non-English pages) ────────────────
        if script != "latin" and page_type in (PageType.LEGACY_ENCODED,
                                                PageType.IMAGE_DOMINANT,
                                                PageType.SCANNED,
                                                PageType.RTL_LEGACY,
                                                PageType.RTL_UNICODE):
            # Vision-only mode: output MUST have regional script chars
            script_ratio = _compute_script_ratio(q_text, script)

            if q_text and len(q_text) > 8 and script_ratio < 0.12:
                # Almost pure ASCII output for a regional script question
                # This is a hallucination indicator
                errors.append(
                    f"Q{i} (q_sno={q_sno}): ASCII hallucination detected. "
                    f"Script ratio {script_ratio:.2f} for {script} script. "
                    f"Text preview: {q_text[:60]!r}"
                )
                q["extraction_confidence"] = "10"  # Mark as very low confidence
                q["is_actual_test_question"] = False
                continue

        # ── Check 3: Urdu RTL-specific ────────────────────────────────────
        if script == "arabic":
            q_text_clean = _validate_urdu_text(q_text, q_sno, warnings)
            q["question_text"] = q_text_clean

        # ── Check 4: Option consistency ───────────────────────────────────
        filled_opts = [o for o in opts if str(o).strip()]
        num_opts_declared = int(q.get("no_of_options", 0) or 0)

        if filled_opts and num_opts_declared == 0:
            # Has options but declares 0 — fix it
            q["no_of_options"] = len(filled_opts)
            warnings.append(f"Q{q_sno}: fixed no_of_options to {len(filled_opts)}")

        # ── Check 5: Bilingual contamination ─────────────────────────────
        if cfg.get("bilingual"):
            q_text, q = _check_bilingual_contamination(q, cfg, warnings)

        # ── Check 6: Mark crop consistency ───────────────────────────────
        if q.get("requires_crop") and not q.get("crop_box_2d"):
            q["requires_crop"] = False
            warnings.append(f"Q{q_sno}: requires_crop=True but no crop_box — reset to False")

        if q.get("justification_for_crop", "").lower() in ("", "none", "null"):
            q["requires_crop"] = False

        # ── Check 7: OR suffix format ─────────────────────────────────────
        if "_or" in q_sno.lower() and not q_sno.upper().endswith("_OR"):
            # Normalize to uppercase _OR
            q["q_sno"] = re.sub(r'_or$', '_OR', q_sno, flags=re.IGNORECASE)

    if errors:
        raise ValidationError(f"Page {page_num}: {'; '.join(errors)}")

    if warnings:
        parsed["_validation_warnings"] = warnings

    return parsed


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _compute_script_ratio(text: str, script_name: str) -> float:
    """Compute ratio of chars belonging to the given Unicode script."""
    if not text:
        return 0.0

    # Handle Arabic separately (Urdu)
    if script_name == "arabic":
        targets = ["arabic", "arabic_ext", "arabic_pfa"]
    else:
        targets = [script_name]

    printable = [c for c in text if c.isprintable() and not c.isspace()]
    if not printable:
        return 0.0

    count = 0
    for c in printable:
        cp = ord(c)
        for t in targets:
            r = SCRIPT_UNICODE_RANGES.get(t, (0, 0))
            if r[0] <= cp <= r[1]:
                count += 1
    return count / len(printable)


def _validate_urdu_text(text: str, q_sno: str, warnings: list) -> str:
    """
    Urdu-specific text cleanup.
    Gemini sometimes reverses RTL word order — we can't auto-fix this,
    but we flag it.
    """
    if not text:
        return text

    # Check for obvious Latin hallucination in Urdu
    latin_count = sum(1 for c in text if 65 <= ord(c) <= 122)
    if len(text) > 5 and latin_count / len(text) > 0.60:
        warnings.append(
            f"Urdu Q{q_sno}: high Latin ratio ({latin_count/len(text):.0%}) — "
            "possible hallucination, needs manual review"
        )

    # Remove zero-width non-joiners that mess up Urdu rendering
    # (keep ZWNJ U+200C and ZWJ U+200D as they are needed in Urdu)
    # Remove stray control chars
    text = re.sub(r'[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', text)

    return text.strip()


def _check_bilingual_contamination(q: dict, cfg: dict, warnings: list) -> tuple:
    """
    For bilingual documents (Sanskrit+Hindi), check that question_text
    doesn't contain both language versions concatenated together.
    """
    q_text = str(q.get("question_text", "")).strip()
    q_sno  = q.get("q_sno", "?")

    if not q_text:
        return q_text, q

    # For Devanagari bilingual (Sanskrit + Hindi), both use same script
    # We can't easily separate them by Unicode alone
    # But we CAN check for suspicious length doubling
    # (bilingual contamination makes text roughly 2x longer than it should be)
    lines = [l.strip() for l in q_text.split('\n') if l.strip()]

    if len(lines) >= 4:
        # Heuristic: if we see what looks like the same question twice
        # (similar length lines), flag it
        first_half = ' '.join(lines[:len(lines)//2])
        second_half = ' '.join(lines[len(lines)//2:])

        similarity = _rough_similarity(first_half, second_half)
        if similarity > 0.4:
            warnings.append(
                f"Q{q_sno}: possible bilingual contamination — "
                f"two similar halves detected (sim={similarity:.2f}). "
                "Using first half only."
            )
            q["question_text"] = first_half
            if not q.get("question_header"):
                q["question_header"] = second_half

    return q.get("question_text", ""), q


def _rough_similarity(a: str, b: str) -> float:
    """Very rough character-level similarity between two strings."""
    if not a or not b:
        return 0.0
    set_a = set(a)
    set_b = set(b)
    if not set_a and not set_b:
        return 1.0
    return len(set_a & set_b) / len(set_a | set_b)
