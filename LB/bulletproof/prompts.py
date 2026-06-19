from .constants import PageType, LANGUAGE_CONFIG


def build_qp_prompt(classification, profile_dict, target_language):
    page_type = classification["type"]
    cfg = classification["lang_config"]
    text = classification.get("text", "")
    # OCR pre-pass text takes priority over PDF text extraction for vision-only pages
    ocr_text = classification.get("ocr_text", "")
    effective_text = ocr_text if ocr_text else text
    script = cfg.get("script", "unknown")
    lang_name = profile_dict.get("primary_language", target_language)
    return f"""
ROLE: Expert Exam Paper Extractor — {lang_name} ({script.upper()} SCRIPT)
{"="*68}
{_build_mode_block(page_type, effective_text, cfg, has_ocr=bool(ocr_text))}
{_build_language_block(cfg, lang_name, target_language)}
{_build_universal_rules(cfg)}
{_build_format_block(cfg)}
""".strip()


def build_ms_prompt(classification, profile_dict, target_language, target_set):
    page_type = classification["type"]
    cfg = classification["lang_config"]
    text = classification.get("text", "")
    ocr_text = classification.get("ocr_text", "")
    effective_text = ocr_text if ocr_text else text
    lang_name = profile_dict.get("primary_language", target_language)
    return f"""
ROLE: Expert Marking Scheme Extractor — {lang_name}
{"="*68}
TARGET SET: Extract answers ONLY for SET {target_set}.
{_build_mode_block(page_type, effective_text, cfg, has_ocr=bool(ocr_text))}
{_build_language_block(cfg, lang_name, target_language)}
MARKING SCHEME RULES:
1. SET ISOLATION: Extract ONLY the column for SET {target_set}.
2. DUPLICATE FLAG: If maps to same as Set A, set full_answer_text = "SAME_AS_SET_A".
3. OR ANSWERS: Append _OR to q_sno for OR alternatives.
4. MARKS: Numeric value only (e.g. "2" not "2 marks").
5. MCQ: Correct option letter only (A/B/C/D or language equivalent).
6. DIAGRAM: If answer requires diagram, set diagram_flag = true.
""".strip()


def _build_mode_block(page_type, text, cfg, has_ocr=False):
    if page_type == PageType.UNICODE_CLEAN:
        return f"""EXTRACTION MODE: TEXT-GROUNDED (IMAGE IS FINAL AUTHORITY)
The text below is a REFERENCE GUIDE only. PDF text extraction can silently
mis-encode conjuncts and diacritics even in Unicode documents.
Visually verify EVERY character against the image. If extracted text differs
from what is printed, trust the IMAGE not the text.
--- REFERENCE TEXT (verify every character against image) ---
{text[:5000] if text else "(no text)"}
-------------------------------------------------------------""".strip()

    elif page_type == PageType.MIXED_BILINGUAL:
        return f"""EXTRACTION MODE: BILINGUAL TEXT-GROUNDED (IMAGE IS FINAL AUTHORITY)
This page has TWO languages. Partial reference only. IMAGE beats extracted text.
--- REFERENCE TEXT (verify each char against image) ---
{text[:5000] if text else "(no text)"}
-------------------------------------------------------""".strip()

    elif page_type == PageType.LEGACY_ENCODED:
        if has_ocr and text:
            return f"""EXTRACTION MODE: VISION-FIRST with OCR HINT (Legacy Font)
The PDF uses a proprietary font -- text layer is garbage.
An OCR engine attempted to transcribe the text but MAY CONTAIN ERRORS,
especially for visually similar characters in regional scripts.

CRITICAL ACCURACY RULES:
1. Read EVERY word directly from the IMAGE -- do NOT copy OCR text blindly.
2. If OCR text conflicts with the image, TRUST THE IMAGE always.
3. The OCR hint below guides your reading but is NOT authoritative.
4. Pay special attention to conjuncts, matras, and subscript marks.

--- OCR HINT (may have errors -- always verify each word against image) ---
{text[:5000]}
---""".strip()
        return """EXTRACTION MODE: VISION-ONLY (Legacy Font Encoding)
All extracted text is garbage. Extract PURELY FROM THE IMAGE.
DO NOT use any text data from this prompt.""".strip()

    elif page_type == PageType.IMAGE_DOMINANT:
        if has_ocr and text:
            return f"""EXTRACTION MODE: OCR-GROUNDED (Image-Embedded — OCR Pre-Pass Applied)
Questions are embedded as images. OCR has transcribed the visible text.
Use the OCR text as your PRIMARY reference. IMAGE is final authority.
--- OCR TEXT ---
{text[:5000]}
---""".strip()
        return """EXTRACTION MODE: VISION-ONLY (Image-Embedded Questions)
No text layer. Extract everything from visual content only.""".strip()

    elif page_type == PageType.SCANNED:
        if has_ocr and text:
            return f"""EXTRACTION MODE: OCR-GROUNDED (Scanned Document — OCR Pre-Pass Applied)
Physical scan page. OCR has transcribed the visible text.
Use the OCR text as your PRIMARY reference. IMAGE is final authority for unclear chars.
--- OCR TEXT ---
{text[:5000]}
---""".strip()
        return """EXTRACTION MODE: VISION-ONLY (Scanned Document)
No digital text. Transcribe everything visible. Mark unclear text with [UNCLEAR].""".strip()

    elif page_type in (PageType.RTL_LEGACY, PageType.RTL_UNICODE):
        rtl_ref = f"--- REFERENCE TEXT (may be wrong order) ---\n{text[:4000]}\n---" if text and page_type == PageType.RTL_UNICODE else ""
        enc = "InPage encoding — text extraction is completely unreliable." if page_type == PageType.RTL_LEGACY else "RTL text may extract in wrong word order."
        if has_ocr and text:
            return f"""EXTRACTION MODE: 🟡 OCR-GROUNDED (Urdu/Nastaliq — OCR Pre-Pass Applied)
{enc}
An OCR engine has transcribed this page RIGHT-TO-LEFT. Use the OCR text
as your PRIMARY reference. IMAGE is final authority for diacritics and hamza.

─── OCR-EXTRACTED TEXT (RIGHT TO LEFT — verify each char against image) ──
{text[:4000]}
──────────────────────────────────────────────────────────────────────────

URDU PASSAGE QUESTION RULE (شعر / عبارت based questions):
When you see: "درج ذیل شعر کی روشنی میں" or "مندرجہ ذیل عبارت" followed by sub-questions (i)(ii)(iii):
  ✅ Put the FULL instruction line + FULL verse/passage in question_header of sub-question (i).
  ✅ Sub-questions (ii)(iii) have their own question_text only (no header).
  ❌ Do NOT create a parent row with empty question_text.
""".strip()
        return f"""EXTRACTION MODE: 🔴 VISION-ONLY (Urdu/Nastaliq, RIGHT TO LEFT)
{enc}
Read the image RIGHT-TO-LEFT and transcribe exactly as printed.

URDU PASSAGE QUESTION RULE (شعر / عبارت based questions):
When you see: "درج ذیل شعر کی روشنی میں" or "مندرجہ ذیل عبارت" followed by sub-questions (i)(ii)(iii):
  ✅ Put the FULL instruction line + FULL verse/passage in question_header of sub-question (i).
  ✅ Sub-questions (ii)(iii) have their own question_text only (no header).
  ❌ Do NOT create a parent row with empty question_text.
{rtl_ref}""".strip()


    elif page_type == PageType.NEAR_EMPTY:
        return """EXTRACTION MODE: NEAR-EMPTY PAGE
Extract any question-like content if found, otherwise return empty questions list.""".strip()

    return "EXTRACTION MODE: VISION-ONLY (Unknown page type)"


