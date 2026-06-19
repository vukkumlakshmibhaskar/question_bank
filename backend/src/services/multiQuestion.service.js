const questionRepository = require("../repositories/question.repository");
const questionService = require("./question.service");

const DEFAULT_QUESTION_TYPES = [
  { value: "MCQ", label: "MCQ" },
  { value: "SHORT_ANSWER", label: "Short Answer" },
  { value: "LONG_ANSWER", label: "Long Answer" },
  { value: "VERY_SHORT_ANSWER", label: "Very Short Answer" },
  { value: "OBJECTIVE_SUB_POINT", label: "Objective Sub-point" },
  { value: "OBJECTIVE_SUB_POINT_MCQ", label: "Objective Sub-point MCQ" },
  { value: "OBJECTIVE_SUB_POINT_SHORT", label: "Objective Sub-point Short Answer" },
  { value: "VISUALLY_IMPAIRED", label: "Visually Impaired" },
  { value: "VISUALLY_IMPAIRED_MCQ", label: "Visually Impaired MCQ" },
  { value: "VISUALLY_IMPAIRED_DESCRIPTIVE", label: "Visually Impaired Descriptive" },
];

const DEFAULT_OBJECTIVE_TYPES = [
  { value: "Knowledge", label: "Knowledge" },
  { value: "Understanding", label: "Understanding" },
  { value: "Application", label: "Application" },
];

const cleanOptionalText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeOption = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ");

const toOption = (label) => ({
  value: normalizeOption(label),
  label: normalizeOption(label),
});

class MultiQuestionService {
  async getSettings() {
    const rows = await questionRepository.findQuestionMetadataValues();
    const existingTypes = new Map(DEFAULT_QUESTION_TYPES.map((item) => [item.value.toLowerCase(), item]));
    const existingObjectives = new Map(DEFAULT_OBJECTIVE_TYPES.map((item) => [item.value.toLowerCase(), item]));
    const headers = new Map();

    for (const row of rows) {
      if (row.questionTypeLabel) {
        const option = toOption(row.questionTypeLabel);
        existingTypes.set(option.value.toLowerCase(), option);
      }
      if (row.objectiveType) {
        const option = toOption(row.objectiveType);
        existingObjectives.set(option.value.toLowerCase(), option);
      }
      if (row.questionHeader) {
        const option = toOption(row.questionHeader);
        headers.set(option.value.toLowerCase(), option);
      }
    }

    return {
      questionTypes: Array.from(existingTypes.values()),
      objectiveTypes: Array.from(existingObjectives.values()),
      questionHeaders: Array.from(headers.values()).sort((left, right) => left.label.localeCompare(right.label)),
      metadataMode: "configurable",
    };
  }

  async list(filters) {
    return questionService.getQuestionsList({
      bankId: filters.bankId,
      parentTopicId: filters.parentTopicId,
      subTopicId: filters.subTopicId,
      questionTypeLabel: filters.questionType,
      type: filters.questionType,
      objectiveType: filters.objectiveType,
      questionHeader: filters.questionHeader,
      complexity: filters.complexity,
      questionNo: filters.questionNo,
      questionText: filters.questionText,
      marks: filters.marks,
      page: filters.page,
      pageSize: filters.pageSize,
      limit: filters.limit,
      offset: filters.offset,
    });
  }

  async updateHeader(id, header, userId, userRole) {
    const question = await questionRepository.findQuestionById(id);
    if (!question) {
      const err = new Error("Question not found");
      err.statusCode = 404;
      throw err;
    }

    if (userRole !== "ADMIN" && question.createdById !== userId) {
      const err = new Error("Forbidden: You can only modify your own questions.");
      err.statusCode = 403;
      throw err;
    }

    return questionRepository.updateQuestionMetadata(id, {
      questionHeader: cleanOptionalText(header),
    });
  }
}

module.exports = new MultiQuestionService();
