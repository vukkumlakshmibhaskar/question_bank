from .constants import PageType, LANGUAGE_CONFIG

# ─────────────────────────────────────────────────────────────────────────────
# MASTER PROMPT BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def build_qp_prompt(classification: dict, profile_dict: dict, target_language: str) -> str:
    """
    Build the complete extraction prompt for a QP page.
    Classification comes from classifier.py.
    """
    page_type  = classification["type"]
    cfg        = classification["lang_config"]
    text       = classification.get("text", "")
    script     = cfg.get("script", "unknown")
    lang_name  = profile_dict.get("primary_language", target_language)

    # ── Section 1: Mode Declaration ──────────────────────────────────────
    mode_block = _build_mode_block(page_type, text, cfg)

    # ── Section 2: Language-Specific Rules ───────────────────────────────
    lang_block = _build_language_block(cfg, lang_name, target_language)

    # ── Section 3: Universal Structural Rules ────────────────────────────
    universal_block = _build_universal_rules(cfg)

    # ── Section 4: Output Format ─────────────────────────────────────────
    format_block = _build_format_block(cfg)

    return f"""
ROLE: Expert Exam Paper Extractor — {lang_name} ({script.upper()} SCRIPT)
════════════════════════════════════════════════════════════════════

{mode_block}

{lang_block}

{universal_block}

{format_block}
""".strip()


def build_ms_prompt(classification: dict, profile_dict: dict,
                    target_language: str, target_set: str) -> str:
    """Build the answer key extraction prompt."""
    page_type = classification["type"]
    cfg       = classification["lang_config"]
    text      = classification.get("text", "")
    lang_name = profile_dict.get("primary_language", target_language)

    mode_block = _build_mode_block(page_type, text, cfg)
    lang_block = _build_language_block(cfg, lang_name, target_language)

    return f"""
ROLE: Expert Marking Scheme Extractor — {lang_name}
════════════════════════════════════════════════════════════════════

TARGET SET: Extract answers ONLY for SET {target_set}.

{mode_block}

{lang_block}

MARKING SCHEME SPECIFIC RULES:
1. SET ISOLATION (CRITICAL): If you see a table with columns Set A | Set B | Set C,
   extract ONLY the column for SET {target_set}.
2. DUPLICATE FLAG: If a question for SET {target_set} maps to "same as Set A",
   set full_answer_text = "SAME_AS_SET_A" exactly.
3. OR ANSWERS: If answer has OR / अथवा / অথবা / یا split it: append _OR to q_sno.
4. MARKS: Extract only the numeric value (e.g. "2" not "2 marks").
5. MCQ ANSWERS: Extract the correct option letter (A/B/C/D or क/ख/ग/घ or அ/ஆ/இ/ஈ).
6. DESCRIPTIVE ANSWERS: Extract the key points, not essays.
7. DIAGRAM: If answer requires a diagram, set diagram_flag = true.

{_build_language_block(cfg, lang_name, target_language)}
""".strip()


# ─────────────────────────────────────────────────────────────────────────────
# SECTION BUILDERS
# ─────────────────────────────────────────────────────────────────────────────

def _build_mode_block(page_type: PageType, text: str, cfg: dict) -> str:
    """Build the extraction mode section."""

    if page_type == PageType.UNICODE_CLEAN:
        return f"""
EXTRACTION MODE: ✅ TEXT-GROUNDED
The text below was reliably extracted from the PDF.
Use it as your PRIMARY source for exact character sequences.
The image is for layout/structure context only.

─── VERIFIED TEXT (trust this) ──────────────────────────
{text[:3000] if text else "(no text)"}
─────────────────────────────────────────────────────────
""".strip()

    elif page_type == PageType.MIXED_BILINGUAL:
        return f"""
EXTRACTION MODE: ⚠️ BILINGUAL TEXT-GROUNDED
This page has TWO languages. The text below is partially reliable.
Read the image carefully to separate the two language versions.

─── EXTRACTED TEXT (use as reference, not ground truth) ──
{text[:3000] if text else "(no text)"}
─────────────────────────────────────────────────────────
""".strip()

    elif page_type == PageType.LEGACY_ENCODED:
        return """
EXTRACTION MODE: 🔴 VISION-ONLY (Legacy Font Encoding Detected)
The PDF uses a PROPRIETARY LEGACY FONT. All extracted text is garbage.
YOU MUST extract ALL content PURELY FROM THE IMAGE.
Character-by-character transcription from the image only.
DO NOT use any text data from this prompt.
""".strip()

    elif page_type == PageType.IMAGE_DOMINANT:
        return """
EXTRACTION MODE: 🔴 VISION-ONLY (Image-Embedded Questions)
Questions on this page are EMBEDDED AS IMAGES inside the PDF.
There is no text layer. Extract everything from visual content only.
Pay careful attention to printed question text in the image.
""".strip()

    elif page_type == PageType.SCANNED:
        return """
EXTRACTION MODE: 🔴 VISION-ONLY (Scanned Document)
This page was created from a physical scan. No digital text exists.
Transcribe everything visible in the image with maximum accuracy.
If any text is unclear or blurry, mark it with [UNCLEAR].
""".strip()

    elif page_type in (PageType.RTL_LEGACY, PageType.RTL_UNICODE):
        rtl_text = f"""
─── EXTRACTED TEXT (REFERENCE ONLY - may be in wrong order) ──
{text[:2000] if text else "(no Urdu text extracted)"}
──────────────────────────────────────────────────────────────
""" if text and page_type == PageType.RTL_UNICODE else ""

        return f"""
EXTRACTION MODE: 🔴 VISION-ONLY — RIGHT-TO-LEFT SCRIPT (Urdu/Nastaliq)
Urdu uses Nastaliq calligraphic script which reads RIGHT TO LEFT.
{
    "This PDF uses InPage encoding — text extraction is completely unreliable." 
    if page_type == PageType.RTL_LEGACY 
    else "Even with Unicode Urdu, RTL text may extract in wrong word order."
}
YOU MUST read the image right-to-left and transcribe characters exactly as printed.
{rtl_text}
""".strip()

    elif page_type == PageType.NEAR_EMPTY:
        return """
EXTRACTION MODE: ℹ️ NEAR-EMPTY PAGE
This page contains mainly instructions, cover info, or is blank.
Extract any question-like content if found, otherwise return empty questions list.
""".strip()

    return "EXTRACTION MODE: VISION-ONLY (Unknown page type)"


