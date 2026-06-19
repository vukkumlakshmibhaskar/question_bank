import json
import os
import random
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


EXPORT_COLUMNS = [
    "question_number",
    "question_type",
    "question",
    "AI answer",
    "bloom_tag",
    "difficulty",
    "lesson_no",
    "lesson_name",
    "subject_name",
    "source_page",
    "source_image_url",
    "source_excerpt",
]

SAMPLE_PATTERN = [
    ("objective", 10),
    ("very_short", 5),
    ("short", 5),
    ("long", 5),
    ("elaborative", 5),
]

REFERENCE_STYLE_GUIDE = """
Match the reference NIOS workbook style:
- For the standard 30-question pattern, generate exactly 10 objective, 5 very_short,
  5 short, 5 long, and 5 elaborative questions.
- Do not use a separate paragraph type in the standard pattern. Paragraph-like writing
  tasks belong under elaborative or long.
- objective: real MCQs, sometimes assertion-reason or passage-based; all options must
  be meaningful. Format exactly like the reference workbook: question stem on top,
  then each option on its own new line as A), B), C), D). For passage-based MCQs,
  begin with "Read the passage and answer the questions:", include the passage, then
  "Based on the passage above, answer the following:", then the MCQ stem and options.
- very_short: direct name/list/state/mention questions, usually 1-2 line answers.
- short: explanation, evidence, rewrite, grammar/application, or 2-3 point questions.
- long: analytical, comparative, evaluative, structured, or extended-answer questions.
- elaborative: purposeful writing tasks such as essay, diary entry, letter, speech,
  report, memo, email, creative retelling, advisory note, or applied composition.
- Questions should sound like a teacher or exam board wrote them, not like copied
  textbook lines converted into questions.
"""


@dataclass
class GenerationSettings:
    count: int
    question_types: list[str]
    difficulty: str
    subject_name: str
    lesson_name: str
    lesson_no: str
    bloom_tags: list[str]
    language: str = "English"
    include_answers: bool = True
    visual_source_enabled: bool = False


@dataclass
class LessonBlock:
    lesson_no: str
    lesson_name: str
    text: str


@dataclass
class PageChunk:
    page: str
    image_url: str
    text: str


class AIUnavailableError(RuntimeError):
    pass


def gemini_model_candidates() -> list[str]:
    configured = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip().strip('"').strip("'")
    extras = [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
        "gemini-1.5-flash",
    ]
    models: list[str] = []
    for model in [configured, *extras]:
        if model and model not in models:
            models.append(model)
    return models


def generate_with_gemini_retry(client, contents):
    errors: list[str] = []
    for model in gemini_model_candidates():
        for attempt in range(3):
            try:
                return client.models.generate_content(model=model, contents=contents), model
            except Exception as exc:
                message = str(exc)
                errors.append(f"{model}: {message}")
                retryable = any(code in message for code in ["503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED"])
                if not retryable:
                    break
                time.sleep(1.5 * (attempt + 1))
    raise AIUnavailableError("Gemini is busy right now after retrying alternate models. Please try again in a minute. Last error: " + (errors[-1] if errors else "unknown"))


def image_mime_type(path: str | Path) -> str:
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    return "image/png"


def load_local_env() -> None:
    env_paths = [Path(__file__).with_name(".env"), Path(__file__).resolve().parents[1] / ".env"]
    for env_path in env_paths:
        if not env_path.exists():
            continue
        for raw_line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and value and not os.getenv(key):
                os.environ[key] = value


def clean_text(text: str) -> str:
    lines = []
    module_names = {
        "motion, force and energy",
        "mechanics of solids and fluids",
        "mechanics of solids",
        "and fluids",
        "thermal physics",
        "oscillations and waves",
        "electricity and magnetism",
    }
    for raw_line in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        compact = line.lower()
        if not line:
            continue
        if compact in {"notes", "physics", "curriculum"}:
            continue
        if compact in module_names:
            continue
        if re.fullmatch(r"\d{1,4}", line):
            continue
        if re.fullmatch(r"module\s*[-â€“]\s*\d+", line, flags=re.IGNORECASE):
            continue
        if re.fullmatch(r"page\s+\d+", line, flags=re.IGNORECASE):
            continue
        lines.append(line)
    text = " ".join(lines)
    text = re.sub(r"\bPHYSICS\b", " ", text)
    text = re.sub(r"\bMODULE\s*[-â€“]\s*\d+\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bNotes\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<=\d)(?=[A-Z])", " ", text)
    text = re.sub(r"\s+", " ", text or "").strip()
    return re.sub(r"Page\s+\d+\s*", "", text, flags=re.IGNORECASE)


def page_chunks(text: str) -> list[PageChunk]:
    pattern = re.compile(r"\[\[PAGE:(\d+)(?:\s+IMAGE:([^\]]+))?\]\]")
    matches = list(pattern.finditer(text or ""))
    if not matches:
        return []
    chunks: list[PageChunk] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        chunks.append(PageChunk(page=match.group(1), image_url=match.group(2) or "", text=text[start:end]))
    return chunks


def choose_source_chunk(question: str, chunks: list[PageChunk]) -> PageChunk | None:
    if not chunks:
        return None
    terms = set(keywords(question, 12))
    if not terms:
        return chunks[0]
    best_chunk = chunks[0]
    best_score = -1
    for chunk in chunks:
        lower = chunk.text.lower()
        score = sum(1 for term in terms if term.lower() in lower)
        if score > best_score:
            best_score = score
            best_chunk = chunk
    return best_chunk


def assign_source_references(rows: list[dict], source_text: str) -> list[dict]:
    chunks = page_chunks(source_text)
    for index, row in enumerate(rows):
        chunk = choose_source_chunk(str(row.get("question", "")), chunks)
        if not chunk and chunks:
            chunk = chunks[index % len(chunks)]
        if not chunk:
            row.setdefault("source_page", "")
            row.setdefault("source_image_url", "")
            row.setdefault("source_excerpt", "")
            continue
        row["source_page"] = row.get("source_page") or chunk.page
        row["source_image_url"] = row.get("source_image_url") or chunk.image_url
        excerpt = first_sentence(clean_text(chunk.text[:1200]))
        row["source_excerpt"] = row.get("source_excerpt") or excerpt[:300]
    return rows


def normalize_lesson_no(raw: str | int | None, fallback_index: int) -> str:
    if raw is None:
        return f"Lesson{fallback_index:02d}"
    text = str(raw).strip()
    match = re.search(r"(\d{1,3})", text)
    if match:
        return f"Lesson{int(match.group(1)):02d}"
    return text.replace(" ", "") or f"Lesson{fallback_index:02d}"


def split_lesson_title(raw_body: str, fallback: str) -> tuple[str, str]:
    body = raw_body.strip()
    raw_lines = [line.strip() for line in body.splitlines() if line.strip()]
    title_index = None
    title_line = ""
    for index, line in enumerate(raw_lines):
        if line.startswith("[[PAGE:"):
            continue
        title_index = index
        title_line = line
        break
    if title_line:
        first = title_line
        if len(first) <= 120 and len(first.split()) <= 14 and not re.search(r"[.!?]$", first):
            remaining = [line for index, line in enumerate(raw_lines) if index != title_index]
            return clean_text(first), "\n".join(remaining) or first

    inline = re.match(r"^(.{2,80}?)(?=\s+(?:The|This|In|A|An)\s+[a-z])", clean_text(body))
    if inline:
        title = inline.group(1).strip(" :-")
        return clean_text(title), body[len(title):].strip()

    return fallback, body