def _build_language_block(cfg, lang_name, target_language):
    script = cfg.get("script", "unknown")
    direction = cfg.get("direction", "ltr")
    is_bilingual = cfg.get("bilingual", False)
    or_words = cfg.get("or_words", ["OR"])
    opt_letters = cfg.get("option_letters", ["A", "B", "C", "D"])
    special = cfg.get("special_rules", [])

    opt_display = " / ".join(opt_letters[:4])
    or_display = " / ".join(f'"{w}"' for w in or_words)

    bilingual_rule = ""
    if is_bilingual:
        secondary = cfg.get("secondary_language", "Hindi")
        bilingual_rule = f"""
BILINGUAL HANDLING (CRITICAL):
- Every question appears TWICE: in {lang_name} AND in {secondary}
- Extract ONLY the {target_language if target_language != "Original" else lang_name} version
- Put the translation in question_header (NOT question_text)
- NEVER concatenate both language versions into the same field
- {lang_name} version is usually BOLD or appears FIRST"""

    special_block = ""
    if special:
        special_block = "\nSUBJECT-SPECIFIC RULES:\n" + "\n".join(f"  - {r}" for r in special)

    return f"""
LANGUAGE SETTINGS:
  Language: {lang_name} | Script: {script.upper()} | Direction: {"RIGHT-TO-LEFT" if direction == "rtl" else "LEFT-TO-RIGHT"}
  MCQ Options: ({opt_display}) | OR keyword: {or_display} | Extract: {target_language}

=== ACCURACY RULE 1: CHARACTER-LEVEL PRECISION ===
IMAGE IS THE FINAL AUTHORITY on every character.
- NEVER guess characters from context. Read each stroke from the image.
- Zoom into diacritics (dots, hooks, vowel signs) BEFORE typing them.
- Re-read every word in the image AFTER typing it.
- Do NOT substitute a visually-similar character for the correct one.
{_build_confusable_warnings(script)}

=== ACCURACY RULE 2: PROPER NOUNS (HIGHEST RISK CATEGORY) ===
{_build_proper_noun_rule(script, lang_name)}

=== ACCURACY RULE 3: INSTRUCTION WORDS & CONTEXT GUESSING ===
{_build_context_guessing_rule(cfg)}
{bilingual_rule}
{special_block}
""".strip()


