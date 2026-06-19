const questionRepository = require("../repositories/question.repository");
const subjectAccessService = require("./subjectAccess.service");
const { parsePagination } = require("../utils/pagination");

const cleanOptionalText = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBoolean = (value) => {
  return value === true || value === "true" || value === 1 || value === "1";
};

const normalizeList = (value) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string" && value.includes(",")) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return value ? [String(value).trim()] : [];
};

const normalizeOptionalInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInt(value);
  return Number.isInteger(parsed) ? parsed : null;
};

const normalizeJsonObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
};

const normalizeMediaUrl = (value) => cleanOptionalText(value);

const normalizeQuestionContent = (questionData = {}) => {
  const content = cleanOptionalText(questionData.content);
  const imageUrl = normalizeMediaUrl(questionData.imageUrl);
  return {
    content: content || (imageUrl ? "[Image question]" : null),
    imageUrl,
  };
};

const normalizeAnswers = (answersData = []) =>
  answersData.map((answer) => {
    const content = cleanOptionalText(answer.content);
    const imageUrl = normalizeMediaUrl(answer.imageUrl);
    return {
      ...answer,
      content: content || (imageUrl ? "[Image option]" : ""),
      imageUrl,
    };
  });

const QUESTION_TYPE_VALUES = new Set(["MCQ", "TRUE_FALSE", "SHORT_ANSWER", "ESSAY"]);

const normalizeQuestionMode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const QUESTION_MODE_TYPE_MAP = {
  CHECKBOX: ["MCQ"],
  LIST: ["MCQ", "TRUE_FALSE"],
  RICHTEXTEDITOR: ["ESSAY"],
  TEXT_PARAGRAPH: ["SHORT_ANSWER", "ESSAY"],
  TEXT: ["SHORT_ANSWER", "ESSAY"],
  PARAGRAPH: ["ESSAY"],
};

const QUESTION_MODE_MIME_PREFIX = {
  AUDIO: "audio/",
  IMAGE: "image/",
  VIDEO: "video/",
};

const buildBankPayload = (bankData, createdById) => ({
  name: String(bankData.name || "").trim(),
  description: cleanOptionalText(bankData.description),
  isPublic: normalizeBoolean(bankData.isPublic),
  academicYear: cleanOptionalText(bankData.academicYear),
  sscClass: cleanOptionalText(bankData.sscClass),
  jobRole: cleanOptionalText(bankData.jobRole),
  subjectCode: cleanOptionalText(bankData.subjectCode),
  subjectName: cleanOptionalText(bankData.subjectName),
  ...(createdById ? { createdById } : {}),
});