def normalize_heading_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def strip_repeated_heading_lines(text: str, lesson_name: str, lesson_no: str) -> str:
    title_key = normalize_heading_key(lesson_name)
    number_key = normalize_heading_key(lesson_no)
    cleaned_lines = []
    for line in (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        stripped = line.strip()
        key = normalize_heading_key(stripped)
        if not stripped:
            continue
        if key and key in {title_key, number_key}:
            continue
        if title_key and title_key in key and len(stripped.split()) <= 6:
            continue
        if title_key and key and (key == title_key.replace("gra", "grav") or title_key == key.replace("gra", "grav")):
            continue
        cleaned_lines.append(stripped)
    return "\n".join(cleaned_lines)


def is_generic_lesson_name(name: str, lesson_no: str) -> bool:
    cleaned = clean_text(name).lower().replace(" ", "")
    return not cleaned or cleaned == lesson_no.lower()


def merge_repeated_lessons(lessons: list[LessonBlock]) -> list[LessonBlock]:
    merged: dict[str, LessonBlock] = {}
    order: list[str] = []
    for lesson in lessons:
        key = lesson.lesson_no
        if key not in merged:
            merged[key] = lesson
            order.append(key)
            continue

        current = merged[key]
        current_generic = is_generic_lesson_name(current.lesson_name, key)
        incoming_generic = is_generic_lesson_name(lesson.lesson_name, key)
        if current_generic and not incoming_generic:
            title = lesson.lesson_name
        elif not current_generic and incoming_generic:
            title = current.lesson_name
        else:
            title = current.lesson_name if len(current.lesson_name) >= len(lesson.lesson_name) else lesson.lesson_name
        merged[key] = LessonBlock(key, title, clean_text(f"{current.text}\n\n{lesson.text}"))
    return [merged[key] for key in order]


def detect_lessons(text: str, default_lesson_no: str = "Lesson01", default_lesson_name: str = "Full textbook") -> list[LessonBlock]:
    source = text.replace("\r\n", "\n").replace("\r", "\n")
    heading_pattern = re.compile(
        r"(?im)^\s*(?:lesson|chapter)\s*[-:]?\s*(\d{1,3})\b"
    )
    matches = list(heading_pattern.finditer(source))
    if not matches:
        cleaned = clean_text(source)
        return [LessonBlock(normalize_lesson_no(default_lesson_no, 1), default_lesson_name, cleaned)] if cleaned else []

    lessons: list[LessonBlock] = []
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source)
        lesson_no = normalize_lesson_no(match.group(1), index + 1)
        lesson_name, lesson_body = split_lesson_title(source[start:end], lesson_no)
        lesson_body = strip_repeated_heading_lines(lesson_body, lesson_name, lesson_no)
        body = clean_text(lesson_body)
        if len(body.split()) < 25:
            continue
        lessons.append(LessonBlock(lesson_no, lesson_name, body))
    if not lessons:
        return [LessonBlock(normalize_lesson_no(default_lesson_no, 1), default_lesson_name, clean_text(source))]
    return merge_repeated_lessons(lessons)


def split_passages(text: str, min_words: int = 55) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", clean_text(text))
    passages, current, word_count = [], [], 0
    for sentence in sentences:
        if re.search(r"\b(objectives?|after studying this lesson|you should be able to)\b", sentence, flags=re.IGNORECASE):
            continue
        words = sentence.split()
        if not words:
            continue
        current.append(sentence)
        word_count += len(words)
        if word_count >= min_words:
            passages.append(" ".join(current))
            current, word_count = [], 0
    if current:
        passages.append(" ".join(current))
    return [p for p in passages if len(p.split()) >= 20]


def keywords(passage: str, limit: int = 12) -> list[str]:
    stop = {
        "about", "after", "again", "also", "because", "before", "being", "between",
        "could", "every", "from", "have", "into", "more", "most", "other", "their",
        "there", "these", "they", "this", "those", "through", "under", "which", "while",
        "with", "would", "shall", "were", "when", "where", "what", "that", "than",
        "will", "learn", "lesson", "module", "notes", "physics", "explained", "example",
        "following", "given", "using", "shown", "figure",
        "such", "therefore", "however", "around", "them", "they", "large", "small",
        "study", "course", "perhaps", "receiving", "landing", "messages", "visuals",
        "anywhere", "basic", "number", "things", "different", "certain",
        "particularly", "precisely", "possible", "similar", "similarly",
        "called", "consider", "provided", "important", "common", "equal",
        "wide", "tiny", "object", "objects", "large", "small", "some",
        "only", "both", "length", "covered", "total", "known",
    }
    scores: dict[str, int] = {}
    for word in re.findall(r"[A-Za-z][A-Za-z'-]{3,}", passage):
        key = word.strip("'").lower()
        if key not in stop:
            scores[key] = scores.get(key, 0) + 1
    ranked = sorted(scores, key=lambda k: (-scores[k], -len(k), k))
    return [word.title() for word in ranked[:limit]]


def strip_heading_prefix(sentence: str) -> str:
    cleaned = sentence.strip()
    starts = r"(?:In|The|This|These|We|You|It|As|For|When|If|A|An|However|Thus)\b"
    for _ in range(4):
        before = cleaned
        cleaned = re.sub(r"^\d+(?:\.\d+)*\s+", "", cleaned).strip()
        cleaned = re.sub(r"^[A-Z][A-Z0-9, '&()/-]{8,}\s+(?=" + starts + ")", "", cleaned).strip()
        cleaned = re.sub(r"^[A-Z][A-Z0-9, '&()/-]{8,}\s+\d+(?:\.\d+)*\s+", "", cleaned).strip()
        cleaned = re.sub(r"^[A-Z][A-Za-z: '&()/-]{4,60}\s+(?=" + starts + ")", "", cleaned).strip()
        cleaned = re.sub(r"^[A-Z][A-Za-z: '&()/-]{4,60}\s+\d+(?:\.\d+)*\s+", "", cleaned).strip()
        if cleaned == before:
            break
    return cleaned


