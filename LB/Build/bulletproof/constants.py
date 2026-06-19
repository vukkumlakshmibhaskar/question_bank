"""
BULLETPROOF EXTRACTION ENGINE - CONSTANTS
Complete coverage for all 16 language folders:
Assamese, Bengali, English, Gujarati, Hindi, Hindi+English,
Kannada, Malayalam, Marathi, Odiya, Punjabi, Sanskrit,
Tamil, Telugu, Urdu
"""

from enum import Enum

# ─────────────────────────────────────────────────────────────────────────────
# 1. UNICODE SCRIPT BLOCKS
# Every Indian script has a dedicated Unicode block.
# These ranges are used to measure how much of a page belongs to each script.
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_UNICODE_RANGES = {
    "devanagari":     (0x0900, 0x097F),  # Hindi, Sanskrit, Marathi, Maithili
    "bengali":        (0x0980, 0x09FF),  # Bengali AND Assamese (same block)
    "gurmukhi":       (0x0A00, 0x0A7F),  # Punjabi
    "gujarati":       (0x0A80, 0x0AFF),
    "odia":           (0x0B00, 0x0B7F),  # Odiya / Odia / Oriya
    "tamil":          (0x0B80, 0x0BFF),
    "telugu":         (0x0C00, 0x0C7F),
    "kannada":        (0x0C80, 0x0CFF),
    "malayalam":      (0x0D00, 0x0D7F),
    "arabic":         (0x0600, 0x06FF),  # Urdu (uses Arabic script)
    "arabic_pfa":     (0xFB50, 0xFDFF),  # Arabic Presentation Forms-A (Urdu ligatures)
    "arabic_pfb":     (0xFE70, 0xFEFF),  # Arabic Presentation Forms-B
    "devanagari_ext": (0xA8E0, 0xA8FF),  # Vedic extensions (some Sanskrit texts)
}