class QuestionService {
  // --- Question Services ---
  async createQuestion(userId, questionData, answersData, user = null) {
    const normalizedQuestion = normalizeQuestionContent(questionData);
    const normalizedAnswers = normalizeAnswers(answersData);

    if (!normalizedQuestion.content) {
      const err = new Error("Question content is required");
      err.statusCode = 400;
      throw err;
    }

    if (!questionData.conceptId) {
      const err = new Error("Concept ID is required to categorize the question");
      err.statusCode = 400;
      throw err;
    }

    await this.ensureConceptSubjectAccess(questionData.conceptId, user || { id: userId });

    // Validate MCQ rules
    if (questionData.type === "MCQ") {
      if (!normalizedAnswers || normalizedAnswers.length < 2) {
        const err = new Error("MCQ questions require at least two answer options.");
        err.statusCode = 400;
        throw err;
      }
      const hasBlankAnswer = normalizedAnswers.some((ans) => !ans.content && !ans.imageUrl);
      if (hasBlankAnswer) {
        const err = new Error("Each MCQ option requires text or an image.");
        err.statusCode = 400;
        throw err;
      }
      const hasCorrect = normalizedAnswers.some((ans) => ans.isCorrect);
      if (!hasCorrect) {
        const err = new Error("MCQ questions require at least one correct answer option.");
        err.statusCode = 400;
        throw err;
      }
    }

    const data = {
      content: normalizedQuestion.content,
      imageUrl: normalizedQuestion.imageUrl,
      type: questionData.type || "MCQ",
      questionNo: cleanOptionalText(questionData.questionNo),
      questionHeader: cleanOptionalText(questionData.questionHeader),
      sectionName: cleanOptionalText(questionData.sectionName),
      sectionOrder: normalizeOptionalInt(questionData.sectionOrder),
      sourceQuestionNo: cleanOptionalText(questionData.sourceQuestionNo || questionData.questionNo),
      sourcePageNo: normalizeOptionalInt(questionData.sourcePageNo || questionData.pageNo),
      sectionConfidence: cleanOptionalText(questionData.sectionConfidence),
      sectionEvidence: normalizeJsonObject(questionData.sectionEvidence),
      subpartCount: normalizeOptionalInt(questionData.subpartCount),
      choiceGroupKey: cleanOptionalText(questionData.choiceGroupKey),
      questionTypeLabel: cleanOptionalText(questionData.questionTypeLabel || questionData.displayQuestionType),
      objectiveType: cleanOptionalText(questionData.objectiveType),
      marks: normalizeOptionalInt(questionData.marks),
      sourceFileName: cleanOptionalText(questionData.sourceFileName),
      sourceReference: cleanOptionalText(questionData.sourceReference),
      sourceType: cleanOptionalText(questionData.sourceType || "MANUAL"),
      importJobId: normalizeOptionalInt(questionData.importJobId),
      extractionReviewId: normalizeOptionalInt(questionData.extractionReviewId),
      difficulty: questionData.difficulty || "MEDIUM",
      status: questionData.status || "DRAFT",
      explanation: questionData.explanation,
      createdById: userId,
      conceptId: questionData.conceptId,
      sourceFileId: questionData.sourceFileId || null,
    };

    return questionRepository.createQuestion(data, normalizedAnswers);
  }

  async updateQuestion(id, userId, userRole, questionData, answersData) {
    const question = await questionRepository.findQuestionById(id);
    if (!question) {
      const err = new Error("Question not found");
      err.statusCode = 404;
      throw err;
    }

    await this.ensureQuestionSubjectAccess(question, { id: userId, role: userRole });

    // Role restriction: Teachers can only edit their own questions unless Admin
    if (userRole !== "ADMIN" && question.createdById !== userId) {
      const err = new Error("Forbidden: You can only modify your own questions.");
      err.statusCode = 403;
      throw err;
    }

    if (questionData?.conceptId) {
      await this.ensureConceptSubjectAccess(questionData.conceptId, { id: userId, role: userRole });
    }

    const normalizedQuestion = questionData
      ? {
          ...questionData,
          ...normalizeQuestionContent(questionData),
        }
      : questionData;
    const normalizedAnswers = Array.isArray(answersData) ? normalizeAnswers(answersData) : answersData;

    return questionRepository.updateQuestion(id, normalizedQuestion, normalizedAnswers);
  }