def _build_confusable_warnings(script):
    W = {
        "devanagari": """
  Devanagari confusables (from real audit errors):
  - ं (anusvara dot)  vs  ँ (chandrabindu crescent+dot) — completely different nasals
  - ि (short i, LEFT of consonant)  vs  ी (long i, RIGHT) — direction matters
  - े (e, one hook)  vs  ै (ai, two hooks) — count the hooks
  - ो (o)  vs  ौ (au) — right side curve differs
  - ण (retroflex na, curled tail)  vs  न (dental na, straight base)
  - ष (retroflex sha, split top)  vs  श (palatal sha, smooth top)
  - ब (ba, closed loop left)  vs  व (va, open curve)
  - ् (halant/virama) — NEVER drop it; creates half-consonants in conjuncts
  - Conjuncts क्ष त्र ज्ञ श्र — do NOT split
  - Every diacritic dot visible in image MUST appear in output""",

        "bengali": """
  Bengali/Assamese confusables (from real audit errors):

  ── HIGHEST-RISK PROPER NOUNS (read EVERY character from image, do NOT guess) ──
  These exact words have been garbled in past extractions:
  • ছৌয়াছুঁয়ি  ← NOT হৈঁয়াহিয়ি  (ছ ≠ হ; য ≠ ি; ুঁ has chandrabindu)
  • চোট্টি / চোটি  ← NOT টোটি  (চ ≠ ট — completely different letter)
  • শোনপাংশু  ← NOT শোনপাকসু / গোপালগুরু  (ং+শু ≠ কসু)
  • আর্যদের  ← NOT আর্টের  (য in conjunct র্য ≠ ট)
  • ধ্বংস  ← NOT হংসস  (ধ্ব ≠ হ; ং never drops)
  • ডুমুরের ফুল  ← NOT ভূম্যুর ফল  (ড ≠ ভ)
  • তীর্থের কাক  ← NOT ঠোঁটের ডাক  (তী ≠ ঠো; র্থ ≠ টে; ক ≠ ড)
  • মদমত্ত হাতির  ← NOT দামাতু হরিতর / নামত হাতির  (read every syllable)
  • ঐলিৎ  ← NOT এলিফ  (ঐ ≠ এ; ৎ = khanda ta, NOT ফ)
  • ছাড়পত্র  ← NOT ছড়াপত্র  (preserve exactly as printed)
  • তীর (arrow/bow)  ← NOT তাঁর (his/her)  — critical in "চোটি মুণ্ডা এবং তার তীর"
  • বজ্রবিদারণ  ← NOT অজবিজরন  (বজ্র = thunderbolt; conjuncts র্বি ≠ জবি)
  • মন্ত্রতন্ত্র  ← NOT মস্তবড় / স্বতন্ত্র  (মন্ত্র+তন্ত্র; both halves must be preserved)
  • অঙ্গ বঙ্গ কলিঙ্গ  ← NOT অন্ধ বঙ্গ  (অঙ্গ = ancient region ≠ অন্ধ = blind)
  • পিৃতমুণ্ডা  ← NOT পূর্ণিমৃত্যু  (character name — do NOT substitute with any other word)
  • পশুর মত  ← NOT পস্তর মত  (পশু = animal ≠ পস্তর; র ≠ স্তর)
  • ভাঙা নয়  ← NOT ভাল নয়  (ভাঙ = broken ≠ ভাল = good — completely different)
  • কঙ্কাল  ← NOT জঞ্জাল  (skeleton ≠ debris — ক ≠ জ at start)
  • শ্রমের উৎপাদন  ← NOT অঙ্কের উৎপাদন  (শ্রম = labour ≠ অঙ্ক = arithmetic)

  ── LETTER-LEVEL CONFUSABLES ──
  - ছ (chha, curved top-right)  vs  হ (ha, open loop)  vs  ট (ta, small circle)  vs  ঠ (tha)
  - চ (ca, two hooks)  vs  ট (tta, small closed circle) — completely different shapes
  - ড (da)  vs  ভ (bha) — ড has straight descender; ভ has curved top
  - ৎ (khanda ta, final form)  vs  ফ (pha) — NEVER substitute ফ for ৎ
  - ঐ (ai, two parts)  vs  এ (e, simpler) — ঐ has extra stroke on top
  - ং (anusvara, circle+dot)  vs  ঁ (chandrabindu, moon+dot)  vs  ঃ (visarga, two dots)
  - ্ (hasanta/virama) — NEVER drop; forms ALL conjuncts (র্য, ধ্ব, ত্ত, ক্ষ, etc.)
  - ি (short i, LEFT hook)  vs  ী (long i, taller RIGHT hook) — direction + length differ
  - ে (e)  vs  ৈ (ai, wider curve) — curve width differs
  - ো (o)  vs  ৌ (au) — right hook shape differs
  - র (ra)  vs  ড় (dra, dot below)  vs  ৰ (Assamese ra) — dot below is critical
  - ব (ba)  vs  ভ (bha) — top curve shape differs
  - য (ja)  vs  য় (ya, dot below) — dot below changes sound entirely
  - Conjuncts র্য / ধ্ব / ত্ত / ক্ষ / ত্র / জ্ঞ — preserve exactly; NEVER split or simplify""",

        "tamil": """
  Tamil confusables (from real audit errors on Tamil QP papers):
  - ் (pulli/virama) — NEVER drop; changes entire word (உரைக்க is NOT உரைகக)
  - மூ  vs  பூ — மூ starts with curved மு, பூ starts with ப; check initial stroke
  - பரல் vs வரல் — ப (closed loop)  vs  வ (open curve); common mix-up
  - கெட்ட vs வெட்ட — க (ka)  vs  வ (va); completely different meanings
  - காவடி vs காலடி — வ (open loop)  vs  ல (downward tail)
  - எத்தெய்வ vs எதெதென் — do NOT guess; read stroke by stroke
  - ல  vs  ள (retroflex)  vs  ழ (zha) — three distinct letters, all look similar
  - ண  vs  ந  vs  ன — three different na letters
  - ற (rra, circular closed top)  vs  ர (ra, open top)
  - VOWEL LENGTH: ி (short i) is NOT ீ (long i) — always mark length""",

        "telugu": """
  Telugu confusables (from real audit errors):

  ── HIGHEST-RISK CONTENT WORDS (read every character — do NOT substitute) ──
  These exact words were garbled in past extractions:
  • నామధేయం  ← NOT నాయకుడయం  (completely different word)
  • పానుగంటివారి  ← NOT సానుగతినేగాని  (author name garbled)
  • అపారము  ← NOT ఆనందము  (అ ≠ ఆ at the start)
  • ధరాధరము  ← NOT ధర్మార్థం  (different word entirely)
  • కీచులాడుట  ← NOT కీచురాడు  (ట vs డు; లాడు dropped)
  • నిత్యం  ← NOT సత్యం  (న ≠ స)
  • తాళ్ళపాక తిమ్మక్క  ← do NOT replace with right-column item
  • మహోంద్రోదయం  ← NOT మహోదయం  (preserve full compound)
  • సాపర్ణ్యపాఖ్యానం  ← NOT సాదృశ్యభావం
  • పక్షి  ← NOT వృక్ష  (bird ≠ tree — completely different)
  • స్వర్గలోకము  ← NOT సూర్యరశ్మి
  • మార్గము  ← NOT మూర్ఖుడు
  • ఉత్తరము  ← NOT తటస్థము
  • ఇంద్రుడు  ← NOT బంధువు
  • యుక్తి  ← NOT యిసుక
  • మనసుపడుట  ← NOT మరుగునపడు

  ── MATCH-THE-COLUMN CRITICAL RULE ──
  Q3 has two columns (విభాగం-క and విభాగం-గ). Read LEFT column items for
  question_text/options. Do NOT substitute right-column text as the left item.
  The model has confused left and right column items in past extractions.

  ── QUESTION ORDERING CRITICAL RULE ──
  Questions Q6–Q9 each have 5 sub-items (a–e). Read each question's items
  ONLY from that question's block. Do NOT carry items from Q7 into Q6,
  or Q8 items into Q7 etc. Past extractions show a one-question shift error.

  ── LETTER-LEVEL CONFUSABLES ──
  - ్ (virama) — must appear in all conjuncts; do NOT drop
  - ం (anusvara)  vs  ః (visarga, two dots) — completely different
  - ి (short i)  vs  ీ (long i) — tail length differs
  - ె (short e)  vs  ే (long e)  vs  ై (ai) — count loops
  - న (na)  vs  స (sa)  vs  శ (sha) — initial strokes differ significantly
  - అ (a)  vs  ఆ (aa) — length of right arm differs
  - ట (tta)  vs  డ (dda) — top shape closed vs open
  - Ottulu (subscript) క్ష త్ర శ్ర — NEVER drop virama
  - Telugu numerals ౦౧౨౩౪౫౬౭౮౯ — preserve whichever is printed""",

        "kannada": """
  Kannada confusables (from real audit errors):
  - ್ (virama) — must appear in conjuncts; dropping changes word
  - ಂ (anusvara)  vs  ಃ (visarga) — different marks
  - ಿ (short i)  vs  ೀ (long i) — curve length differs
  - ಳ (retroflex la, horizontal bar)  vs  ಲ (dental la, no bar) — bar is critical
  - ಷ (sha, complex top)  vs  ಸ (sa, simpler top)
  - ಣ (retroflex na)  vs  ನ (dental na) — bottom curl differs
  - Kannada numerals ೦೧೨೩೪೫೬೭೮೯ — preserve if printed""",

        "malayalam": """
  Malayalam confusables (from real audit errors):
  - ്  (chandrakkala/virama) — critical for all conjuncts and chillus
  - ൻ ർ ൽ ൾ ൺ (chillu, standalone)  vs  forms with chandrakkala — match exactly
  - ി (short i)  vs  ീ (long i) — tail length
  - ൊ (short o)  vs  ോ (long o)  vs  ൌ/ൗ (au) — right side mark
  - ള vs ല vs ഴ — three different letters
  - Do NOT modernize old orthography — preserve exactly what is printed""",

        "gujarati": """
  Gujarati confusables (from real audit errors):
  - ્ (virama/halant) — do NOT drop in conjuncts
  - ં (anusvara)  vs  ઁ (chandrabindu)
  - િ (short i)  vs  ી (long i)
  - ુ (short u)  vs  ૂ (long u) — hook size
  - ગ (ga)  vs  ૬ (numeral 6) — check context
  - Gujarati has NO shirobindu (head-line) unlike Devanagari — do not add one
  - Gujarati numerals ૦૧૨૩૪૫૬૭૮૯ — preserve if printed""",

        "gurmukhi": """
  Punjabi/Gurmukhi confusables (from real audit errors):
  - ੰ (tippi, dot above-right)  vs  ਂ (bindi, dot above-left) — position differs
  - ੱ (addak, doubles next consonant) — NEVER drop; changes meaning
  - ਿ (short i)  vs  ੀ (long i)
  - ਣ (retroflex na)  vs  ਨ (dental na) — tail curl differs
  - ਲ਼ (lla, subscript dot)  vs  ਲ (la, no dot) — dot is critical
  - ਸ਼ (sha, subscript mark)  vs  ਸ (sa)
  PUNJABI QP STRUCTURE: Q1 has 14 MCQ sub-parts (i)-(xiv) across pages.
  Always label as 1(i)...1(xiv). Q6 comprehension sub-sections "1." and
  "2." are NOT new questions -- label as 6(i)...6(vi) and 6(vii)...6(xii).""",

        "odia": """
  Odia/Odiya confusables (from real audit errors):
  - ୍ (virama) — must appear in conjuncts; do NOT drop
  - ଂ (anusvara)  vs  ଁ (chandrabindu)
  - ି (short i)  vs  ୀ (long i)
  - ଯ-phala vs ବ-phala — preserve exactly as printed
  - Circular letter forms look similar — zoom in on curves
  - Odia numerals ୦୧୨୩୪୫୬୭୮୯ — preserve if printed""",

        "arabic": """
  Urdu/Nastaliq confusables (RIGHT TO LEFT — from real audit errors):
  - ء (hamza)  vs  ئ (ya+hamza)  vs  ؤ (waw+hamza) — three different letters
  - ے (barri ye)  vs  ی (choti ye)  vs  ى (alif maqsura) — three different letters
  - ک (kaf)  vs  گ (gaf) — گ has extra diagonal stroke; look for it
  - ر (ra, no dot)  vs  ز (zain, dot above) — dot is critical
  - ن (nun, dot above)  vs  ں (nun ghunna, no dot)
  - ب (ba, dot below)  vs  ت (ta, two dots above)  vs  ث (tha, three dots)
  - ہ vs ھ vs ه — three different forms
  - ۱۲۳ (Arabic-Indic) vs 1 2 3 (Latin) — preserve whichever is printed
  - DIRECTION: Read each line RIGHT-TO-LEFT. Do not reverse word order.""",
    }
    return W.get(script, "")


