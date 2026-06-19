const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const prisma = require("../config/prisma");

const TEMPLATE_VERSION = "QB-TEMPLATE-2026-06-12";
const TEMPLATE_DATE = "2026-06-12";
const PREVIEW_DIR = path.resolve(__dirname, "../../public/uploads/qb-excel-previews");

const QUESTION_COLUMNS = [
  "Template Version",
  "Bank Name",
  "Bank Description",
  "Academic Year",
  "SSC/Class",
  "Job Role",
  "Subject Code",
  "Subject Name",
  "Is Public",
  "Parent Topic",
  "Sub Topic",
  "Question No",
  "Question Header",
  "Section Name",
  "Section Order",
  "Source Question No",
  "Source Page No",
  "Section Confidence",
  "Subpart Count",
  "Choice Group Key",
  "Question Type",
  "Objective Type",
  "Complexity",
  "Marks",
  "Question Text",
  "Option A",
  "Option B",
  "Option C",
  "Option D",
  "Correct Answer",
  "Explanation",
  "Source File Name",
  "Source Reference",
];

const QUESTION_TYPE_OPTIONS = [
  "MCQ",
  "Short Answer",
  "Long Answer",
  "Very Short Answer",
  "Objective Sub-point",
  "Objective Sub-point MCQ",
  "Objective Sub-point Short Answer",
  "Visually Impaired",
  "Visually Impaired MCQ",
  "Visually Impaired Descriptive",
];

const OBJECTIVE_TYPE_OPTIONS = ["Knowledge", "Understanding", "Application"];
const COMPLEXITY_OPTIONS = ["EASY", "MEDIUM", "HARD"];

const ensurePreviewDir = () => {
  if (!fs.existsSync(PREVIEW_DIR)) fs.mkdirSync(PREVIEW_DIR, { recursive: true });
};

const cleanText = (value) => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const nullableText = (value) => {
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : null;
};

const normalizeBoolean = (value) => {
  const text = cleanText(value).toLowerCase();
  return ["true", "yes", "y", "1", "public"].includes(text);
};

const normalizeDifficulty = (value) => {
  const text = cleanText(value).toUpperCase();
  return COMPLEXITY_OPTIONS.includes(text) ? text : "";
};

const normalizeQuestionTypeLabel = (value) => cleanText(value) || "MCQ";

const toBaseQuestionType = (label, hasOptions) => {
  const normalized = cleanText(label).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  if (normalized === "TRUE_FALSE") return "TRUE_FALSE";
  if (normalized.includes("MCQ") || normalized === "MCQ") return "MCQ";
  if (normalized.includes("LONG") || normalized.includes("ESSAY") || normalized.includes("DESCRIPTIVE")) return "ESSAY";
  if (normalized.includes("VERY_SHORT") || normalized.includes("SHORT")) return "SHORT_ANSWER";
  if (normalized.includes("OBJECTIVE") && hasOptions) return "MCQ";
  return hasOptions ? "MCQ" : "SHORT_ANSWER";
};