  async getQuestionsList({
    subjectId,
    chapterId,
    conceptId,
    parentTopicId,
    subTopicId,
    bankId,
    questionNo,
    questionText,
    difficulty,
    complexity,
    status,
    search,
    type,
    questionMode,
    authorId,
    dateStart,
    dateEnd,
    answerSearch,
    sourceFileName,
    questionHeader,
    sectionName,
    sourceQuestionNo,
    sectionConfidence,
    objectiveType,
    questionTypeLabel,
    marks,
    marksMin,
    marksMax,
    page,
    pageSize,
    limit,
    offset,
  }, user = null) {
    const andConditions = [];
    const effectiveChapterId = parentTopicId || chapterId;
    const effectiveConceptId = subTopicId || conceptId;
    const assignedSubjectIds = await subjectAccessService.getAssignedSubjectIds(user);

    if (Array.isArray(assignedSubjectIds)) {
      andConditions.push({
        concept: {
          chapter: {
            subjectId: subjectAccessService.assignedSubjectFilter(assignedSubjectIds),
          },
        },
      });
    }

    // 1. Relational Filtering (Prisma nesting)
    if (effectiveConceptId) {
      andConditions.push({ conceptId: parseInt(effectiveConceptId) });
    } else if (effectiveChapterId) {
      andConditions.push({ concept: { chapterId: parseInt(effectiveChapterId) } });
    } else if (subjectId) {
      andConditions.push({ concept: { chapter: { subjectId: parseInt(subjectId) } } });
    }

    if (bankId) {
      andConditions.push({
        bankQuestions: {
          some: {
            bankId: parseInt(bankId),
          },
        },
      });
    }

    if (questionNo) {
      const parsedQuestionNo = parseInt(questionNo);
      if (Number.isInteger(parsedQuestionNo) && parsedQuestionNo > 0) {
        andConditions.push({ id: parsedQuestionNo });
      }
    }

    // 2. Direct Filters
    const difficultyValues = normalizeList(complexity || difficulty);
    if (difficultyValues.length > 0) {
      andConditions.push({ difficulty: difficultyValues.length > 1 ? { in: difficultyValues } : difficultyValues[0] });
    }

    const statusValues = normalizeList(status);
    if (statusValues.length > 0) {
      andConditions.push({ status: statusValues.length > 1 ? { in: statusValues } : statusValues[0] });
    }

    const typeValues = normalizeList(type);
    if (typeValues.length > 0) {
      const enumTypes = typeValues
        .map((item) => normalizeQuestionMode(item))
        .filter((item) => QUESTION_TYPE_VALUES.has(item));
      const metadataTypes = typeValues.filter((item) => !QUESTION_TYPE_VALUES.has(normalizeQuestionMode(item)));

      if (enumTypes.length > 0 && metadataTypes.length > 0) {
        andConditions.push({
          OR: [
            { type: enumTypes.length > 1 ? { in: enumTypes } : enumTypes[0] },
            ...metadataTypes.map((item) => ({ questionTypeLabel: { contains: item } })),
          ],
        });
      } else if (enumTypes.length > 0) {
        andConditions.push({ type: enumTypes.length > 1 ? { in: enumTypes } : enumTypes[0] });
      } else {
        andConditions.push({
          OR: metadataTypes.map((item) => ({ questionTypeLabel: { contains: item } })),
        });
      }
    }

    const richTypeValues = normalizeList(questionTypeLabel);
    if (richTypeValues.length > 0) {
      andConditions.push({
        OR: richTypeValues.map((item) => ({ questionTypeLabel: { contains: item } })),
      });
    }

    const headerText = cleanOptionalText(questionHeader);
    if (headerText) {
      andConditions.push({ questionHeader: { contains: headerText } });
    }

    const sectionText = cleanOptionalText(sectionName);
    if (sectionText) {
      andConditions.push({ sectionName: { contains: sectionText } });
    }

    const sourceQuestionNoText = cleanOptionalText(sourceQuestionNo);
    if (sourceQuestionNoText) {
      andConditions.push({ sourceQuestionNo: { contains: sourceQuestionNoText } });
    }

    const sectionConfidenceText = cleanOptionalText(sectionConfidence);
    if (sectionConfidenceText) {
      andConditions.push({ sectionConfidence: sectionConfidenceText.toUpperCase() });
    }

    const objectiveText = cleanOptionalText(objectiveType);
    if (objectiveText) {
      andConditions.push({ objectiveType: { contains: objectiveText } });
    }

    const parsedMarks = normalizeOptionalInt(marks);
    if (parsedMarks !== null) {
      andConditions.push({ marks: parsedMarks });
    } else if (marksMin || marksMax) {
      const marksRange = {};
      const parsedMin = normalizeOptionalInt(marksMin);
      const parsedMax = normalizeOptionalInt(marksMax);
      if (parsedMin !== null) marksRange.gte = parsedMin;
      if (parsedMax !== null) marksRange.lte = parsedMax;
      if (Object.keys(marksRange).length > 0) andConditions.push({ marks: marksRange });
    }

    const questionModeFilters = this.buildQuestionModeFilters(questionMode);
    if (questionModeFilters.length > 0) {
      andConditions.push({ OR: questionModeFilters });
    }

    if (authorId) {
      andConditions.push({ createdById: parseInt(authorId) });
    }

    // 3. Date Range Filter
    if (dateStart || dateEnd) {
      const createdAt = {};
      if (dateStart) {
        createdAt.gte = new Date(dateStart);
      }
      if (dateEnd) {
        createdAt.lte = new Date(dateEnd);
      }
      andConditions.push({ createdAt });
    }

    // 4. Text Search (Matches content or explanation)
    const textSearch = cleanOptionalText(questionText) || cleanOptionalText(search);
    if (textSearch) {
      andConditions.push({
        OR: [
          { content: { contains: textSearch } },
          { explanation: { contains: textSearch } },
        ],
      });
    }

    // 5. Option Answer text search
    const answerText = cleanOptionalText(answerSearch);
    if (answerText) {
      andConditions.push({
        answers: {
          some: {
            content: { contains: answerText },
          },
        },
      });
    }

    const sourceText = cleanOptionalText(sourceFileName);
    if (sourceText) {
      andConditions.push({
        OR: [
          { sourceFile: { is: { fileName: { contains: sourceText } } } },
          { sourceFileName: { contains: sourceText } },
          { sourceReference: { contains: sourceText } },
          { attachments: { some: { fileName: { contains: sourceText } } } },
        ],
      });
    }

    const where = andConditions.length > 0 ? { AND: andConditions } : {};
    return questionRepository.findQuestions(where, parsePagination({ page, pageSize, limit, offset }));
  }