def _build_proper_noun_rule(script, lang_name):
    examples = {
        "tamil": (
            "- இராஜாஜி (printed) → DO NOT write இராஜராஜ (different person)\n"
            "  - ஐராவதீஸ்வரம் (printed) → DO NOT write ஜாதீஸ்வரம் (different temple)\n"
            "  - வேளாங்கண்ணி மாதா (printed) → DO NOT write வேங்கைகண்ணி மாதர்\n"
            "  - புறா (dove, printed) → DO NOT write புறநானூறு (a book)\n"
            "  - காவடி (printed) → DO NOT write காலடி"
        ),
        "devanagari": (
            "- राजाजी (printed) → DO NOT write राजाराज\n"
            "  - Any temple/town/river name — transcribe stroke by stroke"
        ),
        "bengali": (
            "- ছৌয়াছুঁয়ি (printed) → DO NOT write হৈঁয়াহিয়ি or চৌয়াছুঁয়ি\n"
            "  - চোট্টি / চোটি (printed) → DO NOT write টোটি or টোট্টি\n"
            "  - শোনপাংশু (printed) → DO NOT write শোনপাকসু or গোপালগুরু\n"
            "  - আর্যদের (printed) → DO NOT write আর্টের\n"
            "  - ধ্বংস (printed) → DO NOT write হংসস or ধংস\n"
            "  - ডুমুরের ফুল (printed) → DO NOT write ভূম্যুর ফল\n"
            "  - তীর্থের কাক (printed) → DO NOT write ঠোঁটের ডাক\n"
            "  - ঐলিৎ (printed) → DO NOT write এলিফ (ঐ ≠ এ; ৎ ≠ ফ)\n"
            "  - Any proverb, play title, poem title, character name — transcribe stroke by stroke"
        ),
        "telugu": (
            "- తాళ్ళపాక తిమ్మక్క (printed) → DO NOT write త్యాజ్యమైనది or any other word\n"
            "  - మహోంద్రోదయం (printed) → DO NOT write మహోదయం (preserve full compound)\n"
            "  - సాపర్ణ్యపాఖ్యానం (printed) → DO NOT write సాదృశ్యభావం\n"
            "  - పానుగంటివారి (printed) → DO NOT write సానుగతినేగాని\n"
            "  - గరుత్మంతుడు (printed) → DO NOT write గంధకమును (completely different)\n"
            "  - Match-the-column: left-column item (printed as author/title/word)\n"
            "    → DO NOT replace with the corresponding right-column answer text"
        ),
        "arabic": "- Historical figures, city names, book titles — copy exactly as printed",
    }
    ex = examples.get(script, "- Any person name, place name, temple name, book title — copy exactly as printed")
    return (
        f"Proper nouns are the HIGHEST RISK category for hallucination in {lang_name}.\n"
        f"  Model tends to substitute familiar-sounding alternatives. Do NOT do this.\n"
        f"  RULE: Transcribe every proper noun CHARACTER BY CHARACTER from the image.\n"
        f"  NEVER substitute a similar-sounding alternative, even if you are certain.\n"
        f"  Examples of errors to AVOID:\n"
        f"  {ex}"
    )


