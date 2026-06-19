const SECTION_CONFIDENCE = {
  VERIFIED: "VERIFIED",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
};

const CONFIDENCE_RANK = {
  VERIFIED: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const SECTION_FIELD_KEYS = [
  "sectionName",
  "Section",
  "Section Name",
  "section",
  "section_name",
];

const SECTION_ORDER_KEYS = [
  "sectionOrder",
  "Section Order",
  "section_order",
];

const QUESTION_NUMBER_KEYS = [
  "sourceQuestionNo",
  "questionNo",
  "Sl.No",
  "Question Number",
  "question_number",
  "Q.No",
  "Q No",
];

const PAGE_NUMBER_KEYS = [
  "sourcePageNo",
  "pageNo",
  "Page_Number",
  "Page Number",
  "page_number",
];

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const textOrNull = (value) => {
  const text = cleanText(value);
  return text || null;
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value ?? {}));

const normalizeSectionName = (value) => {
  const text = cleanText(value);
  if (!text) return null;
  const match = text.match(/^section\s*[-–—:]?\s*(.+)$/i);
  if (!match) return text;
  return `Section ${match[1].trim().toUpperCase()}`;
};

const sectionKey = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const firstText = (source, keys) => {
  for (const key of keys) {
    const value = textOrNull(source?.[key]);
    if (value) return value;
  }
  return null;
};

const parseIntOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const match = String(value).match(/\d+/);
  if (!match) return null;
  const parsed = parseInt(match[0], 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const extractQuestionNumber = (question = {}) => {
  const direct = firstText(question, QUESTION_NUMBER_KEYS);
  const raw = direct || question.content || "";
  const match = String(raw).match(/(?:^|\b)(?:Q(?:uestion)?\.?\s*)?(\d{1,3})(?:\s*[.)]|Q\b|\s)/i);
  return match ? match[1] : direct;
};

const normalizeConfidence = (value, fallback = SECTION_CONFIDENCE.LOW) => {
  const normalized = cleanText(value).toUpperCase();
  if (SECTION_CONFIDENCE[normalized]) return SECTION_CONFIDENCE[normalized];
  return fallback;
};

const confidenceAtLeast = (value, minimum) =>
  (CONFIDENCE_RANK[normalizeConfidence(value)] || 0) >= (CONFIDENCE_RANK[minimum] || 0);

const getRow = (question = {}) => question.extractionRow || question.rawRow || {};

const getQuestionSectionName = (question = {}) => {
  return normalizeSectionName(
    firstText(question, SECTION_FIELD_KEYS) ||
    firstText(getRow(question), SECTION_FIELD_KEYS)
  );
};

const getQuestionSectionOrder = (question = {}) => {
  return parseIntOrNull(firstText(question, SECTION_ORDER_KEYS) || firstText(getRow(question), SECTION_ORDER_KEYS));
};

const buildQuestionUid = (question = {}, index) => {
  if (question.questionUid) return String(question.questionUid);
  const sourceNo = extractQuestionNumber(question);
  if (sourceNo) return `Q${String(sourceNo).padStart(3, "0")}`;
  return `QROW${String(index + 1).padStart(4, "0")}`;
};

const flattenQuestions = (data = {}) => {
  const rows = [];
  const chapters = Array.isArray(data.chapters) ? data.chapters : [];

  chapters.forEach((chapter, chapterIndex) => {
    const concepts = Array.isArray(chapter.concepts) ? chapter.concepts : [];
    concepts.forEach((concept, conceptIndex) => {
      const questions = Array.isArray(concept.questions) ? concept.questions : [];
      questions.forEach((question, questionIndex) => {
        rows.push({ chapter, concept, question, chapterIndex, conceptIndex, questionIndex });
      });
    });
  });

  return rows;
};

const collectInstructionText = (data = {}) => {
  const values = [
    data.instructions,
    data.paperInstructions,
    data.instructionText,
    data.extraction?.instructions,
    data.extraction?.instructionText,
    data.geminiResponse?.text,
  ];

  for (const chapter of data.chapters || []) {
    values.push(chapter.name, chapter.description);
    for (const concept of chapter.concepts || []) {
      values.push(concept.name, concept.description);
    }
  }

  return values.map(cleanText).filter(Boolean).join("\n");
};