  buildQuestionModeFilters(questionMode) {
    const filters = [];
    const modes = normalizeList(questionMode).map(normalizeQuestionMode).filter(Boolean);

    for (const mode of modes) {
      const mappedTypes = QUESTION_MODE_TYPE_MAP[mode];
      if (mappedTypes) {
        filters.push({ type: mappedTypes.length > 1 ? { in: mappedTypes } : mappedTypes[0] });
      }

      const mimePrefix = QUESTION_MODE_MIME_PREFIX[mode];
      if (mimePrefix) {
        filters.push({
          OR: [
            { imageUrl: { not: null } },
            { answers: { some: { imageUrl: { not: null } } } },
            { attachments: { some: { mimeType: { startsWith: mimePrefix } } } },
            { sourceFile: { is: { mimeType: { startsWith: mimePrefix } } } },
          ],
        });
      }
    }

    return filters;
  }

  async getQuestionById(id, user = null) {
    const question = await questionRepository.findQuestionById(id);
    if (!question) {
      const err = new Error("Question not found");
      err.statusCode = 404;
      throw err;
    }
    await this.ensureQuestionSubjectAccess(question, user);
    return question;
  }

  async deleteQuestion(id, userId, userRole) {
    const question = await questionRepository.findQuestionById(id);
    if (!question) {
      const err = new Error("Question not found");
      err.statusCode = 404;
      throw err;
    }

    await this.ensureQuestionSubjectAccess(question, { id: userId, role: userRole });

    if (userRole !== "ADMIN" && question.createdById !== userId) {
      const err = new Error("Forbidden: You can only delete your own questions.");
      err.statusCode = 403;
      throw err;
    }

    await questionRepository.deleteQuestion(id);
    return { success: true };
  }

  async deleteQuestionsBulk(ids, userId, userRole) {
    if (!Array.isArray(ids) || ids.length === 0) {
      const err = new Error("No question IDs provided for bulk deletion");
      err.statusCode = 400;
      throw err;
    }

    const parsedIds = ids.map(id => parseInt(id));

    for (const id of parsedIds) {
      const question = await questionRepository.findQuestionById(id);
      if (!question) {
        const err = new Error(`Question #${id} not found`);
        err.statusCode = 404;
        throw err;
      }
      await this.ensureQuestionSubjectAccess(question, { id: userId, role: userRole });
      if (userRole !== "ADMIN" && question.createdById !== userId) {
        const err = new Error(`Forbidden: You can only delete your own questions. Question #${id} belongs to another user.`);
        err.statusCode = 403;
        throw err;
      }
    }

    await questionRepository.deleteQuestions(parsedIds);
    return { success: true, count: parsedIds.length };
  }