const parseMarks = (value) => {
  const parsed = parseInt(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalInt = (value) => {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const parsed = parseInt(cleaned, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

const readCell = (row, key) => cleanText(row[key]);

const buildAnswerRows = (row) => {
  const optionKeys = ["Option A", "Option B", "Option C", "Option D"];
  const correctRaw = readCell(row, "Correct Answer");
  const correctTokens = correctRaw
    .split(/[;,|]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);

  return optionKeys
    .map((key, index) => {
      const content = readCell(row, key);
      if (!content) return null;
      const letter = String.fromCharCode(65 + index);
      return {
        content,
        isCorrect:
          correctTokens.includes(letter) ||
          correctTokens.includes(content.toUpperCase()) ||
          correctTokens.includes(`${letter}.`) ||
          correctTokens.includes(`${letter})`),
        explanation: null,
      };
    })
    .filter(Boolean);
};

const pickQuestionsSheet = (workbook) => {
  if (workbook.Sheets.Questions) return workbook.Sheets.Questions;
  return workbook.Sheets[workbook.SheetNames[0]];
};

const buildTokenPath = (token) => {
  const safeToken = String(token || "").replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(PREVIEW_DIR, `${safeToken}.json`);
};

const writePreviewToken = (payload) => {
  ensurePreviewDir();
  const token = crypto.randomBytes(18).toString("hex");
  fs.writeFileSync(buildTokenPath(token), JSON.stringify(payload, null, 2), "utf8");
  return token;
};

const readPreviewToken = (token) => {
  const tokenPath = buildTokenPath(token);
  if (!tokenPath.startsWith(PREVIEW_DIR + path.sep) || !fs.existsSync(tokenPath)) {
    const err = new Error("Import preview expired. Upload the Excel file again.");
    err.statusCode = 404;
    throw err;
  }

  return {
    tokenPath,
    payload: JSON.parse(fs.readFileSync(tokenPath, "utf8")),
  };
};

class QuestionBankExcelService {
  getTemplateInfo() {
    return {
      version: TEMPLATE_VERSION,
      date: TEMPLATE_DATE,
      fileName: `QB_Excel_Template_${TEMPLATE_DATE}.xlsx`,
    };
  }

  buildTemplateWorkbookBuffer() {
    const workbook = XLSX.utils.book_new();

    const instructions = XLSX.utils.aoa_to_sheet([
      ["Question Bank Excel Template"],
      ["Version", TEMPLATE_VERSION],
      ["Date", TEMPLATE_DATE],
      [],
      ["Instructions"],
      ["Use the Questions sheet for import data. Do not rename headers."],
      ["Question Type and Objective Type are metadata, so admins can add future values when needed."],
      ["MCQ rows should include options and Correct Answer as A, B, C, D, or the exact option text."],
      ["Bank metadata and taxonomy columns can repeat per row; import will create missing banks/topics safely."],
    ]);
    XLSX.utils.book_append_sheet(workbook, instructions, "Template Info");

    const questions = XLSX.utils.aoa_to_sheet([QUESTION_COLUMNS]);
    questions["!cols"] = QUESTION_COLUMNS.map((column) => ({ wch: Math.max(16, column.length + 4) }));
    XLSX.utils.book_append_sheet(workbook, questions, "Questions");

    const sampleRows = XLSX.utils.aoa_to_sheet([
      QUESTION_COLUMNS,
      [
        TEMPLATE_VERSION,
        "Sample Science Bank",
        "Prepared offline using the latest template",
        "2026-27",
        "SSC 10",
        "Student",
        "SCI-10",
        "Science",
        "Yes",
        "Basic Facts",
        "Energy",
        "Q-001",
        "",
        "Section A",
        1,
        "1",
        1,
        "VERIFIED",
        0,
        "",
        "MCQ",
        "Knowledge",
        "EASY",
        1,
        "What is the main source of energy for Earth?",
        "Moon",
        "Sun",
        "Wind",
        "Coal",
        "B",
        "",
        "offline-prep.xlsx",
        "Page 1",
      ],
      [
        TEMPLATE_VERSION,
        "Sample Science Bank",
        "Prepared offline using the latest template",
        "2026-27",
        "SSC 10",
        "Student",
        "SCI-10",
        "Science",
        "Yes",
        "Basic Facts",
        "Energy",
        "Q-002",
        "",
        "Section B",
        2,
        "29",
        2,
        "VERIFIED",
        0,
        "",
        "Very Short Answer",
        "Understanding",
        "MEDIUM",
        2,
        "Define renewable energy.",
        "",
        "",
        "",
        "",
        "",
        "Expected answer can be typed here.",
        "offline-prep.xlsx",
        "Page 2",
      ],
    ]);
    sampleRows["!cols"] = QUESTION_COLUMNS.map((column) => ({ wch: Math.max(16, column.length + 4) }));
    XLSX.utils.book_append_sheet(workbook, sampleRows, "Sample Rows");

    const lists = XLSX.utils.aoa_to_sheet([
      ["Question Types", "Objective Types", "Complexity"],
      ...Array.from({ length: Math.max(QUESTION_TYPE_OPTIONS.length, OBJECTIVE_TYPE_OPTIONS.length, COMPLEXITY_OPTIONS.length) }).map((_, index) => [
        QUESTION_TYPE_OPTIONS[index] || "",
        OBJECTIVE_TYPE_OPTIONS[index] || "",
        COMPLEXITY_OPTIONS[index] || "",
      ]),
    ]);
    XLSX.utils.book_append_sheet(workbook, lists, "Validation Lists");

    return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  }

  async preview(file, userId) {
    if (!file) {
      const err = new Error("Excel file is required.");
      err.statusCode = 400;
      throw err;
    }

    const workbook = XLSX.readFile(file.path, { cellDates: false });
    const sheet = pickQuestionsSheet(workbook);
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    fs.promises.unlink(file.path).catch(() => {});

    const rows = [];
    const templateVersions = new Set();

    for (let index = 0; index < rawRows.length; index += 1) {
      const raw = rawRows[index];
      const hasData = QUESTION_COLUMNS.some((column) => cleanText(raw[column]));
      if (!hasData) continue;

      const normalized = this.normalizeRow(raw, index + 2);
      if (normalized.templateVersion) templateVersions.add(normalized.templateVersion);
      rows.push(normalized);
    }

    if (rows.length === 0) {
      const err = new Error("No question rows found in the Questions sheet.");
      err.statusCode = 400;
      throw err;
    }

    const incompatibleVersion = Array.from(templateVersions).find((version) => version !== TEMPLATE_VERSION);
    if (incompatibleVersion || templateVersions.size === 0) {
      const err = new Error(`Incompatible template version. Please download the latest template: ${TEMPLATE_VERSION}.`);
      err.statusCode = 400;
      throw err;
    }

    await this.attachPreviewActions(rows, userId);

    const payload = {
      templateVersion: TEMPLATE_VERSION,
      createdAt: new Date().toISOString(),
      userId,
      rows,
    };
    const previewToken = writePreviewToken(payload);
    const summary = this.buildSummary(rows);

    return {
      previewToken,
      templateVersion: TEMPLATE_VERSION,
      templateDate: TEMPLATE_DATE,
      summary,
      rows,
    };
  }

  normalizeRow(row, rowNumber) {
    const answers = buildAnswerRows(row);
    const questionTypeLabel = normalizeQuestionTypeLabel(readCell(row, "Question Type"));
    const marks = parseMarks(readCell(row, "Marks"));
    const normalized = {
      rowNumber,
      templateVersion: readCell(row, "Template Version"),
      bankName: readCell(row, "Bank Name"),
      bankDescription: nullableText(row["Bank Description"]),
      academicYear: nullableText(row["Academic Year"]),
      sscClass: nullableText(row["SSC/Class"]),
      jobRole: nullableText(row["Job Role"]),
      subjectCode: nullableText(row["Subject Code"]),
      subjectName: readCell(row, "Subject Name"),
      isPublic: normalizeBoolean(row["Is Public"]),
      parentTopic: readCell(row, "Parent Topic"),
      subTopic: readCell(row, "Sub Topic"),
      questionNo: nullableText(row["Question No"]),
      questionHeader: nullableText(row["Question Header"]),
      sectionName: nullableText(row["Section Name"]),
      sectionOrder: parseOptionalInt(row["Section Order"]),
      sourceQuestionNo: nullableText(row["Source Question No"] || row["Question No"]),
      sourcePageNo: parseOptionalInt(row["Source Page No"]),
      sectionConfidence: nullableText(row["Section Confidence"]),
      subpartCount: parseOptionalInt(row["Subpart Count"]),
      choiceGroupKey: nullableText(row["Choice Group Key"]),
      questionTypeLabel,
      baseQuestionType: toBaseQuestionType(questionTypeLabel, answers.length > 0),
      objectiveType: nullableText(row["Objective Type"]),
      difficulty: normalizeDifficulty(row["Complexity"]),
      marks,
      questionText: readCell(row, "Question Text"),
      answers,
      correctAnswer: readCell(row, "Correct Answer"),
      explanation: nullableText(row["Explanation"]),
      sourceFileName: nullableText(row["Source File Name"]),
      sourceReference: nullableText(row["Source Reference"]),
      errors: [],
      warnings: [],
      action: "CREATE",
      bankAction: "CREATE",
    };

    this.validateRow(normalized);
    return normalized;
  }

  validateRow(row) {
    const required = [
      ["bankName", "Bank Name is required"],
      ["subjectName", "Subject Name is required"],
      ["parentTopic", "Parent Topic is required"],
      ["subTopic", "Sub Topic is required"],
      ["questionText", "Question Text is required"],
      ["questionTypeLabel", "Question Type is required"],
      ["difficulty", "Complexity must be EASY, MEDIUM, or HARD"],
    ];

    for (const [field, message] of required) {
      if (!row[field]) row.errors.push(message);
    }

    if (!row.marks) row.errors.push("Marks must be a positive number");

    if (row.baseQuestionType === "MCQ") {
      if (row.answers.length < 2) row.errors.push("MCQ rows require at least two options");
      if (!row.answers.some((answer) => answer.isCorrect)) row.errors.push("MCQ rows require a valid Correct Answer");
    }
  }

  async attachPreviewActions(rows, userId) {
    const validRows = rows.filter((row) => row.errors.length === 0);

    for (const row of validRows) {
      const bank = await prisma.questionBank.findFirst({
        where: {
          name: row.bankName,
          OR: [{ createdById: parseInt(userId) }, { isPublic: true }],
        },
        include: {
          bankQuestions: {
            include: { question: true },
          },
        },
      });

      row.bankAction = bank ? "USE_EXISTING" : "CREATE";
      if (!bank) continue;

      const sameNo = row.questionNo
        ? bank.bankQuestions.find((item) => item.question.questionNo === row.questionNo)
        : null;
      const sameText = bank.bankQuestions.find(
        (item) => item.question.content.trim().toLowerCase() === row.questionText.trim().toLowerCase()
      );

      if (sameNo || sameText) {
        row.action = "UPDATE";
        row.existingQuestionId = (sameNo || sameText).questionId;
        row.warnings.push(
          sameNo
            ? `Existing question with Question No. ${row.questionNo} will be updated`
            : "Possible duplicate question text will be updated"
        );
      }
    }
  }

  buildSummary(rows) {
    return {
      totalRows: rows.length,
      validRows: rows.filter((row) => row.errors.length === 0).length,
      errorRows: rows.filter((row) => row.errors.length > 0).length,
      warningRows: rows.filter((row) => row.warnings.length > 0).length,
      createRows: rows.filter((row) => row.errors.length === 0 && row.action === "CREATE").length,
      updateRows: rows.filter((row) => row.errors.length === 0 && row.action === "UPDATE").length,
    };
  }

  async commit(previewToken, userId) {
    const { tokenPath, payload } = readPreviewToken(previewToken);

    if (parseInt(payload.userId) !== parseInt(userId)) {
      const err = new Error("This import preview belongs to another user.");
      err.statusCode = 403;
      throw err;
    }

    const rows = payload.rows || [];
    const invalidRows = rows.filter((row) => row.errors?.length > 0);
    if (invalidRows.length > 0) {
      const err = new Error("Fix validation errors before importing the Excel file.");
      err.statusCode = 400;
      err.details = invalidRows;
      throw err;
    }

    const result = await prisma.$transaction(async (tx) => {
      let createdBanks = 0;
      let createdQuestions = 0;
      let updatedQuestions = 0;
      let linkedQuestions = 0;

      for (const row of rows) {
        const subject = await this.findOrCreateSubject(tx, row.subjectName);
        const chapter = await this.findOrCreateChapter(tx, subject.id, row.parentTopic);
        const concept = await this.findOrCreateConcept(tx, chapter.id, row.subTopic);
        const bankResult = await this.findOrCreateBank(tx, row, userId);
        if (bankResult.created) createdBanks += 1;

        const questionPayload = {
          content: row.questionText,
          type: row.baseQuestionType,
          questionNo: row.questionNo,
          questionHeader: row.questionHeader,
          sectionName: row.sectionName,
          sectionOrder: row.sectionOrder,
          sourceQuestionNo: row.sourceQuestionNo,
          sourcePageNo: row.sourcePageNo,
          sectionConfidence: row.sectionConfidence,
          sectionEvidence: row.sectionName
            ? {
                signals: ["question-bank-excel"],
                importedAt: new Date().toISOString(),
              }
            : null,
          subpartCount: row.subpartCount,
          choiceGroupKey: row.choiceGroupKey,
          questionTypeLabel: row.questionTypeLabel,
          objectiveType: row.objectiveType,
          marks: row.marks,
          difficulty: row.difficulty,
          status: "APPROVED",
          explanation: row.explanation,
          conceptId: concept.id,
          sourceFileName: row.sourceFileName,
          sourceReference: row.sourceReference,
          sourceType: "EXCEL",
        };

        const existing = await this.findExistingQuestion(tx, bankResult.bank.id, row);
        let question;

        if (existing) {
          question = await tx.question.update({
            where: { id: existing.id },
            data: questionPayload,
          });
          await tx.answer.deleteMany({ where: { questionId: question.id } });
          updatedQuestions += 1;
        } else {
          question = await tx.question.create({
            data: {
              ...questionPayload,
              createdById: parseInt(userId),
            },
          });
          createdQuestions += 1;
        }

        if (row.answers.length > 0) {
          await tx.answer.createMany({
            data: row.answers.map((answer) => ({
              questionId: question.id,
              content: answer.content,
              isCorrect: answer.isCorrect,
              explanation: answer.explanation,
            })),
          });
        }

        await tx.bankQuestion.upsert({
          where: {
            bankId_questionId: {
              bankId: bankResult.bank.id,
              questionId: question.id,
            },
          },
          update: {},
          create: {
            bankId: bankResult.bank.id,
            questionId: question.id,
            sortOrder: 0,
          },
        });
        linkedQuestions += 1;
      }

      return {
        createdBanks,
        createdQuestions,
        updatedQuestions,
        linkedQuestions,
      };
    });

    fs.promises.unlink(tokenPath).catch(() => {});
    return result;
  }

  async findOrCreateSubject(tx, name) {
    const existing = await tx.subject.findFirst({
      where: { name, isDeleted: false },
    });
    if (existing) return existing;
    return tx.subject.create({ data: { name } });
  }

  async findOrCreateChapter(tx, subjectId, name) {
    const existing = await tx.chapter.findFirst({
      where: { subjectId, name, isDeleted: false },
    });
    if (existing) return existing;
    return tx.chapter.create({ data: { subjectId, name } });
  }

  async findOrCreateConcept(tx, chapterId, name) {
    const existing = await tx.concept.findFirst({
      where: { chapterId, name, isDeleted: false },
    });
    if (existing) return existing;
    return tx.concept.create({ data: { chapterId, name } });
  }

  async findOrCreateBank(tx, row, userId) {
    const existing = await tx.questionBank.findFirst({
      where: {
        name: row.bankName,
        createdById: parseInt(userId),
      },
    });

    if (existing) return { bank: existing, created: false };

    const bank = await tx.questionBank.create({
      data: {
        name: row.bankName,
        description: row.bankDescription,
        isPublic: row.isPublic,
        academicYear: row.academicYear,
        sscClass: row.sscClass,
        jobRole: row.jobRole,
        subjectCode: row.subjectCode,
        subjectName: row.subjectName,
        createdById: parseInt(userId),
      },
    });

    return { bank, created: true };
  }

  async findExistingQuestion(tx, bankId, row) {
    if (row.questionNo) {
      const byNo = await tx.question.findFirst({
        where: {
          questionNo: row.questionNo,
          bankQuestions: { some: { bankId } },
        },
      });
      if (byNo) return byNo;
    }

    return tx.question.findFirst({
      where: {
        content: row.questionText,
        bankQuestions: { some: { bankId } },
      },
    });
  }
}

module.exports = new QuestionBankExcelService();