const parseInstructionSections = (text) => {
  const source = cleanText(text);
  if (!source) return [];

  const sectionRegex = /section\s*[-–—:]?\s*([A-Za-z0-9]+)/gi;
  const matches = [];
  let match;
  while ((match = sectionRegex.exec(source)) !== null) {
    matches.push({
      label: match[1].toUpperCase(),
      index: match.index,
      name: `Section ${match[1].toUpperCase()}`,
    });
  }

  const sections = [];
  matches.forEach((item, index) => {
    const next = matches[index + 1]?.index || source.length;
    const block = source.slice(item.index, next);
    const ranges = [];
    const rangeRegex = /(?:Q(?:uestion)?\.?\s*)?(?:Nos?\.?|Numbers?)?\s*(\d{1,3})\s*(?:to|-|–|—)\s*(\d{1,3})/gi;
    let rangeMatch;
    while ((rangeMatch = rangeRegex.exec(block)) !== null) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      if (Number.isInteger(start) && Number.isInteger(end)) {
        ranges.push({ start: Math.min(start, end), end: Math.max(start, end) });
      }
    }

    if (!ranges.length) return;
    sections.push({
      sectionName: item.name,
      sectionOrder: sections.length + 1,
      startsAtQuestion: Math.min(...ranges.map((range) => range.start)),
      endsAtQuestion: Math.max(...ranges.map((range) => range.end)),
      ranges,
      confidence: SECTION_CONFIDENCE.HIGH,
      evidence: ["instruction-range"],
    });
  });

  return dedupeSections(sections);
};

const dedupeSections = (sections) => {
  const byKey = new Map();
  for (const section of sections) {
    const key = sectionKey(section.sectionName || section.name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...section });
      continue;
    }
    existing.startsAtQuestion = Math.min(
      existing.startsAtQuestion ?? section.startsAtQuestion ?? 0,
      section.startsAtQuestion ?? existing.startsAtQuestion ?? 0
    );
    existing.endsAtQuestion = Math.max(
      existing.endsAtQuestion ?? section.endsAtQuestion ?? 0,
      section.endsAtQuestion ?? existing.endsAtQuestion ?? 0
    );
    existing.ranges = [...(existing.ranges || []), ...(section.ranges || [])];
    existing.evidence = [...new Set([...(existing.evidence || []), ...(section.evidence || [])])];
  }
  return Array.from(byKey.values()).sort((left, right) => (left.sectionOrder || 0) - (right.sectionOrder || 0));
};

const sectionsFromQuestions = (questionRows) => {
  const byName = new Map();
  for (const row of questionRows) {
    const name = getQuestionSectionName(row.question);
    if (!name) continue;
    const numericNo = parseIntOrNull(extractQuestionNumber(row.question));
    const sectionOrder = getQuestionSectionOrder(row.question) || byName.size + 1;
    const current = byName.get(sectionKey(name)) || {
      sectionName: name,
      sectionOrder,
      startsAtQuestion: numericNo,
      endsAtQuestion: numericNo,
      ranges: [],
      confidence: normalizeConfidence(row.question.sectionConfidence, SECTION_CONFIDENCE.VERIFIED),
      evidence: ["question-field"],
    };
    if (numericNo) {
      current.startsAtQuestion = current.startsAtQuestion ? Math.min(current.startsAtQuestion, numericNo) : numericNo;
      current.endsAtQuestion = current.endsAtQuestion ? Math.max(current.endsAtQuestion, numericNo) : numericNo;
    }
    byName.set(sectionKey(name), current);
  }
  return Array.from(byName.values()).sort((left, right) => (left.sectionOrder || 0) - (right.sectionOrder || 0));
};

const sectionForQuestion = (question, sections) => {
  const explicitName = getQuestionSectionName(question);
  if (explicitName) {
    const existing = sections.find((section) => sectionKey(section.sectionName) === sectionKey(explicitName));
    return {
      sectionName: explicitName,
      sectionOrder: getQuestionSectionOrder(question) || existing?.sectionOrder || 1,
      confidence: normalizeConfidence(question.sectionConfidence, SECTION_CONFIDENCE.VERIFIED),
      evidence: ["question-field"],
    };
  }

  const numericNo = parseIntOrNull(extractQuestionNumber(question));
  if (numericNo) {
    const match = sections.find((section) => {
      const ranges = Array.isArray(section.ranges) && section.ranges.length > 0
        ? section.ranges
        : [{ start: section.startsAtQuestion, end: section.endsAtQuestion }];
      return ranges.some((range) =>
        Number.isInteger(range.start) &&
        Number.isInteger(range.end) &&
        numericNo >= range.start &&
        numericNo <= range.end
      );
    });
    if (match) {
      return {
        sectionName: match.sectionName,
        sectionOrder: match.sectionOrder,
        confidence: match.confidence || SECTION_CONFIDENCE.HIGH,
        evidence: match.evidence || ["instruction-range"],
      };
    }
  }

  return {
    sectionName: null,
    sectionOrder: null,
    confidence: SECTION_CONFIDENCE.LOW,
    evidence: ["missing-section-evidence"],
  };
};