  // --- Question Bank Services ---
  async createQuestionBank(userId, bankData) {
    if (!bankData.name || bankData.name.trim() === "") {
      const err = new Error("Question Bank name is required");
      err.statusCode = 400;
      throw err;
    }

    const data = buildBankPayload(bankData, userId);

    return questionRepository.createBank(data);
  }

  async getBanksList(userId, {
    search,
    isPublic,
    academicYear,
    sscClass,
    jobRole,
    subjectCode,
    subjectName,
    page,
    pageSize,
    limit,
    offset,
  }, user = null) {
    const where = {};
    const andConditions = [];

    // Filter by ownership or publicity
    if (isPublic !== undefined) {
      where.isPublic = normalizeBoolean(isPublic);
    } else {
      // Return public banks OR banks created by this user
      where.OR = [
        { isPublic: true },
        { createdById: userId }
      ];
    }

    if (user?.role !== "ADMIN") {
      const assignedSubjectNames = await subjectAccessService.getAssignedSubjectNames(user);
      const subjectAccessOr = [{ createdById: parseInt(userId) }];
      if (assignedSubjectNames.length > 0) {
        subjectAccessOr.push({ subjectName: { in: assignedSubjectNames } });
      }
      andConditions.push({ OR: subjectAccessOr });
    }

    if (search && search.trim() !== "") {
      where.name = { contains: search };
    }

    if (academicYear && academicYear.trim() !== "") {
      where.academicYear = { contains: academicYear.trim() };
    }
    if (sscClass && sscClass.trim() !== "") {
      where.sscClass = { contains: sscClass.trim() };
    }
    if (jobRole && jobRole.trim() !== "") {
      where.jobRole = { contains: jobRole.trim() };
    }
    if (subjectCode && subjectCode.trim() !== "") {
      where.subjectCode = { contains: subjectCode.trim() };
    }
    if (subjectName && subjectName.trim() !== "") {
      where.subjectName = { contains: subjectName.trim() };
    }

    if (andConditions.length > 0) {
      where.AND = [...(where.AND || []), ...andConditions];
    }

    return questionRepository.findBanks(where, parsePagination({ page, pageSize, limit, offset }));
  }

  async getBankById(id) {
    const bank = await questionRepository.findBankById(id);
    if (!bank) {
      const err = new Error("Question Bank not found");
      err.statusCode = 404;
      throw err;
    }
    return bank;
  }

  async updateQuestionBank(id, userId, userRole, bankData) {
    if (!bankData.name || bankData.name.trim() === "") {
      const err = new Error("Question Bank name is required");
      err.statusCode = 400;
      throw err;
    }

    const bank = await questionRepository.findBankById(id);
    if (!bank) {
      const err = new Error("Question Bank not found");
      err.statusCode = 404;
      throw err;
    }

    if (userRole !== "ADMIN" && bank.createdById !== userId) {
      const err = new Error("Forbidden: You can only update your own Question Banks.");
      err.statusCode = 403;
      throw err;
    }

    return questionRepository.updateBank(id, buildBankPayload(bankData));
  }

  async deleteBank(id, userId, userRole) {
    const bank = await questionRepository.findBankById(id);
    if (!bank) {
      const err = new Error("Question Bank not found");
      err.statusCode = 404;
      throw err;
    }

    if (userRole !== "ADMIN" && bank.createdById !== userId) {
      const err = new Error("Forbidden: You can only delete your own Question Banks.");
      err.statusCode = 403;
      throw err;
    }

    await questionRepository.deleteBank(id);
    return { success: true };
  }

