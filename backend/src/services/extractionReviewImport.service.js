const prisma = require("../config/prisma");
const reviewRepository = require("../repositories/review.repository");
const auditService = require("./audit.service");
const subjectAccessService = require("./subjectAccess.service");
const sectionNormalizerService = require("./sectionNormalizer.service");

const PARSER_LABELS = {
  standard: "Standard Parser",
  language: "Language Parser",
  "question-crafter": "Question Crafter",
};

const parserLabel = (workflow) => PARSER_LABELS[String(workflow || "").toLowerCase()] || "Extraction Parser";

const buildExtractionReviewPrompt = (parserName) =>
  `Imported from ${parserName}. Rows were extracted by the Extraction workflow and staged for manual moderation in Extraction Reviews.`;

const text = (value) => String(value ?? "").trim();

const firstText = (row, keys) => {
  for (const key of keys) {
    const value = text(row?.[key]);
    if (value) return value;
  }
  return "";
};

const yes = (value) => ["yes", "true", "1", "y"].includes(text(value).toLowerCase());

const safeKeyPart = (value, fallback = "unknown") => (
  text(value)
    .replace(/[^A-Za-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback
);

const safeWorkflow = (value) => safeKeyPart(value || "standard", "standard").toLowerCase();

const parseMarks = (value) => {
  const numeric = Number.parseInt(text(value), 10);
  return Number.isInteger(numeric) ? numeric : null;
};

const parseOptionalInt = (value) => {
  const match = text(value).match(/\d+/);
  if (!match) return null;
  const numeric = Number.parseInt(match[0], 10);
  return Number.isInteger(numeric) ? numeric : null;
};

const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : null);

const buildSectionMapPayload = (payload = {}) => {
  const explicit = asObject(payload.sectionMap) || asObject(payload.sectionVisionMap);
  const sections = Array.isArray(explicit?.sections)
    ? explicit.sections
    : Array.isArray(payload.sections)
      ? payload.sections
      : [];

  if (sections.length === 0) return null;

  return {
    ...explicit,
    sections: sections.map((section, index) => ({
      ...section,
      sectionOrder: parseOptionalInt(section.sectionOrder) || index + 1,
      confidence: text(section.confidence || section.sectionConfidence) || "HIGH",
      evidence: Array.isArray(section.evidence) && section.evidence.length > 0
        ? section.evidence
        : ["imported-section-map"],
    })),
    source: explicit?.source || payload.sectionSource || "extraction-import",
    importedAt: new Date().toISOString(),
  };
};

const mapDifficulty = (value) => {
  const normalized = text(value).toUpperCase();
  if (normalized.includes("EASY")) return "EASY";
  if (normalized.includes("HARD")) return "HARD";
  return "MEDIUM";
};

const mapQuestionType = (row, optionCount) => {
  const label = [
    row["Type of question (Mandatory)"],
    row["Question Type (Mandatory)"],
    row["Objective Type Questions"],
    row.question_type,
  ].map(text).join(" ").toLowerCase();

  if (label.includes("true") && label.includes("false")) return "TRUE_FALSE";
  if (label.includes("essay") || label.includes("long answer") || /\bla\b/.test(label)) return "ESSAY";
  if (optionCount > 0 || label.includes("mcq")) return "MCQ";
  return "SHORT_ANSWER";
};

const optionText = (row, optionNumber) => firstText(row, [
  `Option${optionNumber} (Mandatory)`,
  `Option ${optionNumber}`,
  `Option${optionNumber}`,
  `option_${optionNumber}`,
  `option${optionNumber}`,
  `option_${String.fromCharCode(96 + optionNumber)}`,
  `option${String.fromCharCode(96 + optionNumber)}`,
  String.fromCharCode(64 + optionNumber),
]);

const optionImage = (row, optionNumber) => firstText(row, [
  `If Option${optionNumber} is Image, Specify Image Name`,
  `Option${optionNumber} Translate Image`,
  `Option ${optionNumber} Image`,
  `Option${optionNumber} Image`,
  `option_${optionNumber}_image`,
]);

const optionIsCorrect = (row, optionNumber) => yes(firstText(row, [
  `Option${optionNumber} Is Correct?`,
  `Option ${optionNumber} Is Correct?`,
  `option_${optionNumber}_is_correct`,
  `option${optionNumber}_is_correct`,
  `option_${String.fromCharCode(96 + optionNumber)}_is_correct`,
]));

const buildExtractionImageUrl = (row, imageName, context = {}) => {
  const image = text(imageName);
  if (!image) return null;
  if (/^(https?:|data:|blob:|\/uploads\/|\/api\/)/i.test(image)) return image;

  const jobId = text(context.jobId || row.jobId);
  if (!jobId) return image;

  const workflow = safeKeyPart(context.workflow || row.workflow || "standard", "standard");
  const sourceFileName = firstText(row, ["NIOS Filename", "Source File"]) || "Document";
  const baseName = sourceFileName.replace(/\.pdf$/i, "") || "Document";
  return `/api/extraction/${encodeURIComponent(workflow)}/workspace/${encodeURIComponent(jobId)}/images/${encodeURIComponent(baseName)}/${encodeURIComponent(image)}`;
};

const buildAnswers = (row, context = {}) => {
  const answers = [];
  for (let index = 1; index <= 6; index += 1) {
    const content = optionText(row, index);
    const imageUrl = buildExtractionImageUrl(row, optionImage(row, index), context);
    if (!content && !imageUrl) continue;
    answers.push({
      content,
      imageUrl,
      isCorrect: optionIsCorrect(row, index),
      explanation: "",
    });
  }

  const directAnswer = firstText(row, ["AI answer", "Answer", "answer", "Correct Answer", "correct_answer"]);
  if (answers.length === 0 && directAnswer) {
    answers.push({
      content: directAnswer,
      imageUrl: null,
      isCorrect: true,
      explanation: "",
    });
  }

  return answers;
};

const buildQuestionContent = (row) => {
  const header = firstText(row, ["Question Header", "Question Header / Passage"]);
  const question = firstText(row, ["Question text(Mandatory)", "Question Text", "Question", "question_text", "question"]);
  if (header && question && !question.includes(header)) return `${header}\n\n${question}`;
  return question || header;
};

const rowHasQuestion = (row) => Boolean(buildQuestionContent(row));

const rowToQuestion = (row, context = {}) => {
  const answers = buildAnswers(row, context);
  const type = mapQuestionType(row, answers.length);
  const sectionName = firstText(row, [
    "Section",
    "Section Name",
    "sectionName",
    "section_name",
  ]);
  const sourceQuestionNo = firstText(row, [
    "Source Question No",
    "Question Number",
    "Q.No",
    "Q No",
    "Sl.No",
    "question_number",
  ]);
  const sourcePageNo = parseOptionalInt(firstText(row, [
    "Page_Number",
    "Page Number",
    "Page No",
    "pageNo",
    "page_number",
    "source_page",
  ]));
  return {
    content: buildQuestionContent(row),
    imageUrl: buildExtractionImageUrl(
      row,
      firstText(row, [
        "If Question is Image, Specify Image Name",
        "Question Translate Image",
        "Question Image",
        "questionImageUrl",
        "imageUrl",
      ]),
      context
    ),
    type,
    difficulty: mapDifficulty(firstText(row, ["Question Complexity", "difficulty"])),
    explanation: "",
    answers,
    questionNo: sourceQuestionNo,
    questionHeader: firstText(row, ["Question Header", "Question Header / Passage"]) || null,
    sectionName: sectionName || null,
    sectionOrder: parseOptionalInt(firstText(row, ["Section Order", "sectionOrder", "section_order"])),
    sourceQuestionNo: sourceQuestionNo || null,
    sourcePageNo,
    sectionConfidence: sectionName ? "VERIFIED" : null,
    sectionEvidence: sectionName
      ? {
          signals: ["import-row-section"],
          rowSectionName: sectionName,
        }
      : null,
    subpartCount: parseOptionalInt(firstText(row, ["Subpart Count", "Subparts", "subpartCount"])),
    choiceGroupKey: firstText(row, ["Choice Group", "Choice Group Key", "choiceGroupKey", "OR Group"]) || null,
    questionTypeLabel: firstText(row, ["Type of question (Mandatory)", "Question Type (Mandatory)"]) || null,
    objectiveType: firstText(row, ["Objective Type Questions"]) || null,
    marks: parseMarks(firstText(row, ["Marks (Mandatory)", "Marks", "marks"])),
    sourceReference: firstText(row, ["Page_Number", "Page Number", "Page_Image_URL", "source_page", "source_image_url"]) || null,
    extractionRow: row,
  };
};

const groupRows = (rows, context = {}) => {
  const chaptersByName = new Map();

  for (const row of rows) {
    if (!rowHasQuestion(row)) continue;

    const parserName = context.parserName || parserLabel(context.workflow);
    const chapterName = firstText(row, ["Chapter", "Lesson/Module", "lesson_name", "lesson_no"]) || "Extraction";
    const conceptName =
      firstText(row, ["Objective Type Questions", "Type of question (Mandatory)", "Question Type (Mandatory)", "question_type", "bloom_tag"]) ||
      "Extracted Questions";

    if (!chaptersByName.has(chapterName)) {
      chaptersByName.set(chapterName, {
        name: chapterName,
        description: `Imported from ${parserName}.`,
        concepts: new Map(),
      });
    }

    const chapter = chaptersByName.get(chapterName);
    if (!chapter.concepts.has(conceptName)) {
      chapter.concepts.set(conceptName, {
        name: conceptName,
        description: `Imported from ${parserName}.`,
        questions: [],
      });
    }

    chapter.concepts.get(conceptName).questions.push(rowToQuestion(row, context));
  }

  return Array.from(chaptersByName.values()).map((chapter) => ({
    ...chapter,
    concepts: Array.from(chapter.concepts.values()),
  }));
};

const buildSubjectCandidates = (payload, rows) => {
  const candidates = [
    payload.subjectName,
    payload.subjectCode,
    rows[0]?.["Subject Name"],
    rows[0]?.["Subject Code"],
    rows[0]?.subject_name,
  ].map(text).filter(Boolean);

  return [...new Set(candidates.map((candidate) => candidate.toLowerCase()))];
};

class ExtractionReviewImportService {
  async importRows(payload = {}, user) {
    const rows = Array.isArray(payload.rows) ? payload.rows.filter(rowHasQuestion) : [];
    if (rows.length === 0) {
      const err = new Error("No extraction parser questions were provided for review import.");
      err.statusCode = 400;
      throw err;
    }

    const subject = await this.resolveSubject(payload, rows, user);
    await subjectAccessService.requireSubjectAccess(user, subject.id);

    const workflow = safeWorkflow(payload.workflow || payload.parser || payload.sourceParser || "standard");
    const parserName = text(payload.parserName || payload.sourceParserName) || parserLabel(workflow);
    const promptUsed = buildExtractionReviewPrompt(parserName);
    const jobId = safeKeyPart(payload.jobId || rows[0]?.jobId || "manual", "manual");
    const setName = safeKeyPart(payload.setName || "ALL", "ALL");
    const sourceFileName =
      text(payload.sourceFileName) ||
      firstText(rows[0], ["NIOS Filename", "Source File"]) ||
      `${parserName} ${workflow}`;
    const externalKey = `${workflow}:${jobId}:${setName}`;
    const filePath = `extraction://${externalKey}`;
    const fileSize = Buffer.byteLength(JSON.stringify(rows), "utf8");
    const sectionMap = buildSectionMapPayload(payload);
    const sectionInstructions = text(
      payload.sectionInstructions ||
      payload.instructionText ||
      sectionMap?.instructionText
    );

    let uploadFile = await prisma.uploadFile.findFirst({
      where: {
        uploadedById: parseInt(user.id),
        filePath,
      },
      orderBy: { createdAt: "desc" },
    });

    if (!uploadFile) {
      uploadFile = await prisma.uploadFile.create({
        data: {
          fileName: `Extraction Review - ${parserName} - ${sourceFileName}`,
          filePath,
          fileSize,
          mimeType: "application/json",
          processingStatus: "COMPLETED",
          uploadedById: parseInt(user.id),
        },
      });
    } else {
      uploadFile = await prisma.uploadFile.update({
        where: { id: uploadFile.id },
        data: {
          fileName: `Extraction Review - ${parserName} - ${sourceFileName}`,
          fileSize,
          processingStatus: "COMPLETED",
        },
      });
    }

    await this.ensureCompletedJob(uploadFile.id, user.id, rows.length, parserName);

    const extractedData = sectionNormalizerService.normalizeExtractionData({
      subjectId: subject.id,
      source: "EXTRACTION",
      extraction: {
        workflow,
        parserName,
        jobId,
        setName,
        sourceFileName,
        importedRowCount: rows.length,
        instructions: sectionInstructions || null,
      },
      parser: {
        workflow,
        name: parserName,
      },
      ...(sectionMap ? { sectionMap } : {}),
      chapters: groupRows(rows, { workflow, jobId, parserName }),
    }, { enabled: true }).extractedData;

    const geminiResponse = {
      source: "EXTRACTION",
      workflow,
      parserName,
      jobId,
      setName,
      rows,
    };

    const existingPending = await prisma.extractionReview.findFirst({
      where: {
        uploadFileId: uploadFile.id,
        status: "PENDING",
      },
      orderBy: { version: "desc" },
    });

    const review = existingPending
      ? await prisma.extractionReview.update({
        where: { id: existingPending.id },
        data: {
          extractedData,
          promptUsed,
          geminiResponse,
        },
        include: {
          uploadFile: true,
          reviewedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      })
      : await reviewRepository.create(uploadFile.id, extractedData, promptUsed, geminiResponse);

    await auditService.log({
      userId: user.id,
      action: existingPending ? "EXTRACTION_REVIEW_UPDATED" : "EXTRACTION_REVIEW_CREATED",
      entityType: "ExtractionReview",
      entityId: review.id,
      newValue: {
        workflow,
        parserName,
        jobId,
        setName,
        rowCount: rows.length,
        subjectId: subject.id,
      },
    });

    return {
      message: existingPending
        ? "Extraction review updated successfully."
        : "Extraction review created successfully.",
      review,
      file: uploadFile,
      rowCount: rows.length,
      questionCount: rows.length,
      updated: Boolean(existingPending),
    };
  }

  async resolveSubject(payload, rows, user) {
    if (payload.subjectId) {
      const subject = await prisma.subject.findFirst({
        where: {
          id: parseInt(payload.subjectId),
          isDeleted: false,
          isActive: true,
        },
      });
      if (subject) return subject;
    }

    const assignedSubjectIds = await subjectAccessService.getAssignedSubjectIds(user);
    const subjectWhere = {
      isDeleted: false,
      isActive: true,
      ...(Array.isArray(assignedSubjectIds)
        ? { id: { in: assignedSubjectIds.length > 0 ? assignedSubjectIds : [-1] } }
        : {}),
    };
    const subjects = await prisma.subject.findMany({
      where: subjectWhere,
      orderBy: { name: "asc" },
    });

    const candidates = buildSubjectCandidates(payload, rows);
    const matched = subjects.find((subject) => {
      const name = text(subject.name).toLowerCase();
      return candidates.some((candidate) => name === candidate || name.includes(candidate) || candidate.includes(name));
    });

    if (matched) return matched;
    if (subjects[0]) return subjects[0];

    const err = new Error("No active subject is available for this extraction review.");
    err.statusCode = 400;
    throw err;
  }

  async ensureCompletedJob(uploadFileId, userId, questionCount, parserName = "Extraction Parser") {
    const existingJob = await prisma.processingJob.findFirst({
      where: { uploadFileId },
      orderBy: { startedAt: "desc" },
    });

    const data = {
      status: "COMPLETED",
      completedAt: new Date(),
      errorMessage: `${parserName} staged ${questionCount} question(s) for extraction review.`,
    };

    if (existingJob) {
      await prisma.processingJob.update({
        where: { id: existingJob.id },
        data,
      });
      return;
    }

    await prisma.processingJob.create({
      data: {
        uploadFileId,
        createdById: parseInt(userId),
        ...data,
      },
    });
  }
}

module.exports = new ExtractionReviewImportService();