const normalizeQuestion = (question, sections, index) => {
  const sourceNo = textOrNull(extractQuestionNumber(question));
  const row = getRow(question);
  const section = sectionForQuestion(question, sections);
  const pageNo = parseIntOrNull(firstText(question, PAGE_NUMBER_KEYS) || firstText(row, PAGE_NUMBER_KEYS));
  const marks = parseIntOrNull(question.marks ?? row["Marks (Mandatory)"] ?? row.Marks);
  const subpartCount = parseIntOrNull(question.subpartCount ?? row.Subparts ?? row["Subpart Count"]);
  const content = cleanText(question.content || question.question || "");
  const hasOrChoice = /\bOR\b/i.test(content);
  const previousEvidence = question.sectionEvidence &&
    typeof question.sectionEvidence === "object" &&
    !Array.isArray(question.sectionEvidence)
    ? question.sectionEvidence
    : {};

  question.questionUid = buildQuestionUid(question, index);
  question.sourceQuestionNo = sourceNo || question.sourceQuestionNo || question.questionNo || null;
  question.questionNo = question.questionNo || sourceNo || null;
  question.sourcePageNo = pageNo ?? question.sourcePageNo ?? null;
  question.sectionName = section.sectionName;
  question.sectionOrder = section.sectionOrder;
  question.sectionConfidence = section.confidence;
  question.sectionEvidence = {
    ...previousEvidence,
    signals: [...new Set([...(previousEvidence.signals || []), ...section.evidence])],
    normalizedAt: new Date().toISOString(),
  };
  question.subpartCount = subpartCount ?? question.subpartCount ?? null;
  question.choiceGroupKey = textOrNull(question.choiceGroupKey || row.choiceGroupKey || (hasOrChoice ? `OR-${question.questionUid}` : null));
  if (marks && !question.marks) question.marks = marks;
};

const applyContinuitySectionFallback = (questionRows) => {
  questionRows.forEach(({ question }, index) => {
    if (question.sectionName) return;

    const previous = [...questionRows.slice(0, index)]
      .reverse()
      .map((row) => row.question)
      .find((candidate) => candidate.sectionName);
    const next = questionRows
      .slice(index + 1)
      .map((row) => row.question)
      .find((candidate) => candidate.sectionName);

    if (!previous) return;
    if (next && sectionKey(next.sectionName) !== sectionKey(previous.sectionName)) return;

    question.sectionName = previous.sectionName;
    question.sectionOrder = previous.sectionOrder;
    question.sectionConfidence = SECTION_CONFIDENCE.MEDIUM;
    question.sectionEvidence = {
      signals: [
        ...new Set([
          ...(question.sectionEvidence?.signals || []),
          "section-continuity-fallback",
        ]),
      ],
      normalizedAt: new Date().toISOString(),
    };
  });
};

const applySharedHeaderSectionFallback = (questionRows) => {
  questionRows.forEach(({ question }, index) => {
    const header = cleanText(question.questionHeader);
    const previous = index > 0 ? questionRows[index - 1]?.question : null;
    const previousHeader = cleanText(previous?.questionHeader);
    const content = cleanText(question.content || question.question || "");
    const repeatsPreviousHeader =
      previousHeader &&
      content.toLowerCase().startsWith(previousHeader.slice(0, 80).toLowerCase());
    if (!previous?.sectionName) return;
    if (!header && !repeatsPreviousHeader) return;
    if (header && previousHeader !== header && !repeatsPreviousHeader) return;
    if (sectionKey(question.sectionName) === sectionKey(previous.sectionName)) return;

    question.sectionName = previous.sectionName;
    question.sectionOrder = previous.sectionOrder;
    question.sectionConfidence = SECTION_CONFIDENCE.MEDIUM;
    question.sectionEvidence = {
      signals: ["shared-question-header"],
      normalizedAt: new Date().toISOString(),
    };
  });
};