def _build_context_guessing_rule(cfg):
    script = cfg.get("script", "latin")
    lang_specific = ""
    if script == "tamil":
        lang_specific = (
            "\n  Tamil instruction words that often get substituted:\n"
            "  - ஒன்றினைக் (one of them)  is NOT  புள்ளிகளைக் (the points)\n"
            "  - உரைக்க (explain, with pulli)  is NOT  உரைகக (pulli missing)\n"
            "  - விளக்குக (explain) is NOT விளக்கமளிக்க\n"
            "  These words control how many items the student must answer."
        )
    elif script == "devanagari":
        lang_specific = (
            "\n  Hindi/Sanskrit instruction words:\n"
            "  - किन्हीं दो (any two) — check number word carefully\n"
            "  - स्पष्ट कीजिए (explain) vs वर्णन कीजिए (describe) — different instructions"
        )
    elif script == "bengali":
        lang_specific = (
            "\n  Bengali instruction words:\n"
            "  - যেকোনো দুটি (any two) — check the number\n"
            "  - ব্যাখ্যা করো (explain) vs বর্ণনা করো (describe) — different"
        )
    elif script == "telugu":
        lang_specific = (
            "\n  Telugu instruction words and HIGH-RISK content words:\n"
            "  - పర్యాయపదాలు (synonyms) vs నానార్థాలు (multiple meanings) vs జాతీయాలు (idioms)\n"
            "    — these are different question types; do NOT mix items between them\n"
            "  - ప్రకృతి-వికృతులు (Sanskrit/Telugu word pairs) vs సమాస పదాలు (compound words)\n"
            "  - నిత్యం ≠ సత్యం; అపారము ≠ ఆనందము; నామధేయం ≠ నాయకుడయం\n"
            "  - Each question's items must come ONLY from that question's block\n"
            "    (Q6 items ≠ Q7 items ≠ Q8 items — past extractions show a shift error)"
        )
    return (
        "Model sometimes fills in 'expected' words instead of reading what is printed.\n"
        "  RULE: Every content word must be READ from the image, not inferred.\n"
        "  Especially: instruction verbs, quantity words, subject references."
        + lang_specific
    )