# ─────────────────────────────────────────────────────────────────────────────
# 2. LEGACY FONT DATABASE
# Maps font-name substrings → (script, encoding_type)
#
# encoding_type values:
#   "bijoy"       - Bengali/Assamese Bijoy keyboard legacy
#   "iscii"       - Indian Script Code for Information Interchange
#   "tscii"       - Tamil Script Code for Information Interchange
#   "inpage"      - Urdu InPage proprietary encoding
#   "kruti"       - Devanagari Kruti Dev family
#   "nudi"        - Kannada Nudi government standard
#   "akruti_odia" - Odia Akruti legacy
#   "cdac"        - CDAC legacy (various scripts)
#   "legacy"      - Generic unidentified legacy
#   "unicode"     - Actually Unicode — no problem
# ─────────────────────────────────────────────────────────────────────────────
LEGACY_FONT_MAP = {

    # ── Devanagari (Hindi / Sanskrit / Marathi) ─────────────────────────────
    "krutidev":           ("devanagari", "kruti"),
    "kruti dev":          ("devanagari", "kruti"),
    "dvb-ttsurekh":       ("devanagari", "kruti"),
    "dvb":                ("devanagari", "kruti"),
    "shivaji":            ("devanagari", "kruti"),
    "shusha":             ("devanagari", "kruti"),
    "chanakya":           ("devanagari", "kruti"),
    "aakar":              ("devanagari", "kruti"),
    "priya":              ("devanagari", "kruti"),
    "akruti":             ("devanagari", "iscii"),
    "iscii":              ("devanagari", "iscii"),
    "saraswati":          ("devanagari", "kruti"),
    "yogesh":             ("devanagari", "kruti"),
    "walkman chanakya":   ("devanagari", "kruti"),
    "web dunia":          ("devanagari", "kruti"),
    "lekhani":            ("devanagari", "kruti"),  # Marathi-specific
    "sharda":             ("devanagari", "kruti"),  # Marathi-specific
    "kiran":              ("devanagari", "kruti"),  # Marathi-specific
    # Unicode Devanagari — these are fine
    "mangal":             ("devanagari", "unicode"),
    "aparajita":          ("devanagari", "unicode"),
    "utsaah":             ("devanagari", "unicode"),
    "kokila":             ("devanagari", "unicode"),

    # ── Bengali & Assamese ──────────────────────────────────────────────────
    "sutonn":             ("bengali", "bijoy"),
    "sutonnmj":           ("bengali", "bijoy"),
    "sutonny mj":         ("bengali", "bijoy"),
    "kalpurush":          ("bengali", "bijoy"),
    "adarsha lipi":       ("bengali", "bijoy"),
    "boishakhi":          ("bengali", "bijoy"),
    "likhan":             ("bengali", "bijoy"),
    "bijoy":              ("bengali", "bijoy"),
    "nikosh":             ("bengali", "bijoy"),
    "assamese bijoy":     ("bengali", "bijoy"),
    # Unicode Bengali/Assamese
    "vrinda":             ("bengali", "unicode"),
    "shonar bangla":      ("bengali", "unicode"),

    # ── Tamil ───────────────────────────────────────────────────────────────
    "tsc":                ("tamil", "tscii"),
    "tab":                ("tamil", "tscii"),
    "tam ":               ("tamil", "tscii"),
    "bamini":             ("tamil", "tscii"),
    "murasoli":           ("tamil", "tscii"),
    "nalini":             ("tamil", "tscii"),
    "tscu":               ("tamil", "tscii"),
    "adhawin":            ("tamil", "tscii"),
    "boopalam":           ("tamil", "tscii"),
    "latha":              ("tamil", "unicode"),
    "vijaya":             ("tamil", "unicode"),

    # ── Urdu ────────────────────────────────────────────────────────────────
    "inpage":             ("urdu", "inpage"),
    "noorinastaleeq":     ("urdu", "inpage"),
    "nafees web naskh":   ("urdu", "inpage"),
    "alvi nastaleeq":     ("urdu", "inpage"),
    "faiz lahori":        ("urdu", "inpage"),
    "jameel noori":       ("urdu", "inpage"),
    "jameel nastaleeq":   ("urdu", "inpage"),
    "mehr nastaleeq":     ("urdu", "inpage"),
    "gulzar nastaleeq":   ("urdu", "inpage"),
    "urdu typesetting":   ("urdu", "unicode"),
    "noto nastaliq":      ("urdu", "unicode"),

    # ── Telugu ──────────────────────────────────────────────────────────────
    "gautami":            ("telugu", "legacy"),
    "vani":               ("telugu", "legacy"),
    "rama":               ("telugu", "legacy"),
    "krishna":            ("telugu", "legacy"),
    "hemalatha":          ("telugu", "legacy"),

    # ── Kannada ─────────────────────────────────────────────────────────────
    "nudi":               ("kannada", "nudi"),
    "baraha kannada":     ("kannada", "nudi"),
    "kedage":             ("kannada", "nudi"),
    "malige":             ("kannada", "nudi"),
    "benne":              ("kannada", "nudi"),
    "tunga":              ("kannada", "unicode"),

    # ── Malayalam ───────────────────────────────────────────────────────────
    "ml-tt":              ("malayalam", "legacy"),
    "ml karthika":        ("malayalam", "legacy"),
    "thoolika":           ("malayalam", "legacy"),
    "rachana":            ("malayalam", "unicode"),
    "meera":              ("malayalam", "unicode"),

    # ── Gujarati ────────────────────────────────────────────────────────────
    "harshu":             ("gujarati", "legacy"),
    "krishna gujarati":   ("gujarati", "legacy"),
    "saumil":             ("gujarati", "legacy"),
    "shruti":             ("gujarati", "unicode"),

    # ── Odia ────────────────────────────────────────────────────────────────
    "akruti orissa":      ("odia", "akruti_odia"),
    "akruti ori":         ("odia", "akruti_odia"),
    "cdac-oriya":         ("odia", "cdac"),
    "utkal":              ("odia", "akruti_odia"),
    "kalinga":            ("odia", "unicode"),

    # ── Punjabi ─────────────────────────────────────────────────────────────
    "gurbani lipi":       ("gurmukhi", "legacy"),
    "amritlipi":          ("gurmukhi", "legacy"),
    "raavi":              ("gurmukhi", "unicode"),

    # ── Generic ─────────────────────────────────────────────────────────────
    "baraha":             ("generic", "baraha"),
    "isfoc":              ("generic", "isfoc"),
}