const buildSectionMap = (data, questionRows, instructionSections) => {
  const questionSections = sectionsFromQuestions(questionRows);
  const authoritativeSections = [...(data.sectionMap?.sections || []), ...instructionSections];
  const seedSections = authoritativeSections.length > 0 ? authoritativeSections : questionSections;
  const sections = dedupeSections(seedSections)
    .map((section, index) => {
      const startsAtQuestion = parseIntOrNull(section.startsAtQuestion);
      const endsAtQuestion = parseIntOrNull(section.endsAtQuestion);
      const ranges = Array.isArray(section.ranges) && section.ranges.length > 0
        ? section.ranges
        : (startsAtQuestion && endsAtQuestion ? [{ start: startsAtQuestion, end: endsAtQuestion }] : []);
      return {
        sectionName: normalizeSectionName(section.sectionName || section.name) || `Section ${index + 1}`,
        sectionOrder: parseIntOrNull(section.sectionOrder) || index + 1,
        startsAtQuestion,
        endsAtQuestion,
        ranges,
        confidence: normalizeConfidence(section.confidence || section.sectionConfidence, SECTION_CONFIDENCE.MEDIUM),
        evidence: section.evidence || section.sectionEvidence?.signals || ["existing-section-map"],
      };
    });

  return sections.sort((left, right) => left.sectionOrder - right.sectionOrder);
};

const validateSectionMap = (data, { enforce = false } = {}) => {
  const issues = [];
  const seen = new Map();

  flattenQuestions(data).forEach(({ question }) => {
    const uid = question.questionUid || question.questionNo || "unknown";
    if (!cleanText(question.content) && !question.imageUrl) {
      issues.push({ severity: "error", code: "BLANK_QUESTION", questionUid: uid, message: "Question text/image is missing." });
    }

    if (!question.sectionName) {
      issues.push({ severity: enforce ? "error" : "warning", code: "MISSING_SECTION", questionUid: uid, message: "Question has no section." });
    } else if (!confidenceAtLeast(question.sectionConfidence, SECTION_CONFIDENCE.HIGH)) {
      issues.push({ severity: enforce ? "error" : "warning", code: "LOW_SECTION_CONFIDENCE", questionUid: uid, message: "Section confidence must be reviewed." });
    }

    const duplicateKey = `${sectionKey(question.sectionName)}:${cleanText(question.sourceQuestionNo || question.questionNo)}`;
    if (question.sectionName && (question.sourceQuestionNo || question.questionNo)) {
      if (seen.has(duplicateKey)) {
        issues.push({ severity: "warning", code: "DUPLICATE_SOURCE_NUMBER", questionUid: uid, message: "Duplicate source question number in the same section." });
      }
      seen.set(duplicateKey, uid);
    }
  });

  return issues;
};

class SectionNormalizerService {
  normalizeExtractionData(extractedData, options = {}) {
    const data = cloneJson(extractedData);
    const questionRows = flattenQuestions(data);
    const instructionSections = parseInstructionSections(collectInstructionText(data));
    const sections = buildSectionMap(data, questionRows, instructionSections);

    questionRows.forEach(({ question }, index) => normalizeQuestion(question, sections, index));
    applySharedHeaderSectionFallback(questionRows);
    applyContinuitySectionFallback(questionRows);

    const normalizedRows = flattenQuestions(data);
    const finalSections = buildSectionMap(data, normalizedRows, instructionSections);
    const enforce = options.enforce ?? Boolean(data.sectionWorkflow?.enabled);
    const issues = validateSectionMap(data, { enforce });

    data.sectionMap = {
      sections: finalSections,
      validation: issues,
      normalizedAt: new Date().toISOString(),
    };
    data.sectionWorkflow = {
      enabled: options.enabled ?? data.sectionWorkflow?.enabled ?? true,
      enforceHighConfidence: true,
      lowConfidenceCount: issues.filter((issue) => issue.code === "LOW_SECTION_CONFIDENCE").length,
      errorCount: issues.filter((issue) => issue.severity === "error").length,
      normalizedAt: data.sectionMap.normalizedAt,
    };

    return { extractedData: data, sectionMap: data.sectionMap, issues };
  }

  buildSectionMap(extractedData, options = {}) {
    return this.normalizeExtractionData(extractedData, options).sectionMap;
  }

  validateForGeneration(extractedData) {
    const { extractedData: normalized, issues } = this.normalizeExtractionData(extractedData, {
      enabled: true,
      enforce: true,
    });
    return { extractedData: normalized, issues, valid: !issues.some((issue) => issue.severity === "error") };
  }

  confidenceAtLeast(value, minimum = SECTION_CONFIDENCE.HIGH) {
    return confidenceAtLeast(value, minimum);
  }

  sectionKey(value) {
    return sectionKey(value);
  }
}

module.exports = new SectionNormalizerService();