def _build_universal_rules(cfg):
    or_words = " / ".join(f'"{w}"' for w in cfg.get("or_words", ["OR"]))
    return f"""
UNIVERSAL EXTRACTION RULES:

1. QUESTION NUMBERING (CRITICAL -- most common source of errors):

   RULE 1A -- PARENT NUMBER IS STICKY ACROSS PAGES:
   Once you see a question number (e.g. Q1, Q2, Q7), ALL sub-parts keep that
   parent number EVEN when they continue on the next page.
   CORRECT: Q1 has 14 sub-parts across 3 pages -- ALL labeled 1(i)...1(xiv).
   WRONG: Dropping the "1" when you turn the page -- bare "(iv)", "(v)", "(vi)".

   RULE 1B -- NEW QUESTION ONLY ON NEW STANDALONE NUMBER:
   Only increment parent when you see a new top-level number standing alone
   with its OWN marks (e.g. "2.", "3.", "Q.7"). Sub-parts (ক)(খ)(i)(ii) do
   NOT create a new parent question.

   RULE 1C -- NUMBERED SUB-SECTIONS INSIDE A QUESTION (COMPREHENSION):
   When Q6 has passages labeled "1." and "2." inside it, these are sub-sections
   of Q6, NOT new top-level questions.
   CORRECT: Q6 passage 1 part (ক) -> 6(ক); passage 2 part (ক) -> 6(vii).
   WRONG: Treating "2." as new question -> "2(ক)", "2(খ)".

   RULE 1D -- OR ALTERNATIVES: Append _OR to q_sno. Example: Q10 and Q10_OR.

2. QUESTION GROUP ARCHITECTURE & PASSAGE COMPLETENESS:

   RULE 2A — NO EMPTY PARENT ROWS (CRITICAL):
   When a question has a verse/passage/instruction FOLLOWED BY sub-questions (i)(ii)(iii):
   ❌ WRONG: Create a parent row Q21 with empty question_text, then Q21(i) Q21(ii) Q21(iii).
   ✅ CORRECT: Do NOT create a parent row. Put the FULL passage in the question_header
      of Q21(i) (the FIRST sub-question). Q21(ii) and Q21(iii) have no header.
   This applies to ALL languages: Urdu شعر, Hindi गद्यांश, Tamil பத்தி, etc.
   An empty question_text field means the row is useless — avoid it entirely.

   RULE 2B — PASSAGE COMPLETENESS:
   The question_header of the FIRST sub-question MUST contain the COMPLETE passage.
   Include the full instruction line (e.g. "درج ذیل شعر کی روشنی میں...") AND
   every line of the verse/passage. NEVER truncate. NEVER summarize.
   If a passage spans 200 words, all 200 words go in question_header of the first sub-question.
   If the passage starts at the bottom of one page and continues on the next page, keep it
   as ONE complete question_header. Do NOT create a separate empty continuation row.
   If an OR alternative crosses the page boundary, keep the first row and the _OR row
   logically paired; do NOT restart numbering from the top of the next page.

   RULE 2C — STANDALONE QUESTIONS:
   If a question has NO sub-parts and the question itself is a complete sentence,
   it goes in question_text. question_header is used only for the passage/instruction
   that precedes sub-questions.

   RULE 2D — SECTION INSTRUCTION LINES (CRITICAL — currently causing missing context):
   Exam papers often have a SECTION-LEVEL instruction line before the first sub-question.
   Examples:
     • "ఈ క్రింది బహుళైచ్ఛిక ప్రశ్నలకు నాలుగు సమాధానాలున్నాయి..." (MCQ instruction)
     • "క్రింది వాక్యాల్లోని భావార్థం అవునో కాదో నిర్ణయించి..." (True/False instruction)
     • "ఈ క్రింది పదాలను జతపరచండి." (Match instruction)
     • "درج ذیل میں سے صحیح جواب..." (Urdu MCQ instruction)
     • "निम्नलिखित प्रश्नों के उत्तर दीजिए" (Hindi instruction)
   These lines MUST be captured in the question_header of the FIRST sub-question.
   ❌ WRONG: Treat as is_actual_test_question=False and discard entirely.
   ✅ CORRECT: Put in question_header of the first sub-question (e.g. 1(a), 2(a), Q3(i)).
   Without this, a reviewer cannot know what TYPE of question it is (MCQ? True/False?
   Fill blank? Match?) or how many marks are involved. It is ESSENTIAL context.
   The cover page instructions (Roll No., general exam rules) are the ONLY instructions
   to ignore — question-section instructions must always be captured.

3. OR / {or_words} / "ANSWER ANY ONE" PROTOCOL (CRITICAL — READ FULLY):
   This covers TWO patterns — both require ALL sub-questions to be extracted:

   PATTERN A — Explicit OR between two alternatives:
   "Q26(i) [question text] (அல்லது/OR/अथवा) Q26(ii) [question text]"
   → Extract both as separate rows: q_sno = 26(i) and q_sno = 26(ii)_OR
   → If OR alternative is on the next page, STILL capture it.

   PATTERN B — "Choose/Write on ANY ONE of the following":
   Keywords: ఒకదాన్ని ఎన్నుకొని / ஏதேனும் ஒன்று / किन्हीं एक / ایک کا انتخاب
   Example: "Q16. Write an essay on any ONE: (a) topic1 (b) topic2 (c) topic3 (d) topic4"
   → Extract ALL alternatives as separate rows.
   → FIRST alternative: q_sno = 16(a), marks = 5
   → ALL SUBSEQUENT alternatives: q_sno = 16(b)_OR, 16(c)_OR, 16(d)_OR, marks = 5 each
   → The _OR suffix signals: student picks ONE; reviewer sees all options.
   → Put the section instruction ("ఒకదాన్ని ఎన్నుకొని వందపదాలలో రాయండి") in
     question_header of 16(a) ONLY.

   PATTERN C — "Answer any N of the following M questions":
   Keywords: নালুগু ప్రశ్నలకు / किन्हीं चार / ਕਿਸੇ ਚਾਰ / যে কোন চারটি / ఏయే నాలుగు
   Example: "Q13. Answer any 4 of the following 5: (ক)...(খ)...(গ)...(ঘ)...(ঙ)..."
   → Extract ALL M sub-questions as separate rows, each with per-question marks.
   → Per-question marks = total ÷ N_to_answer.
   → FIRST sub-question: q_sno = 13(ক), no suffix.
   → ALL REMAINING sub-questions: q_sno = 13(খ), 13(গ), 13(ঘ), 13(ঙ) — NO _OR suffix.
   ⚠️ CRITICAL: "যে কোন চারটি" / "any 4 of 5" is PATTERN C, NOT Pattern A or B.
      Do NOT mark any sub-question as _OR. All M items are independent options;
      student chooses N. The _OR suffix is ONLY for "OR" alternates in Pattern A/B.

4. MATCH-THE-FOLLOWING (পাঠক্রম অবলম্বনে / பொருத்துக / मिलान / সমিলান):
   - BOTH columns MUST be captured in a SINGLE row.
   - question_text = the full instruction line (e.g. "পাঠক্রম অবলম্বনে প্রথম তালিকার সাথে…করুন")
   - Left column items → option_1 through option_5 (as "(a) কাঙারী ছশিয়ার", etc.)
   - Right column items → include ALL in question_text after instruction:
     "Match: (i) তাদের নাকের কাছে... / (ii) এসেছে নতুন শিশু... / ..."
   - Do NOT create an empty parent row with None question_text.
   - Do NOT capture only one column.
   - This is a SINGLE extracted row, NOT multiple rows.

5. OPTIONS — DETECTION AND STRIPPING:

   WHEN to set no_of_options > 0 (MCQ):
   ONLY when you can see actual option blocks printed below the question stem.
   Option blocks look like: "(அ) choice1  (ஆ) choice2  (இ) choice3  (ஈ) choice4"
   or "(A) choice1  (B) choice2  (C) choice3  (D) choice4" in any language.
   You MUST see the option texts in the image to set no_of_options.

   WHEN to set no_of_options = 0 (Short Answer / Fill-in-blank):
   ❌ No option blocks visible below the question stem → no_of_options = 0
   ❌ The "அ." or "a." prefix on a question is a SUB-QUESTION label, NOT an MCQ option.
      Example: "3. அ. உரிமைச் செம்பயிரில் தமிழ் என்னவாக இருக்கிறது ?"
               The "அ." here means "sub-question a", not "MCQ option A".
   ❌ A section header saying [14×1=14] does NOT mean 14 MCQ questions with 4 options each.
      It means 14 questions worth 1 mark each — they may be short answer.

   If you set no_of_options=4 but cannot write any text into Option1–Option4,
   that is a contradiction — reset no_of_options to 0 instead.

   STRIP option letter prefix from inside option text:
   Strip: (A)(B)(C)(D), (அ)(ஆ)(இ)(ஈ), (क)(ख)(ग)(घ), (অ)(আ)(ই)(ঈ), (అ)(బ)(క)(డ)

6. FILL-IN-THE-BLANK SUB-QUESTIONS:
   If question has (i) ___ and (ii) ___, split into separate sub-questions: 20(i) and 20(ii).
   Do NOT merge multiple fill-in-blank items into a single row.

7. MARKS (CRITICAL):
   - Extract the marks number exactly as printed next to the question.

   TYPE A — "Choose ANY ONE of N alternatives" (essay topics, poem options, etc.):
   The section marks = marks for ONE answered question. Each alternative row gets
   the FULL section marks. Example: Q16 [5], 4 topics → each row gets marks=5.
   Alternatives 2+ get _OR suffix. Only ONE will be answered.

   TYPE B — "Answer any N of M sub-questions" (e.g. Q19: any 4 of 8, [4×3=12]):
   Per-sub-question marks = total ÷ N_to_answer = 12 ÷ 4 = 3.
   Each of the M rows gets marks=3. Extractor captures all M.
   Student answers N; reviewer needs all M to know the options.

   TYPE C — "Answer ANY TWO/THREE" where each has its own marks printed:
   Use the printed marks per sub-question directly.

   NEVER leave marks blank/NaN on extracted sub-questions.
   If marks are only on the section heading, apply the formula above.

11. COMPLETENESS (CRITICAL -- currently causing missing questions):
   Before returning your JSON, scan the page top-to-bottom and COUNT every
   question/sub-question visible. Your output MUST include every single one.
   Common failure: stopping after 3-4 sub-questions when the page has 6-8.
   If your questions list count is less than what you counted on the page,
   add the missing ones before returning.

   BENGALI COMPLETENESS CHECK — known failure patterns:
   Q5 has FOUR sub-questions (ক)(খ)(গ)(ঘ) [1×4=4] on page 4 — all must be extracted.
   Q6 has SIX sub-questions (ক)(খ)(গ)(ঘ)(ঙ)(চ) [1×6=6] across pages 4–5 — all 6 required.
   Q7 has FIVE sub-questions (ক)(খ)(গ)(ঘ)(ঙ) spread across two pages.
   Do NOT stop at (গ). Continue reading onto the next page to find (ঘ)(ঙ).
   Any question with a marks header like "1×5=5" MUST produce exactly 5 rows.
   Count the sub-parts printed on the page — if you have fewer rows than
   sub-parts counted, you are missing some. Go back and add them.

   TELUGU COMPLETENESS CHECK — known failure patterns:
   Q1 is marked [10×1=10] meaning EXACTLY 10 sub-questions (a–j).
   Sub-parts (a–d) appear on page 2; (e–j) continue on page 3.
   Do NOT stop at (d). Carry the parent "1." across the page boundary.
   Similarly Q17 and Q18 on page 7 MUST be extracted — do not skip late pages.
   For any question marked [4×3=12] or [2×6=12], extract ALL sub-items.

8. NOT QUESTIONS (is_actual_test_question = FALSE):
   - General instructions, section headers, page numbers, footers.

9. MATH: No LaTeX. Use Unicode: x² not x^2, → not \\rightarrow.

10. CROPS:
    - requires_crop = TRUE only for actual DIAGRAMS/MAPS/FIGURES.
    - FALSE for math, text, fill-in-blanks. If unsure: FALSE.
""".strip()


def _build_format_block(cfg):
    return """
OUTPUT FORMAT:
Return valid JSON matching the PageExtractionResult schema.
If this page has NO questions (cover, instructions), return empty questions list.
Temperature is set to minimum — do NOT hallucinate or guess characters.
""".strip()