def _build_language_block(cfg: dict, lang_name: str, target_language: str) -> str:
    """Build the language-specific rules section."""
    script    = cfg.get("script", "unknown")
    direction = cfg.get("direction", "ltr")
    is_bilingual = cfg.get("bilingual", False)
    or_words  = cfg.get("or_words", ["OR"])
    opt_letters = cfg.get("option_letters", ["A", "B", "C", "D"])
    special   = cfg.get("special_rules", [])

    # Build option letters display
    opt_display = " / ".join(opt_letters[:4])

    # Build OR words display
    or_display = " / ".join(f'"{w}"' for w in or_words)

    bilingual_rule = ""
    if is_bilingual:
        secondary = cfg.get("secondary_language", "Hindi")
        bilingual_rule = f"""
BILINGUAL DOCUMENT HANDLING (CRITICAL):
- Every question appears TWICE: once in {lang_name} AND once in {secondary}
- Extract ONLY the {target_language if target_language != "Original" else lang_name} version
- Put the translation in question_header field (NOT question_text)
- NEVER concatenate both language versions into the same field
- The {lang_name} version is usually BOLD or appears FIRST
"""

    special_block = ""
    if special:
        special_block = "SUBJECT-SPECIFIC RULES:\n" + "\n".join(f"  • {r}" for r in special)

    return f"""
LANGUAGE SETTINGS:
  • Language:   {lang_name}
  • Script:     {script.upper()}
  • Direction:  {"RIGHT-TO-LEFT ← ← ←" if direction == "rtl" else "LEFT-TO-RIGHT → → →"}
  • MCQ Options: ({opt_display})
  • OR keyword: {or_display}
  • Target extraction language: {target_language}

CRITICAL SPELLING & DIACRITICS RULE: 
  • You are transcribing a complex regional script. 
  • You MUST NOT "guess" words based on context. 
  • Transcribe the text stroke-by-stroke exactly as it appears in the high-resolution image. 
  • Pay EXTREME attention to long vs. short vowels, secondary symbols, and dots. 
  • Re-read every word twice before outputting to ensure zero spelling mistakes.

{bilingual_rule}
{special_block}
""".strip()


def _build_universal_rules(cfg: dict) -> str:
    """Universal rules that apply to all languages."""
    or_words = " / ".join(f'"{w}"' for w in cfg.get("or_words", ["OR"]))

    return f"""
UNIVERSAL HIERARCHICAL EXTRACTION RULES:

1. THE "QUESTION GROUP" ARCHITECTURE (CRITICAL):
   You are extracting `question_groups`. A group consists of a Header and its Sub-Questions.
   - PASSAGES & INSTRUCTIONS: If there is a reading passage, a poem, or a main instruction (e.g., "Read the passage", "State True or False"), it MUST go into the `question_header` field. NEVER delete paragraphs.
   - SUB-QUESTIONS: The actual questions (e.g., (i), (ii)) go into the `sub_questions` list. 

2. THE "OR" / "{or_words}" PROTOCOL (CRITICAL):
   If a question gives a choice (e.g., Answer 44(i) and 44(ii) OR Answer 44(i) and 44(ii)), you MUST set `has_or_choice` to True. 
   - Put the first set of questions in `sub_questions`.
   - Put the second set of questions in `or_alternative_sub_questions`. 
   - NEVER overwrite or merge them.

3. OPTIONS: If a sub-question is Multiple Choice, put the options inside the `options` array for that specific sub-question. Do not include the letter (A/B/C/D) in the text.

4. STRIP FROM FIELDS:
   - Do NOT put question number at start of question_text
   - Do NOT put option letter at start of option fields
   - Strip leading punctuation like ।, ।।, :, -

5. NOT QUESTIONS (is_actual_test_question = FALSE):
   - General instructions / निर्देश / নির্দেশ / ہدایات
   - Section headers ([A], [B], भाग, خانہ) (unless they are attached to a specific question group, then they go in question_header)
   - Page numbers, footers

6. MATH & FORMULAS:
   - No LaTeX allowed
   - Use Unicode: x² not x^2, → not \\rightarrow, ½ not 1/2
   - Preserve all diacritics exactly as printed.

7. CROPS:
   - requires_crop = TRUE only for actual DIAGRAMS/MAPS/FIGURES
   - requires_crop = FALSE for math equations, text, fill-in-blanks
   - If unsure: FALSE
""".strip()


def _build_format_block(cfg: dict) -> str:
    """Output format reminder."""
    return """
OUTPUT FORMAT:
Return valid JSON matching the PageExtractionResult schema.
If this page has NO questions (cover, instructions), return empty questions list.
Temperature is set to minimum — do NOT hallucinate or guess characters.
""".strip()