def first_sentence(passage: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", passage.strip())
    for sentence in sentences:
        cleaned = strip_heading_prefix(sentence)
        if len(cleaned.split()) < 6:
            continue
        if re.search(r"\b(in this lesson|you will|objectives?|curriculum|module)\b", cleaned, flags=re.IGNORECASE):
            continue
        return cleaned[:220].strip()
    return (sentences[0] if sentences else passage.strip())[:220].strip()


def clean_answer_term(term: str, fallback: str) -> str:
    bad = {
        "ground", "back", "state", "calculate", "describe", "explain", "example",
        "part", "will", "lesson", "figure", "given", "following", "such", "around",
        "therefore", "however", "give", "them", "study", "course", "things", "number",
        "particularly", "precisely", "possible", "similarly", "called", "consider",
        "provided", "important", "common", "equal", "wide", "tiny", "object", "objects",
        "large", "small", "some", "only", "both", "length", "covered", "total", "known",
    }
    cleaned = (term or "").strip()
    if cleaned.lower() in bad or len(cleaned) < 4 or cleaned.lower().endswith("ly"):
        for candidate in keywords(fallback, 8):
            if candidate.lower() not in bad and not candidate.lower().endswith("ly"):
                return candidate
    return cleaned or first_sentence(fallback)


def option_quality(term: str) -> bool:
    weak = {
        "such", "therefore", "however", "around", "give", "them", "they", "state",
        "calculate", "describe", "following", "given", "shown", "example", "things",
        "number", "different", "certain", "study", "course", "basic", "particularly",
        "precisely", "possible", "similarly", "called", "consider", "provided",
        "important", "common", "equal", "wide", "tiny", "object", "objects", "large",
        "small", "some", "only", "both", "length", "covered", "total", "known",
    }
    key = (term or "").strip().lower()
    return bool(key) and len(key) >= 4 and key not in weak and not key.endswith("ly")


def concept_phrase(text: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9 ,/-]", "", text or "")
    cleaned = re.sub(r"\b(the|a|an|this|these|those|some|any)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,-/")
    words = cleaned.split()
    return " ".join(words[:5]).strip()


def definition_mcq(stem: str) -> tuple[str, str] | None:
    clean = stem.strip().rstrip(".")
    patterns = [
        (
            r"^(?P<answer>[A-Z][A-Za-z /-]{3,50}?)\s+(?:is|are|means|refer to|refers to)\s+(?P<body>.{18,180})$",
            "Which term is described as {body}?",
        ),
        (
            r"^(?P<body>.{18,180}?)\s+(?:is|are)\s+called\s+(?P<answer>[A-Za-z /-]{3,50})$",
            "What is {body} called?",
        ),
        (
            r"^(?P<answer>[A-Z][A-Za-z /-]{3,50}?)\s+have\s+(?P<body>.{18,180})$",
            "Which quantity or concept has {body}?",
        ),
        (
            r"^(?P<answer>[A-Z][A-Za-z /-]{3,50}?)\s+has\s+(?P<body>.{18,180})$",
            "Which quantity or concept has {body}?",
        ),
    ]
    for pattern, template in patterns:
        match = re.match(pattern, clean)
        if not match:
            continue
        answer = concept_phrase(match.group("answer"))
        body = match.group("body").strip(" ,;:")
        if option_quality(answer) and len(body.split()) >= 4:
            return template.format(body=body), answer
    called = re.search(r"(?P<body>.{18,160}?)\s+(?:is|are)\s+known\s+as\s+(?P<answer>[A-Za-z /-]{3,50})", clean, flags=re.IGNORECASE)
    if called:
        answer = concept_phrase(called.group("answer"))
        body = called.group("body").strip(" ,;:")
        if option_quality(answer):
            return f"What is {body} known as?", answer
    return None


def make_options(answer: str, terms: list[str]) -> list[str]:
    clean_terms = []
    seen = {answer.lower()}
    for term in terms:
        key = term.lower().strip()
        if not option_quality(term) or key in seen:
            continue
        seen.add(key)
        clean_terms.append(term)
    options = [answer] + clean_terms[:3]
    while len(options) < 4:
        filler = random.choice(["Measurement", "Velocity", "Force", "Energy", "Vector", "Displacement"])
        if filler.lower() not in {option.lower() for option in options}:
            options.append(filler)
    random.shuffle(options)
    return options[:4]


def objective_question(stem: str, passage: str, terms: list[str]) -> tuple[str, str]:
    stem_terms = keywords(stem, 8)
    derived = definition_mcq(stem)
    if derived:
        question_text, answer = derived
    else:
        answer = clean_answer_term(stem_terms[0] if stem_terms else (terms[0] if terms else ""), passage)
        question_text = ""
    options = make_options(answer, stem_terms + terms)
    labels = ["A", "B", "C", "D"]
    if derived:
        question = question_text + "\n"
    elif answer and re.search(rf"\b{re.escape(answer)}\b", stem, flags=re.IGNORECASE):
        cloze = re.sub(rf"\b{re.escape(answer)}\b", "__________", stem, count=1, flags=re.IGNORECASE)
        question = f"Choose the correct term to complete the statement:\n\"{cloze}\"\n"
    else:
        question = f"Which concept is best described by this statement?\n\"{stem}\"\n"
    question += "\n".join(f"{label}) {option}" for label, option in zip(labels, options))
    return question, f"{labels[options.index(answer)]}) {answer}"


def question_plan(question_types: list[str], count: int) -> list[str]:
    selected = question_types or [kind for kind, _ in SAMPLE_PATTERN]
    standard_types = {kind for kind, _ in SAMPLE_PATTERN}
    if count == 30 and set(selected).issubset(standard_types) and all(kind in selected for kind, _ in SAMPLE_PATTERN):
        plan = []
        for kind, n in SAMPLE_PATTERN:
            plan.extend([kind] * n)
        return plan
    plan = []
    index = 0
    while len(plan) < count:
        plan.append(selected[index % len(selected)])
        index += 1
    return plan[:count]


def difficulty_for_index(difficulty: str, index: int) -> str:
    if difficulty != "mixed":
        return difficulty
    pattern = ["easy"] * 10 + ["average"] * 12 + ["difficult"] * 8
    return pattern[index % len(pattern)]


def local_generate(text: str, settings: GenerationSettings) -> list[dict]:
    passages = split_passages(text) or [clean_text(text)[:900] or "The uploaded textbook content"]
    q_types = question_plan(settings.question_types, settings.count)
    bloom_tags = settings.bloom_tags or ["knowledge", "understanding", "application"]
    rows = []

    for index in range(settings.count):
        passage = passages[index % len(passages)]
        q_type = q_types[index]
        terms = keywords(passage)
        answer = clean_answer_term(terms[0] if terms else "", passage)
        stem = first_sentence(passage)
        question = ""
        ai_answer = answer

        if q_type == "objective":
            question, ai_answer = objective_question(stem, passage, terms)
        elif q_type == "fill_blank":
            blanked = re.sub(re.escape(answer), "__________", stem, count=1, flags=re.IGNORECASE)
            if blanked == stem:
                stem_terms = keywords(stem, 4)
                target = stem_terms[0] if stem_terms else answer
                blanked = re.sub(rf"\b{re.escape(target)}\b", "__________", stem, count=1, flags=re.IGNORECASE)
                ai_answer = target
            question = blanked
        elif q_type == "true_false":
            question = stem
            ai_answer = "True"
        elif q_type == "very_short":
            question = f"What is meant by {answer} in this lesson? Answer in one or two sentences."
            ai_answer = stem
        elif q_type == "short":
            question = f"Explain the role or importance of {answer} in the concept described here: {stem}"
            ai_answer = passage[:320]
        elif q_type == "long":
            question = f"Write a detailed answer explaining {answer}, its related concepts, and one application from this lesson."
            ai_answer = passage[:650]
        elif q_type == "elaborative":
            question = f"Write an extended response applying or analysing {answer} in a meaningful situation from this lesson."
            ai_answer = passage[:650]
        elif q_type == "paragraph":
            question = f"Explain the importance or working of {answer} in one coherent paragraph, using relevant details from the lesson."
            ai_answer = passage[:450]
        elif q_type == "diagram":
            question = f"Create a labelled visual representation showing the relationships or process described here: {stem}"
            ai_answer = f"Expected labels/features: {', '.join(terms[:5]) or 'main stages and labels'}."
        elif q_type == "graph":
            labels = terms[:4] or ["Point A", "Point B", "Point C", "Point D"]
            values = [max(1, len(label)) for label in labels]
            question = "Represent this data visually and write one observation: "
            question += ", ".join(f"{label}={value}" for label, value in zip(labels, values))
            ai_answer = f"The highest value is {labels[values.index(max(values))]}."
        else:
            question = f"Answer briefly: What is the importance of {answer} in the passage?"
            ai_answer = stem

        rows.append(normalize_generated_row({
            "question_number": index + 1,
            "question_type": q_type,
            "question": question,
            "AI answer": ai_answer if settings.include_answers else "",
            "bloom_tag": bloom_tags[index % len(bloom_tags)],
            "difficulty": difficulty_for_index(settings.difficulty, index),
            "lesson_no": settings.lesson_no,
            "lesson_name": settings.lesson_name,
            "subject_name": settings.subject_name,
        }, index + 1, settings, text))
    return rows


def extract_json_array(text: str) -> list[dict] | None:
    match = re.search(r"\[[\s\S]*\]", text or "")
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        return None


def mcq_option_count(question: str) -> int:
    return len(re.findall(r"(?m)^[A-D]\)", question or ""))


def strip_option_label(answer: str) -> str:
    return re.sub(r"^\s*[A-D]\)\s*", "", str(answer or "").strip()).strip()


def numeric_distractors(answer: str) -> list[str]:
    try:
        value = float(answer)
    except ValueError:
        return []
    if value.is_integer():
        base = int(value)
        candidates = [base - 2, base - 1, base + 1, base + 2, base * 2 if base else 2]
        return [str(n) for n in candidates if n != base and n >= 0][:3]
    return [f"{value * factor:.3g}" for factor in (0.5, 1.5, 2.0)]


def sanitize_question_text(q_type: str, question: str) -> str:
    cleaned = str(question or "").strip()
    cleaned = re.sub(r"(?i)^\s*(?:the\s+text\s+(?:presents|states|says|describes)|it\s+states\s+that)\b[:,]?\s*", "", cleaned).strip()
    cleaned = re.sub(r"(?i)\b(?:it|the\s+text)\s+states\s+that\s+", "", cleaned).strip()
    cleaned = cleaned.strip(" '\"")
    prefix_patterns = [
        r"^\s*fill\s+in\s+the\s+blank\s*:\s*",
        r"^\s*true\s+or\s+false\s*:\s*",
        r"^\s*write\s+a\s+focused\s+paragraph\s+explaining\s+(?:this\s+lesson\s+concept\s*:\s*)?",
        r"^\s*write\s+a\s+paragraph\s+(?:explaining|on)\s*:\s*",
        r"^\s*explain\s+the\s+concept\s+shown\s+in\s+this\s+statement\s*:\s*",
        r"^\s*draw\s+and\s+label\s+a\s+diagram\s+or\s+flow\s+chart\s+to\s+explain\s+(?:the\s+idea\s+described\s+here\s*:\s*)?",
        r"^\s*draw\s+and\s+label\s+a\s+diagram\s*:\s*",
        r"^\s*create\s+a\s+bar\s+graph\s+using\s+this\s+data\s+and\s+write\s+one\s+observation\s*:\s*",
    ]
    for pattern in prefix_patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE).strip()
    if q_type in {"long", "short", "elaborative", "very_short"} and not re.search(r"[?]$", cleaned):
        cleaned = re.sub(r"(?i)^\s*explain\s+why,\s*", "Explain why ", cleaned).strip()
    if q_type == "fill_blank" and "__________" not in cleaned and "____" not in cleaned:
        words = keywords(cleaned, 4)
        if words:
            cleaned = re.sub(rf"\b{re.escape(words[0])}\b", "__________", cleaned, count=1, flags=re.IGNORECASE)
    return cleaned