# ─────────────────────────────────────────────────────────────────────────────
# 3. COMPLETE LANGUAGE CONFIGURATION
# One entry per language folder.
# ─────────────────────────────────────────────────────────────────────────────
LANGUAGE_CONFIG = {

    "tamil": {
        "script": "tamil", "folder_name": "Tamil", "direction": "ltr",
        "min_zoom": 2.0, "use_png": True, "bilingual": False,
        "common_legacy": ["tscii"],
        "option_letters": ["அ", "ஆ", "இ", "ஈ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["அல்லது"],
        "section_words": ["பகுதி", "பிரிவு"],
        "special_rules": [
            "TSCII legacy encoding is very common in NIOS Tamil papers",
            "Tamil MCQ options: (அ)(ஆ)(இ)(ஈ) or (A)(B)(C)(D)",
            "Tamil OR alternative: 'அல்லது'",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "hindi": {
        "script": "devanagari", "folder_name": "Hindi", "direction": "ltr",
        "min_zoom": 1.75, "use_png": True, "bilingual": False,
        "common_legacy": ["kruti", "iscii"],
        "option_letters": ["क", "ख", "ग", "घ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["अथवा", "या"],
        "section_words": ["भाग", "खण्ड"],
        "special_rules": [
            "Kruti Dev is extremely common in NIOS Hindi papers — treat as LEGACY",
            "Hindi MCQ options: (क)(ख)(ग)(घ)",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "hindi_and_english": {
        "script": "devanagari", "folder_name": "Hindi and English", "direction": "ltr",
        "min_zoom": 1.75, "use_png": True, "bilingual": True,
        "secondary_language": "English",
        "common_legacy": ["kruti", "iscii"],
        "option_letters": ["क", "ख", "ग", "घ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["अथवा", "या", "OR"],
        "section_words": ["भाग", "खण्ड", "Section"],
        "special_rules": [
            "Questions appear in BOTH Hindi (Devanagari) AND English (Latin)",
            "Extract Hindi version as question_text",
            "Extract English version as question_header",
            "MCQ options appear in both scripts — extract Hindi version only",
        ],
        "validation_min_ratio": 0.20,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "english": {
        "script": "latin", "folder_name": "English", "direction": "ltr",
        "min_zoom": 1.5, "use_png": False, "bilingual": False,
        "common_legacy": [],
        "option_letters": ["A", "B", "C", "D"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["OR"],
        "section_words": ["Section", "Part"],
        "special_rules": [],
        "validation_min_ratio": 0.0,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "sanskrit": {
        "script": "devanagari", "folder_name": "Sanskrit", "direction": "ltr",
        "min_zoom": 1.75, "use_png": True, "bilingual": True,
        "secondary_language": "Hindi",
        "common_legacy": ["kruti", "iscii"],
        "option_letters": ["क", "ख", "ग", "घ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["अथवा", "वा"],
        "section_words": ["भाग", "खण्ड"],
        "special_rules": [
            "Every question appears TWICE: Sanskrit first, Hindi translation below",
            "Extract Sanskrit as question_text, Hindi as question_header",
            "NEVER concatenate both — they are the same question in two languages",
            "Preserve all diacritics exactly: ṭ ḍ ṇ ś ṣ ñ ṃ ḥ ā ī ū",
            "Vyakaran: grammar sutras must be verbatim with anubandhas",
            "Sahitya: shloka metre and line breaks must be preserved",
        ],
        "validation_min_ratio": 0.30,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "urdu": {
        "script": "arabic", "folder_name": "Urdu", "direction": "rtl",
        "min_zoom": 2.5, "use_png": True, "bilingual": False,
        "common_legacy": ["inpage"],
        "option_letters": ["الف", "ب", "ج", "د"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["یا", "اتھوا"],
        "section_words": ["حصہ", "سیکشن"],
        "special_rules": [
            "Urdu reads RIGHT TO LEFT — all text is RTL",
            "InPage is the primary Urdu DTP software — ALWAYS vision-only",
            "Even Unicode Urdu may extract in wrong word order",
            "Nastaliq ligatures span multiple characters — preserve exactly",
            "Question numbers: ۱۲۳ (Arabic-Indic) or 1 2 3 — both valid",
            "Hamza variants (ء ئ ؤ) are different — do not substitute",
            "Final ya (ے ی) vs alif maqsura (ى) are different characters",
        ],
        "validation_min_ratio": 0.20,
        "preferred_model": "gemini-2.5-pro",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": True,
    },

    "bengali": {
        "script": "bengali", "folder_name": "Bengali", "direction": "ltr",
        "min_zoom": 2.0, "use_png": True, "bilingual": False,
        "common_legacy": ["bijoy"],
        "option_letters": ["ক", "খ", "গ", "ঘ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["অথবা", "বা"],
        "section_words": ["বিভাগ", "অংশ"],
        "special_rules": [
            "Bijoy encoding is DOMINANT in Bengali papers — treat as LEGACY by default",
            "Bengali conjunct consonants (যুক্তাক্ষর) must be preserved",
            "Hasanta (্) joins consonants — critical",
            "Anusvar (ং) Visarga (ঃ) Chandrabindu (ঁ) must not be dropped",
            "Bengali numerals: ০১২৩৪৫৬৭৮৯",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "assamese": {
        "script": "bengali",  # Same Unicode block as Bengali
        "folder_name": "Assamese", "direction": "ltr",
        "min_zoom": 2.0, "use_png": True, "bilingual": False,
        "common_legacy": ["bijoy"],
        "option_letters": ["ক", "খ", "গ", "ঘ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["নাইবা", "বা"],
        "section_words": ["বিভাগ", "অংশ"],
        "special_rules": [
            "Assamese uses the SAME Unicode block as Bengali (U+0980–U+09FF)",
            "Assamese-specific letters: ৱ (wa) and ৰ (ra) — Bengali lacks these",
            "Same Bijoy legacy encoding as Bengali — treat identically",
            "Do NOT transliterate to Bengali — they are different languages",
            "Assamese numerals: ০১২৩৪৫৬৭৮৯",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "gujarati": {
        "script": "gujarati", "folder_name": "Gujarati", "direction": "ltr",
        "min_zoom": 1.75, "use_png": True, "bilingual": False,
        "common_legacy": ["legacy"],
        "option_letters": ["અ", "બ", "ક", "ડ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["અથવા", "કે"],
        "section_words": ["વિભાગ", "ભાગ"],
        "special_rules": [
            "Gujarati shares visual DNA with Devanagari but is a separate script",
            "Shruti is the standard Windows Unicode font — text extraction works",
            "Legacy fonts (Aakar, Harshu) are ISCII-based — vision-only",
            "Gujarati numerals: ૦૧૨૩૪૫૬૭૮૯ (also Arabic 0-9)",
        ],
        "validation_min_ratio": 0.30,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "kannada": {
        "script": "kannada", "folder_name": "Kannada", "direction": "ltr",
        "min_zoom": 2.0, "use_png": True, "bilingual": False,
        "common_legacy": ["nudi"],
        "option_letters": ["ಅ", "ಬ", "ಕ", "ಡ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["ಅಥವಾ", "ಇಲ್ಲವೇ"],
        "section_words": ["ಭಾಗ", "ವಿಭಾಗ"],
        "special_rules": [
            "Nudi fonts are Karnataka government standard — very common in NIOS papers",
            "Baraha is another Kannada legacy encoding",
            "Kannada vowel signs attach to consonants — preserve as units",
            "Unique characters: ಳ (retroflex la) must be preserved",
            "Kannada numerals: ೦೧೨೩೪೫೬೭೮೯",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "malayalam": {
        "script": "malayalam", "folder_name": "Malayalam", "direction": "ltr",
        "min_zoom": 2.0, "use_png": True, "bilingual": False,
        "common_legacy": ["legacy"],
        "option_letters": ["A", "B", "C", "D"],
        "option_letters_alt": ["അ", "ആ", "ഇ", "ഈ"],
        "or_words": ["അല്ലെങ്കിൽ", "അഥവാ"],
        "section_words": ["ഭാഗം", "വിഭാഗം"],
        "special_rules": [
            "ML-TT prefix fonts are legacy (ML-TTRevathi, ML-TTKarthika) — vision-only",
            "Rachana, Meera, Anjali fonts are Unicode — text extraction works",
            "Chillu letters (ൻ ർ ൽ ൾ ൺ) must be preserved exactly",
            "Malayalam has the largest character set among Indian scripts — high zoom required",
            "Old vs new orthography (2002 Unicode reform) — preserve exactly as printed",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "marathi": {
        "script": "devanagari",  # Same script as Hindi
        "folder_name": "Marathi", "direction": "ltr",
        "min_zoom": 1.75, "use_png": True, "bilingual": False,
        "common_legacy": ["kruti", "iscii"],
        "option_letters": ["अ", "ब", "क", "ड"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["किंवा", "अथवा"],
        "section_words": ["भाग", "विभाग"],
        "special_rules": [
            "Marathi uses Devanagari script — same as Hindi but different language",
            "Lekhani, Sharda, all Kruti Dev variants are common legacy fonts",
            "Unique character: ळ (retroflex la) — must be preserved",
            "Marathi anusvara differs from Hindi — preserve exactly",
            "Do NOT confuse Marathi with Hindi — separate language",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "odiya": {
        "script": "odia", "folder_name": "Odiya", "direction": "ltr",
        "min_zoom": 2.0, "use_png": True, "bilingual": False,
        "common_legacy": ["akruti_odia", "cdac"],
        "option_letters": ["A", "B", "C", "D"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["ଅଥବା", "ବା"],
        "section_words": ["ବିଭାଗ", "ଅଂଶ"],
        "special_rules": [
            "Akruti Orissa and CDAC fonts are dominant in Odisha government — LEGACY",
            "Odia circular letter forms require minimum 2.0x zoom",
            "Odia numerals: ୦୧୨୩୪୫୬୭୮୯",
            "Ya-phala conjuncts must be preserved exactly",
            "Anusvara (ଁ) and chandrabindu are distinct — do not confuse",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "punjabi": {
        "script": "gurmukhi", "folder_name": "Punjabi", "direction": "ltr",
        "min_zoom": 1.75, "use_png": True, "bilingual": False,
        "common_legacy": ["legacy"],
        "option_letters": ["A", "B", "C", "D"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["ਜਾਂ", "ਅਥਵਾ"],
        "section_words": ["ਭਾਗ", "ਵਿਭਾਗ"],
        "special_rules": [
            "Gurmukhi script — do NOT confuse with Devanagari",
            "Raavi is the standard Windows Unicode Gurmukhi — text extraction works",
            "Unique characters: ਣ ਲ਼ ਸ਼ — preserve exactly",
            "Tippi (ੰ) and Bindi (ਂ) are different diacritics",
            "Exams typically use Arabic numerals 0-9",
        ],
        "validation_min_ratio": 0.30,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },

    "telugu": {
        "script": "telugu", "folder_name": "Telugu", "direction": "ltr",
        "min_zoom": 2.0, "use_png": True, "bilingual": False,
        "common_legacy": ["legacy"],
        "option_letters": ["అ", "బ", "క", "డ"],
        "option_letters_alt": ["A", "B", "C", "D"],
        "or_words": ["లేదా", "అథవా"],
        "section_words": ["భాగం", "విభాగం"],
        "special_rules": [
            "Old Gautami and Vani fonts are legacy — vision-only",
            "Modern Gautami (Windows 7+) is Unicode — text extraction works",
            "Telugu ottulu (subscript consonants) are critical for meaning",
            "Telugu numerals: ౦౧౨౩౪౫౬౭౮౯ (also Arabic 0-9)",
        ],
        "validation_min_ratio": 0.35,
        "preferred_model": "gemini-2.5-flash",
        "escalate_to": "gemini-2.5-pro",
        "always_vision_only": False,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# 4. FOLDER NAME → CONFIG KEY MAPPING
# Maps the exact Windows folder name to the LANGUAGE_CONFIG key above
# ─────────────────────────────────────────────────────────────────────────────
FOLDER_TO_CONFIG_KEY = {
    "Assamese":          "assamese",
    "Bengali":           "bengali",
    "English":           "english",
    "Gujarati":          "gujarati",
    "Hindi":             "hindi",
    "Hindi and English": "hindi_and_english",
    "Kannada":           "kannada",
    "Malayalam":         "malayalam",
    "Marathi":           "marathi",
    "Odiya":             "odiya",
    "Punjabi":           "punjabi",
    "Sanskrit":          "sanskrit",
    "Tamil":             "tamil",
    "Telugu":            "telugu",
    "Urdu":              "urdu",
}


# ─────────────────────────────────────────────────────────────────────────────
# 5. PRIMARY LANGUAGE STRING → CONFIG KEY
# Maps what scout_document_profile() returns to our config key
# ─────────────────────────────────────────────────────────────────────────────
LANGUAGE_NAME_TO_CONFIG = {
    "assamese":             "assamese",
    "bengali":              "bengali",
    "english":              "english",
    "gujarati":             "gujarati",
    "hindi":                "hindi",
    "hindi and english":    "hindi_and_english",
    "hindi & english":      "hindi_and_english",
    "hindi english":        "hindi_and_english",
    "kannada":              "kannada",
    "malayalam":            "malayalam",
    "marathi":              "marathi",
    "odiya":                "odiya",
    "odia":                 "odiya",
    "oriya":                "odiya",
    "punjabi":              "punjabi",
    "sanskrit":             "sanskrit",
    "sanskrit vyakaran":    "sanskrit",
    "sanskrit sahitya":     "sanskrit",
    "sanskrit grammar":     "sanskrit",
    "sanskrit literature":  "sanskrit",
    "tamil":                "tamil",
    "telugu":               "telugu",
    "urdu":                 "urdu",
}


# ─────────────────────────────────────────────────────────────────────────────
# 6. PAGE TYPE DEFINITIONS
# ─────────────────────────────────────────────────────────────────────────────
class PageType(Enum):
    UNICODE_CLEAN    = "unicode_clean"    # Perfect Unicode — use as grounding text
    LEGACY_ENCODED   = "legacy_encoded"   # Proprietary font — vision-only
    IMAGE_DOMINANT   = "image_dominant"   # Questions embedded as images — vision-only
    MIXED_BILINGUAL  = "mixed_bilingual"  # Two languages on same page
    SCANNED          = "scanned"          # Physical scan — vision-only
    RTL_UNICODE      = "rtl_unicode"      # Urdu Unicode (may still have wrong order)
    RTL_LEGACY       = "rtl_legacy"       # Urdu InPage — always vision-only
    NEAR_EMPTY       = "near_empty"       # Cover page / instructions / blank


# ─────────────────────────────────────────────────────────────────────────────
# 7. MODEL ROUTING
# ─────────────────────────────────────────────────────────────────────────────
MODEL_FLASH = "gemini-2.5-flash"
MODEL_PRO   = "gemini-2.5-pro"

PRO_REQUIRED_TYPES = {
    PageType.RTL_LEGACY,
    PageType.SCANNED,
}

FLASH_FIRST_TYPES = {
    PageType.UNICODE_CLEAN,
    PageType.MIXED_BILINGUAL,
    PageType.LEGACY_ENCODED,
    PageType.IMAGE_DOMINANT,
    PageType.RTL_UNICODE,
}


# ─────────────────────────────────────────────────────────────────────────────
# 8. SCRIPT VALIDATION CONFIG
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_VALIDATION = {
    "devanagari": {"ranges": ["devanagari"], "min_ratio": 0.30},
    "bengali":    {"ranges": ["bengali"],    "min_ratio": 0.35},
    "gurmukhi":   {"ranges": ["gurmukhi"],   "min_ratio": 0.30},
    "gujarati":   {"ranges": ["gujarati"],   "min_ratio": 0.30},
    "odia":       {"ranges": ["odia"],       "min_ratio": 0.35},
    "tamil":      {"ranges": ["tamil"],      "min_ratio": 0.35},
    "telugu":     {"ranges": ["telugu"],     "min_ratio": 0.35},
    "kannada":    {"ranges": ["kannada"],    "min_ratio": 0.35},
    "malayalam":  {"ranges": ["malayalam"],  "min_ratio": 0.35},
    "arabic":     {"ranges": ["arabic", "arabic_pfa", "arabic_pfb"], "min_ratio": 0.20},
    "latin":      {"ranges": [],             "min_ratio": 0.0},
}