  async addQuestionToBank(bankId, questionId, userId, userRole, sortOrder) {
    const bank = await questionRepository.findBankById(bankId);
    if (!bank) {
      const err = new Error("Question Bank not found");
      err.statusCode = 404;
      throw err;
    }

    if (userRole !== "ADMIN" && bank.createdById !== userId) {
      const err = new Error("Forbidden: You can only modify your own Question Banks.");
      err.statusCode = 403;
      throw err;
    }

    // Verify question exists
    const question = await questionRepository.findQuestionById(questionId);
    if (!question) {
      const err = new Error("Question not found");
      err.statusCode = 404;
      throw err;
    }
    await this.ensureQuestionSubjectAccess(question, { id: userId, role: userRole });

    return questionRepository.addQuestionToBank(bankId, questionId, sortOrder);
  }

  async addQuestionsToBank(bankId, questionIds, userId, userRole, sortOrder = 0) {
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      const err = new Error("At least one question ID is required.");
      err.statusCode = 400;
      throw err;
    }

    const parsedQuestionIds = [...new Set(questionIds.map((id) => parseInt(id)).filter(Number.isInteger))];
    if (parsedQuestionIds.length === 0) {
      const err = new Error("At least one valid question ID is required.");
      err.statusCode = 400;
      throw err;
    }

    const bank = await questionRepository.findBankById(bankId);
    if (!bank) {
      const err = new Error("Question Bank not found");
      err.statusCode = 404;
      throw err;
    }

    if (userRole !== "ADMIN" && bank.createdById !== userId) {
      const err = new Error("Forbidden: You can only modify your own Question Banks.");
      err.statusCode = 403;
      throw err;
    }

    for (const id of parsedQuestionIds) {
      const question = await questionRepository.findQuestionById(id);
      if (!question) {
        const err = new Error(`Question #${id} not found`);
        err.statusCode = 404;
        throw err;
      }
      await this.ensureQuestionSubjectAccess(question, { id: userId, role: userRole });
    }

    const linkedQuestions = await questionRepository.addQuestionsToBank(
      bankId,
      parsedQuestionIds,
      sortOrder
    );

    return { success: true, count: linkedQuestions.length };
  }

  async ensureConceptSubjectAccess(conceptId, user) {
    const concept = await questionRepository.findConceptScope(conceptId);
    if (!concept) {
      const err = new Error("Concept not found");
      err.statusCode = 404;
      throw err;
    }

    await subjectAccessService.requireSubjectAccess(user, concept.chapter?.subjectId);
  }

  async ensureQuestionSubjectAccess(question, user) {
    const subjectId = question?.concept?.chapter?.subjectId || question?.concept?.chapter?.subject?.id;
    await subjectAccessService.requireSubjectAccess(user, subjectId);
  }

  async removeQuestionFromBank(bankId, questionId, userId, userRole) {
    const bank = await questionRepository.findBankById(bankId);
    if (!bank) {
      const err = new Error("Question Bank not found");
      err.statusCode = 404;
      throw err;
    }

    if (userRole !== "ADMIN" && bank.createdById !== userId) {
      const err = new Error("Forbidden: You can only modify your own Question Banks.");
      err.statusCode = 403;
      throw err;
    }

    await questionRepository.removeQuestionFromBank(bankId, questionId);
    return { success: true };
  }

  async removeQuestionsFromBank(bankId, questionIds, userId, userRole) {
    if (!Array.isArray(questionIds) || questionIds.length === 0) {
      const err = new Error("At least one question ID is required.");
      err.statusCode = 400;
      throw err;
    }

    const parsedQuestionIds = [...new Set(questionIds.map((id) => parseInt(id)).filter(Number.isInteger))];
    if (parsedQuestionIds.length === 0) {
      const err = new Error("At least one valid question ID is required.");
      err.statusCode = 400;
      throw err;
    }

    const bank = await questionRepository.findBankById(bankId);
    if (!bank) {
      const err = new Error("Question Bank not found");
      err.statusCode = 404;
      throw err;
    }

    if (userRole !== "ADMIN" && bank.createdById !== userId) {
      const err = new Error("Forbidden: You can only modify your own Question Banks.");
      err.statusCode = 403;
      throw err;
    }

    const result = await questionRepository.removeQuestionsFromBank(bankId, parsedQuestionIds);
    return { success: true, count: result.count };
  }
}

module.exports = new QuestionService();