def normalize_math_text(text: str) -> str:
    cleaned = str(text or "")
    replacements = {
        "delta T": "ΔT",
        "delta t": "Δt",
        "DeltaT": "ΔT",
        "deltat": "Δt",
        "Î”T": "ΔT",
        "Î”t": "Δt",
        "−": "-",
        "–": "-",
        "—": "-",
        "√ ": "√",
    }
    for old, new in replacements.items():
        if re.search(r"\w", old):
            cleaned = re.sub(rf"\b{re.escape(old)}\b", new, cleaned)
        else:
            cleaned = cleaned.replace(old, new)
    superscript_map = str.maketrans({
        "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
        "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
        "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ", "f": "ᶠ", "g": "ᵍ", "h": "ʰ", "i": "ⁱ",
        "j": "ʲ", "k": "ᵏ", "l": "ˡ", "m": "ᵐ", "n": "ⁿ", "o": "ᵒ", "p": "ᵖ", "r": "ʳ", "s": "ˢ",
        "t": "ᵗ", "u": "ᵘ", "v": "ᵛ", "w": "ʷ", "x": "ˣ", "y": "ʸ", "z": "ᶻ",
        "A": "ᴬ", "B": "ᴮ", "D": "ᴰ", "E": "ᴱ", "G": "ᴳ", "H": "ᴴ", "I": "ᴵ", "J": "ᴶ",
        "K": "ᴷ", "L": "ᴸ", "M": "ᴹ", "N": "ᴺ", "O": "ᴼ", "P": "ᴾ", "R": "ᴿ", "T": "ᵀ",
        "U": "ᵁ", "V": "ⱽ", "W": "ᵂ",
    })
    to_super = lambda value: "".join(ch.translate(superscript_map) for ch in str(value))
    cleaned = re.sub(r"\bsqrt\s*\(([^)]+)\)", r"√(\1)", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b([A-Za-z])t2\b", r"\1t^2", cleaned)
    cleaned = re.sub(
        r"(\([^()\n]+\)|[A-Za-z0-9]+)\s*\^\s*\(([^)\n]{1,30})\)",
        lambda match: f"{match.group(1)}{to_super(f'({match.group(2)})')}",
        cleaned,
    )
    cleaned = re.sub(
        r"(\([^()\n]+\)|[A-Za-z0-9]+)\s*\^\s*([A-Za-z0-9+\-=]{1,20})",
        lambda match: f"{match.group(1)}{to_super(match.group(2))}",
        cleaned,
    )
    cleaned = re.sub(r"\b([A-Za-z])\s*\^\s*2\b", r"\1²", cleaned)
    cleaned = re.sub(r"\b([A-Za-z])\s*\^\s*3\b", r"\1³", cleaned)
    cleaned = re.sub(r"\b([A-Za-z])([23])\b", lambda m: f"{m.group(1)}{'²' if m.group(2) == '2' else '³'}", cleaned)
    cleaned = re.sub(r"\b1\s*/\s*2\b", "1/2", cleaned)
    return cleaned


def strip_markdown_formatting(text: str) -> str:
    cleaned = str(text or "")
    cleaned = re.sub(r"\*\*([^*\n]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"__([^_\n]+)__", r"\1", cleaned)
    cleaned = re.sub(r"`([^`\n]+)`", r"\1", cleaned)
    cleaned = re.sub(r"(?m)^\s*[-*]\s+", "", cleaned)
    cleaned = re.sub(r"(?m)^(\s*\d+\.)\s*\*\*([^*\n]+)\*\*:?", r"\1 \2:", cleaned)
    cleaned = re.sub(r"(?m)^\s*\*\s*", "", cleaned)
    cleaned = re.sub(r"\*{2,}", "", cleaned)
    return cleaned


SOURCE_NOISE_RE = re.compile(
    r"(?i)^\s*(?:"
    r"(?:source|reference|references|citation|citations|credit|credits)\s*:.*|"
    r"(?:neurochispas|lamar\s+university|byju'?s|khan\s+academy|wikipedia|britannica|"
    r"vedantu|toppr|cuemath|mathway|symbolab|brainly|chegg|quizlet)(?:\s*\+\d+)?|"
    r"[A-Z][A-Za-z0-9 .,&'()-]{2,70}\s+(?:University|College|Institute|Academy|School|"
    r"Board|Press|Education|Foundation|Publisher|Publications)(?:\s*\+\d+)?|"
    r"[A-Z][A-Za-z0-9 .,&'()-]{2,60}\s*\+\d+"
    r")\s*$"
)

QUESTION_SOLUTION_START_RE = re.compile(
    r"(?i)(?:^|\n)\s*(?:"
    r"answer\s*:|solution\s*:|explanation\s*:|"
    r"this\s+is\s+a\s+standard|you\s+can\s+solve\s+it|"
    r"\d+\.\s*(?:factoring|quadratic\s+formula|completing\s+the\s+square)|"
    r"this\s+problem\s+demonstrates|you\s+can\s+try\s+similar"
    r")\b"
)

def strip_source_noise(text: str) -> str:
    if not text:
        return ""
    lines = []
    for raw_line in str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = re.sub(r"[ \t]+", " ", raw_line).strip()
        if not line or SOURCE_NOISE_RE.match(line):
            continue
        lines.append(line)
    return "\n".join(lines).strip()

def clean_question_export_text(text: str) -> str:
    cleaned = strip_source_noise(strip_markdown_formatting(normalize_math_text(text)))
    match = QUESTION_SOLUTION_START_RE.search(cleaned)
    if match:
        cleaned = cleaned[:match.start()].strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()

def clean_export_text(text: str) -> str:
    cleaned = strip_source_noise(strip_markdown_formatting(normalize_math_text(text)))
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def weak_question_style(question: str) -> bool:
    text = str(question or "").strip()
    lower = text.lower()
    weak_phrases = [
        "have you ever thought",
        "we shall study",
        "you will learn",
        "finally, we shall",
        "let us now",
        "let us draw",
        "then take",
        "explain the concept shown in this statement",
        "write a focused paragraph explaining",
        "draw and label a diagram or flow chart to explain the idea described here",
    ]
    if any(phrase in lower for phrase in weak_phrases):
        return True
    if re.match(r"^\s*(?:example|activity|solution|intext questions?)\b", lower):
        return True
    return False


def repair_objective_row(row: dict, source_text: str) -> dict:
    question = str(row.get("question", "") or "").strip()
    answer_text = strip_option_label(row.get("AI answer", ""))
    question = re.sub(r"\s+([A-D]\))\s*", r"\n\1 ", question)
    question = re.sub(r"\n{3,}", "\n\n", question).strip()
    row["question"] = question
    if mcq_option_count(question) >= 4:
        answer = str(row.get("AI answer", "") or "").strip()
        label_match = re.fullmatch(r"([A-D])\)?", answer)
        if label_match:
            label = label_match.group(1)
            option_match = re.search(rf"(?m)^{label}\)\s*(.+)$", question)
            if option_match:
                row["AI answer"] = f"{label}) {option_match.group(1).strip()}"
        return row
    if not answer_text:
        return row

    distractors = numeric_distractors(answer_text)
    if not distractors:
        distractors = [term for term in keywords(source_text, 16) if term.lower() != answer_text.lower()]
    options = make_options(answer_text, distractors)
    labels = ["A", "B", "C", "D"]
    stem = re.sub(r"\s+", " ", question).strip()
    if not stem.endswith("?"):
        stem = stem.rstrip(".") + "?"
    row["question"] = stem + "\n" + "\n".join(f"{label}) {option}" for label, option in zip(labels, options))
    row["AI answer"] = f"{labels[options.index(answer_text)]}) {answer_text}"
    return row


def normalize_generated_row(row: dict, index: int, settings: GenerationSettings, source_text: str) -> dict:
    q_type = row.get("question_type", settings.question_types[0] if settings.question_types else "objective")
    fallback_answer = clean_export_text(first_sentence(source_text) or "Needs answer review")
    normalized = {
        "question_number": row.get("question_number", index),
        "question_type": q_type,
        "question": clean_question_export_text(sanitize_question_text(q_type, row.get("question", ""))),
        "AI answer": (clean_export_text(str(row.get("AI answer", row.get("answer", "")) or "").strip()) or fallback_answer) if settings.include_answers else "",
        "bloom_tag": row.get("bloom_tag") or (settings.bloom_tags[index % len(settings.bloom_tags)] if settings.bloom_tags else "understanding"),
        "difficulty": row.get("difficulty", difficulty_for_index(settings.difficulty, index - 1)),
        "lesson_no": settings.lesson_no,
        "lesson_name": settings.lesson_name,
        "subject_name": settings.subject_name,
        "source_page": str(row.get("source_page", "") or ""),
        "source_image_url": str(row.get("source_image_url", "") or ""),
        "source_excerpt": str(row.get("source_excerpt", "") or ""),
    }
    if q_type == "objective":
        normalized = repair_objective_row(normalized, source_text)
    return normalized


async def ai_generate(text: str, settings: GenerationSettings) -> list[dict] | None:
    load_local_env()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        from google import genai
    except Exception:
        return None

    visual_source_instruction = (
        'Visual source mode: ON. For every diagram or graph row, create an image-based question that explicitly refers to the attached visual using varied wording such as "Observe the given diagram", "Refer to the figure", "Use the graph shown", "From the provided chart", or "Based on the given visual". Do not create draw-only, sketch-only, or imagine-your-own diagram questions in this mode. The question must be answerable with an attached textbook crop. Avoid repeating the exact same opening phrase across rows.'
        if settings.visual_source_enabled
        else "Visual source mode: OFF. Diagram/graph rows may be draw/sketch tasks only when they do not need an attached source image."
    )

    prompt = f"""
Generate {settings.count} textbook questions from the source text.
Return only a JSON array with these keys:
question_number, question_type, question, AI answer, bloom_tag, difficulty,
lesson_no, lesson_name, subject_name.

{REFERENCE_STYLE_GUIDE}

Allowed question types: {', '.join(settings.question_types)}
Use only the allowed question types. Respect the requested mix exactly:
- If the requested count equals the number of allowed question types, generate one
  question for each allowed type in the same order.
- If the requested count is larger, cycle through the allowed question types in order
  until the requested count is reached, unless a special distribution below applies.
If the selected pattern contains objective, very_short, short, long and elaborative
and the requested count is 30, follow this distribution exactly:
10 objective, 5 very_short, 5 short, 5 long, 5 elaborative.
Difficulty: {settings.difficulty}
If difficulty is mixed, distribute the lesson's questions across easy, average and difficult.
Bloom tags: {', '.join(settings.bloom_tags)}
Language: {settings.language}
Subject: {settings.subject_name}
Lesson: {settings.lesson_no} {settings.lesson_name}
{visual_source_instruction}

QUALITY CONTRACT FOR ALL QUESTION TYPES:
- Every row must be a real assessable question from the selected lesson, not a copied
  heading, not a sentence fragment, and not a generic prompt such as "write about this".
- Do not copy a textbook sentence and call it a question. Transform lesson content into
  a proper question with a clear task, command, or problem to solve.
- Do not begin questions with source-summary wording such as "The text presents...",
  "It states that...", "The lesson says...", or quoted copied fragments. Ask the
  student directly.
- Do not use conversational textbook lines such as "Have you ever thought...", "We shall
  study...", "You will learn...", "Finally, we shall..." as question stems.
- Every question must test a concept, skill, reasoning step, application, comparison,
  definition, calculation, interpretation, sequence, cause-effect relation, or visual
  representation from the lesson.
- Prefer teacher/exam-board style phrasing: define, state, explain, compare, distinguish,
  calculate, derive, justify, identify, illustrate, arrange, classify, interpret, evaluate.
- Answers must not simply repeat the source sentence. They should answer the question
  directly in polished student-facing form.
- The question_type column already identifies the type. Do NOT begin the question text
  with labels such as "Fill in the blank:", "True or False:", "Paragraph:",
  "Diagram:", "Graph:", "MCQ:", or similar type names.
- Questions must be original, exam-ready, and answerable from the source lesson.
- Use the textbook content to create concept, definition, comparison, application,
  reasoning, numerical, cause-effect, diagram, or explanation questions as appropriate.
- Do not repeat lesson titles, section titles, page headers, module names, curriculum
  labels, examples labels, or OCR noise in the question.
- Do not use weak one-word answers such as such, given, following, important, possible,
  therefore, around, body, object, part, number, study, course, chapter, or lesson.
- The AI answer must be a clean answer/key for that exact question, not another question.
- Avoid duplicate stems. Cover different parts of the lesson when multiple questions are requested.
- For mathematics, physics, chemistry, accountancy, economics, computer science, or any
  subject with equations/symbols, preserve equations exactly in plain Excel-safe text.
  Use readable notation such as v = u + at, s = ut + 1/2 at², F = ma, Q = mcΔT.
  Do not let exponents collapse into words such as at2 when at^2 is intended.
  Do not convert equations into vague descriptions. Include units where the lesson gives
  units, and keep calculation steps in the AI answer when the question is numerical.
  Do not use Markdown math fences, HTML, or image-only equations in the question text.
- Keep the question field as the question only. Do not include solutions, explanation
  paragraphs, solved steps, practice suggestions, web search snippets, source names,
  citation labels, or fragments such as "Neurochispas +1" or "Lamar University +2".
- Put worked steps only in AI answer when answers are requested. The question field
  should remain clean enough to appear directly in Excel.
- Do not use Markdown formatting anywhere. Do not write **bold**, bullet asterisks,
  code ticks, headings such as "**Basic Step**", or Markdown lists. Use plain text
  numbering like "1. Define the statement:" if steps are needed.

TYPE-SPECIFIC REQUIREMENTS:
- very_short: Ask a direct factual/concept question that can be answered in 1-2 sentences.
  Example shape: "What is dimensional analysis?" or "State one use of vectors in physics."
- short: Ask a 3-5 mark style explanation, comparison, reason, derivation step, or application.
  Example shape: "Explain why SI units are preferred in scientific measurements."
- long: Ask a broad but specific 5-8 mark style question with scope. It should require
  organized explanation, derivation, comparison, examples, or applications from the lesson.
- elaborative: Ask for deeper reasoning, application to a situation, interpretation,
  significance, limitations, or connection between concepts.
- fill_blank: Use a meaningful textbook concept/value/principle as the blank. The answer
  must be the exact missing concept, not a filler word. The question text should contain
  the blank directly, without starting with "Fill in the blank:".
- true_false: Create a meaningful assertion from the lesson. AI answer must say
  "True" or "False" and include a one-sentence correction/explanation. The question text
  should be the assertion only, without starting with "True or False:".
- paragraph: Ask a focused explanatory question about one clear concept, process,
  comparison, significance, or application from the lesson. Do not write "Write a
  paragraph..." or "Explain the concept shown in this statement...". The question itself
  should be natural, for example: "Explain how thermal equilibrium is reached between a
  system and its surroundings." If the selected subject is language/English, paragraph
  may be a purposeful writing task like a short diary entry, speech, letter, report,
  notice, e-mail, character note, or reflective paragraph. The answer should be one
  coherent paragraph, not copied textbook lines and not bullet points unless the question
  explicitly asks for points.
- diagram: Use a visual task only where the lesson naturally supports it. Across all
  subjects this may mean labelled scientific diagrams, process cycles, flowcharts,
  concept maps, timelines, classification trees, grammar trees, maps, algorithm
  flowcharts, business process charts, or cause-effect charts. AI answer should list
  the required labels/features. Do not force a physics-style diagram for every subject.
  If the lesson includes a visible textbook diagram/figure/example, prefer image-based
  questions such as "Study the given diagram and explain..." or "Identify the labelled
  parts in the given diagram..." instead of a generic draw-only prompt. Use draw/sketch
  questions only when the task is naturally a construction task and can stand without
  an attached source image.
- graph: Use data/relationship tasks only where the lesson has numbers, comparisons,
  trends, variables, timelines, category counts, proportional relationships, or data that
  can reasonably be plotted. Include all values/categories needed. If no numeric graph is
  natural, create a table/chart/timeline interpretation task instead of a vague graph prompt.
  If a source graph/chart exists, prefer "Study the given graph/chart..." style questions.
- If a question depends on a textbook figure, graph, geometric diagram, worked example,
  or equation layout, make the dependency explicit in the question and keep it tied to
  the source page. Do not invent unseen diagrams. When asking a diagram/graph question,
  include enough labels, values, axes, coordinates, or construction instructions for the
  student to answer even after export.

For every objective question, the question field MUST use this exact MCQ shape:
Question stem?
A) first option
B) second option
C) third option
D) fourth option

Do not put options in one continuous sentence. Each option must start on a new line.
For passage-based objective questions, use this exact shape:
Read the passage and answer the questions:

<short passage from or based on the lesson>

Based on the passage above, answer the following:

Question stem?
A) first option
B) second option
C) third option
D) fourth option

The AI answer field MUST contain only the correct labelled option, for example:
B) second option

Do not omit the options from the question field. Do not put the full option list in
AI answer. Write real exam-style MCQs based on concepts, definitions, relationships,
calculations, applications, or reasoning from the lesson. Do not create keyword-cloze
questions unless the source sentence is a textbook definition. Do not use filler words,
headings, verbs, adverbs, page labels, or random extracted words as answer options.
The correct answer must be a meaningful textbook concept, value, principle, or statement.
For diagram questions, ask for a labelled diagram or flow chart.
For graph questions, include simple graph data in the question.
Ignore running headers, page numbers, module labels, curriculum bullets, notes labels,
and repeated textbook headings. Generate from the actual lesson explanation only.

SOURCE:
{clean_text(text)[:24000]}
"""
    client = genai.Client(api_key=api_key)
    try:
        response, used_model = generate_with_gemini_retry(client, prompt)
    except Exception as exc:
        if isinstance(exc, AIUnavailableError):
            raise
        raise AIUnavailableError(f"Gemini is unavailable right now: {exc}") from exc
    rows = extract_json_array(getattr(response, "text", "") or "")
    if not rows:
        raise AIUnavailableError("Gemini did not return valid question JSON. Please try again.")
    if any(
        (
            str(row.get("question_type", "")).strip() == "objective"
            and mcq_option_count(str(row.get("question", ""))) < 4
        )
        or (settings.include_answers and not str(row.get("AI answer", row.get("answer", "")) or "").strip())
        or weak_question_style(str(row.get("question", "")))
        for row in rows
    ):
        repair_prompt = f"""
The JSON rows below were generated from a textbook lesson, but one or more questions
are incomplete, missing answer keys, copied too directly from textbook sentences, or low quality. Repair them.

Return only a JSON array with the same number of rows and the same question_type order.
For every objective row, the question field must include:
Question stem?
A) plausible option
B) plausible option
C) plausible option
D) plausible option
The AI answer field must contain only the correct labelled option.

For every non-objective row, the AI answer field must contain a complete correct answer
for the exact question. Do not leave AI answer blank.
For non-objective rows, keep them as real exam-ready questions and improve only if needed.
For paragraph rows, produce a natural explanatory question about a specific concept,
not a copied textbook sentence and not "Explain the concept shown in this statement".
Do not use headings, filler words, conversational textbook lines, or random extracted
terms as options or answers.
Do not include source names, citation fragments, web snippets, solved-example commentary,
or extra practice suggestions in the question field.
Do not use Markdown formatting, bold asterisks, code ticks, or bullet asterisks.
Use plain text only.

ROWS TO REPAIR:
{json.dumps(rows[: settings.count], ensure_ascii=False)}

SOURCE EXCERPT:
{clean_text(text)[:12000]}
"""
        try:
            repair_response, _ = generate_with_gemini_retry(client, repair_prompt)
            repaired_rows = extract_json_array(getattr(repair_response, "text", "") or "")
            if repaired_rows and len(repaired_rows) >= min(len(rows), settings.count):
                rows = repaired_rows
        except Exception as exc:
            print(f"Gemini MCQ repair failed; using original generated rows: {exc}")
    normalized = []
    for index, row in enumerate(rows[: settings.count], start=1):
        normalized.append(normalize_generated_row(row, index, settings, text))
    return assign_source_references(normalized, text)


async def generate_questions(text: str, settings: GenerationSettings) -> tuple[list[dict], str]:
    load_local_env()
    require_ai = bool(os.getenv("GEMINI_API_KEY")) and os.getenv("ALLOW_LOCAL_DRAFT_FALLBACK", "false").lower() != "true"
    rows = await ai_generate(text, settings)
    if rows:
        return rows, "gemini"
    if require_ai:
        raise AIUnavailableError("Gemini did not generate usable questions. Please retry instead of using draft fallback.")
    return local_generate(text, settings), "local"


async def generate_answers_for_rows(
    rows: list[dict],
    text: str,
    settings: GenerationSettings,
) -> tuple[list[dict], str]:
    load_local_env()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise AIUnavailableError("Answer generation needs the configured question service key.")
    try:
        from google import genai
        from google.genai import types
    except Exception as exc:
        raise AIUnavailableError("Answer generation is unavailable because the AI client library is missing.") from exc

    answer_rows = []
    image_parts = []
    image_id = 1
    for index, row in enumerate(rows):
        item = {
            "row_index": index,
            "question_number": row.get("question_number", ""),
            "question_type": row.get("question_type", ""),
            "question": clean_question_export_text(row.get("question", "")),
            "source_page": row.get("source_page", ""),
            "source_excerpt": row.get("source_excerpt", ""),
        }
        image_path = row.get("__answer_image_path")
        if image_path and Path(str(image_path)).exists():
            item["answer_image_id"] = image_id
            image_parts.append((image_id, Path(str(image_path))))
            image_id += 1
        answer_rows.append(item)

    prompt = f"""
Generate missing answer keys for the provided textbook questions.
Return only a JSON array. Each item must have:
row_index, AI answer

Rules:
- Answer the exact question. Do not create a new question.
- For objective questions, return only the correct labelled option in this format: B) option text.
- For true_false, return True or False with one short correction/explanation.
- For fill_blank, return only the missing concept/value unless explanation is needed.
- For very_short, return 1-2 clear sentences.
- For short, return a concise 3-5 mark style answer.
- For long or elaborative, return a structured but compact answer.
- For diagram/graph rows with answer_image_id, use the attached image with that id.
- If an attached image is unclear, still provide the best answer from the question and source context.
- Do not use Markdown, bullets with asterisks, HTML, citations, or source names.
- Never leave AI answer blank.

Subject: {settings.subject_name}
Lesson: {settings.lesson_no} {settings.lesson_name}
Difficulty: {settings.difficulty}
Language: {settings.language}

ROWS:
{json.dumps(answer_rows, ensure_ascii=False)}

SOURCE EXCERPT:
{clean_text(text)[:10000]}
"""
    contents = [prompt]
    for _, path in image_parts:
        contents.append(types.Part.from_bytes(data=path.read_bytes(), mime_type=image_mime_type(path)))

    client = genai.Client(api_key=api_key)
    try:
        response, used_model = generate_with_gemini_retry(client, contents)
    except Exception as exc:
        if isinstance(exc, AIUnavailableError):
            raise
        raise AIUnavailableError(f"Answer generation is unavailable right now: {exc}") from exc

    generated = extract_json_array(getattr(response, "text", "") or "")
    if not generated:
        raise AIUnavailableError("Gemini did not return valid answer JSON. Please retry.")

    fixed = []
    for item in generated:
        if not isinstance(item, dict):
            continue
        try:
            row_index = int(item.get("row_index"))
        except Exception:
            continue
        answer = clean_export_text(str(item.get("AI answer", item.get("answer", "")) or ""))
        if answer:
            fixed.append({"row_index": row_index, "AI answer": answer})
    if not fixed:
        raise AIUnavailableError("Gemini returned no usable answers. Please retry.")
    return fixed, used_model


async def generate_visual_questions_from_images(
    text: str,
    settings: GenerationSettings,
    visual_inputs: list[dict],
) -> tuple[list[dict], str]:
    load_local_env()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise AIUnavailableError("Image-based question generation needs the configured question service key.")
    try:
        from google import genai
        from google.genai import types
    except Exception as exc:
        raise AIUnavailableError("Image-based question generation is unavailable because the image client library is missing.") from exc

    usable_inputs = [item for item in visual_inputs if item.get("image_path") and Path(item["image_path"]).exists()]
    if not usable_inputs:
        raise AIUnavailableError("No approved crop images were found for image-based generation.")

    client = genai.Client(api_key=api_key)
    visual_types = [q_type for q_type in settings.question_types if q_type in {"diagram", "graph"}] or ["diagram"]
    rows: list[dict] = []
    engine = "gemini"
    start_number = 1

    for offset in range(0, min(settings.count, len(usable_inputs)), 6):
        chunk = usable_inputs[offset : offset + 6]
        image_labels = []
        contents = []
        for local_index, item in enumerate(chunk, start=1):
            q_type = visual_types[(offset + local_index - 1) % len(visual_types)]
            image_labels.append(
                {
                    "image_id": local_index,
                    "question_type": q_type,
                    "source_page": str(item.get("source_page", "")),
                    "source_image_url": str(item.get("source_image_url", "")),
                }
            )

        prompt = f"""
You are creating image-based textbook questions from approved diagram/graph crops.
Return only a JSON array with exactly {len(chunk)} rows, one row per attached image, in the same order.

Each row must have these keys:
question_number, question_type, question, AI answer, bloom_tag, difficulty,
lesson_no, lesson_name, subject_name, source_page, source_image_url, source_excerpt.

IMAGE MAP:
{json.dumps(image_labels, ensure_ascii=False)}

Rules:
- Use the actual attached image for each row. Do not create a question from unrelated lesson text.
- The question must be answerable by looking at that exact image.
- Use varied openings. Examples: "Observe the given diagram...", "Refer to the figure...", "Use the graph shown...", "From the provided chart...", "Based on the given visual...". Do not repeat the same phrase for every row.
- Do not ask only "draw/sketch/illustrate" when the source image is attached.
- Do not invent labels, values, axes, or shapes that are not visible in the image.
- The answer must explain or identify what the image shows.
- If a crop is unclear, still make the best focused question and set source_excerpt to "Needs image review: crop clarity is low."
- Use plain text only. Do not use Markdown formatting, bold asterisks, HTML, or code ticks.
- Preserve mathematical notation as readable plain text. Use x^2, 2^(n+1), A ∩ B, A × B, ∠ABC, ΔABC, or similar notation when visible.
- Keep the same source_image_url and source_page values from IMAGE MAP in the matching output row.

Lesson context, only for naming and topic boundaries:
Subject: {settings.subject_name}
Lesson: {settings.lesson_no} {settings.lesson_name}
Difficulty: {settings.difficulty}
Bloom tags: {', '.join(settings.bloom_tags)}
Language: {settings.language}

Short lesson excerpt:
{clean_text(text)[:4000]}
"""
        contents.append(prompt)
        for item in chunk:
            image_path = Path(item["image_path"])
            contents.append(types.Part.from_bytes(data=image_path.read_bytes(), mime_type=image_mime_type(image_path)))

        try:
            response, used_model = generate_with_gemini_retry(client, contents)
            engine = "gemini"
        except Exception as exc:
            if isinstance(exc, AIUnavailableError):
                raise
            raise AIUnavailableError(f"Image-based generation is unavailable right now: {exc}") from exc

        generated = extract_json_array(getattr(response, "text", "") or "")
        if not generated:
            raise AIUnavailableError("Image-based generation did not return valid question JSON. Please try again.")
        if len(generated) < len(chunk):
            raise AIUnavailableError("Image-based generation returned fewer questions than approved images. Please retry this lesson.")

        for local_index, item in enumerate(chunk, start=1):
            raw_row = generated[local_index - 1]
            q_type = image_labels[local_index - 1]["question_type"]
            raw_row["question_number"] = start_number
            raw_row["question_type"] = q_type
            raw_row["source_page"] = str(item.get("source_page", "") or raw_row.get("source_page", ""))
            raw_row["source_image_url"] = str(item.get("source_image_url", "") or raw_row.get("source_image_url", ""))
            raw_row["source_excerpt"] = str(raw_row.get("source_excerpt") or "Approved crop used for this visual question.")
            normalized = normalize_generated_row(raw_row, start_number, settings, text)
            if not re.search(r"\b(?:given|shown|attached|provided)\s+(?:diagram|graph|chart|figure|image)\b", normalized["question"], flags=re.IGNORECASE):
                visual_name = "graph/chart" if q_type == "graph" else "diagram"
                prefixes = [
                    f"Observe the given {visual_name} and answer:",
                    f"Refer to the provided {visual_name} and answer:",
                    f"Use the {visual_name} shown to answer:",
                    f"Based on the attached {visual_name}, answer:",
                ]
                normalized["question"] = f"{prefixes[(start_number - 1) % len(prefixes)]} {normalized['question']}"
            normalized["source_image_url"] = str(item.get("source_image_url", ""))
            normalized["source_page"] = str(item.get("source_page", ""))
            normalized["source_excerpt"] = str(raw_row.get("source_excerpt") or "Approved crop used for this visual question.")
            rows.append(normalized)
            start_number += 1

    return rows[: settings.count], engine


async def generate_lesson_questions(lessons: list[LessonBlock], base_settings: GenerationSettings) -> tuple[dict[str, list[dict]], str]:
    workbook_rows: dict[str, list[dict]] = {}
    engines = set()
    for lesson in lessons:
        settings = GenerationSettings(
            count=base_settings.count,
            question_types=base_settings.question_types,
            difficulty=base_settings.difficulty,
            subject_name=base_settings.subject_name,
            lesson_name=lesson.lesson_name,
            lesson_no=lesson.lesson_no,
            bloom_tags=base_settings.bloom_tags,
            language=base_settings.language,
            include_answers=base_settings.include_answers,
        )
        rows, engine = await generate_questions(lesson.text, settings)
        engines.add(engine)
        workbook_rows[lesson.lesson_no] = [{column: row.get(column, "") for column in EXPORT_COLUMNS} for row in rows]
    return workbook_rows, "gemini" if engines == {"gemini"} else "mixed" if "gemini" in engines else "local"


def combine_texts(parts: Iterable[tuple[str, str]]) -> str:
    blocks = []
    for name, text in parts:
        lines = [re.sub(r"[ \t]+", " ", line).strip() for line in (text or "").splitlines()]
        cleaned = "\n".join(line for line in lines if line)
        if cleaned:
            blocks.append(f"### Source: {name}\n{cleaned}")
    return "\n\n".join(blocks)

