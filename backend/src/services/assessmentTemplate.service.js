const assessmentTemplateRepository = require("../repositories/assessmentTemplate.repository");
const testPaperRepository = require("../repositories/testPaper.repository");
const auditService = require("./audit.service");

const VALID_STATUSES = ["ACTIVE", "ARCHIVED"];
const VALID_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const VALID_EXAM_NATURES = ["ON_DEMAND", "PUBLIC_EXAMINATION"];
const VALID_GENERATION_MODES = ["RANDOM", "MANUAL"];

class AssessmentTemplateService {
  async getTemplates(filters, user) {
    const where = this.buildWhere(filters, user);
    return assessmentTemplateRepository.findMany(where);
  }

  async getTemplateById(id, user) {
    const template = await assessmentTemplateRepository.findById(id);
    this.ensureFound(template);
    this.ensureCanAccess(template, user);
    return template;
  }

  async createTemplate(payload, user) {
    this.ensureAdmin(user);
    const data = await this.normalizePayload(payload, user.id);
    const template = await assessmentTemplateRepository.create(data);

    await auditService.log({
      userId: user.id,
      action: "SAVE_TEST_SETTINGS_TEMPLATE",
      entityType: "AssessmentTemplate",
      entityId: template.id,
      newValue: template,
    });

    return template;
  }

  async updateTemplate(id, payload, user) {
    this.ensureAdmin(user);
    const existing = await assessmentTemplateRepository.findById(id);
    this.ensureFound(existing);

    const data = await this.normalizePayload(payload, user.id, existing);
    const updated = await assessmentTemplateRepository.update(id, data);

    await auditService.log({
      userId: user.id,
      action: "SAVE_TEST_SETTINGS_TEMPLATE",
      entityType: "AssessmentTemplate",
      entityId: updated.id,
      oldValue: existing,
      newValue: updated,
    });

    return updated;
  }

  async archiveTemplate(id, user) {
    return this.changeTemplateStatus(id, "ARCHIVED", user);
  }

  async restoreTemplate(id, user) {
    return this.changeTemplateStatus(id, "ACTIVE", user);
  }

  async changeTemplateStatus(id, status, user) {
    this.ensureAdmin(user);
    const existing = await assessmentTemplateRepository.findById(id);
    this.ensureFound(existing);

    const updated = await assessmentTemplateRepository.update(id, { status });

    await auditService.log({
      userId: user.id,
      action: status === "ACTIVE" ? "RESTORE_ASSESSMENT_TEMPLATE" : "ARCHIVE_ASSESSMENT_TEMPLATE",
      entityType: "AssessmentTemplate",
      entityId: updated.id,
      oldValue: { status: existing.status },
      newValue: { status: updated.status },
    });

    return updated;
  }

  buildWhere(filters = {}, user) {
    const andConditions = [];
    const search = String(filters.search || "").trim();
    const requestedStatus = String(filters.status || "").trim().toUpperCase();
    const includeArchived = filters.includeArchived === "true" || filters.includeArchived === true;

    if (requestedStatus) {
      andConditions.push({ status: requestedStatus });
    } else if (!includeArchived) {
      andConditions.push({ status: "ACTIVE" });
    }

    if (user.role !== "ADMIN") {
      andConditions.push({
        OR: [
          { isGlobal: true },
          { createdById: parseInt(user.id) },
        ],
      });
    } else if (filters.createdById) {
      andConditions.push({ createdById: parseInt(filters.createdById) });
    }

    if (search) {
      andConditions.push({
        OR: [
          { name: { contains: search } },
          { description: { contains: search } },
          { classGrade: { contains: search } },
          { subClass: { contains: search } },
          { timingText: { contains: search } },
        ],
      });
    }

    return andConditions.length ? { AND: andConditions } : {};
  }

  async normalizePayload(payload, userId, existing = null) {
    const merged = {
      name: payload.name !== undefined ? payload.name : existing?.name,
      description: payload.description !== undefined ? payload.description : existing?.description,
      isGlobal: payload.isGlobal !== undefined ? payload.isGlobal : existing?.isGlobal,
      status: payload.status !== undefined ? payload.status : existing?.status,
      classGrade: payload.classGrade !== undefined ? payload.classGrade : existing?.classGrade,
      subClass: payload.subClass !== undefined ? payload.subClass : existing?.subClass,
      subjectId: payload.subjectId !== undefined ? payload.subjectId : existing?.subjectId,
      chapterId: payload.chapterId !== undefined ? payload.chapterId : existing?.chapterId,
      conceptId: payload.conceptId !== undefined ? payload.conceptId : existing?.conceptId,
      examNature: payload.examNature !== undefined ? payload.examNature : existing?.examNature,
      timingText: payload.timingText !== undefined ? payload.timingText : existing?.timingText,
      totalMarks: payload.totalMarks !== undefined ? payload.totalMarks : existing?.totalMarks,
      durationMinutes:
        payload.durationMinutes !== undefined ? payload.durationMinutes : existing?.durationMinutes,
      difficultyLevel:
        payload.difficultyLevel !== undefined ? payload.difficultyLevel : existing?.difficultyLevel,
      instructions:
        payload.instructions !== undefined ? payload.instructions : existing?.instructions,
      defaultGenerationMode:
        payload.defaultGenerationMode !== undefined ? payload.defaultGenerationMode : existing?.defaultGenerationMode,
      defaultSetCount:
        payload.defaultSetCount !== undefined ? payload.defaultSetCount : existing?.defaultSetCount,
      defaultDifficultyCounts:
        payload.defaultDifficultyCounts !== undefined
          ? payload.defaultDifficultyCounts
          : existing?.defaultDifficultyCounts,
      defaultMarksByDifficulty:
        payload.defaultMarksByDifficulty !== undefined
          ? payload.defaultMarksByDifficulty
          : existing?.defaultMarksByDifficulty,
      defaultQuestionBankIds:
        payload.defaultQuestionBankIds !== undefined
          ? payload.defaultQuestionBankIds
          : existing?.defaultQuestionBankIds,
      defaultReplaceExistingSets:
        payload.defaultReplaceExistingSets !== undefined
          ? payload.defaultReplaceExistingSets
          : existing?.defaultReplaceExistingSets,
    };

    if (!merged.name || String(merged.name).trim() === "") {
      this.throwValidation("Template name is required");
    }

    const status = String(merged.status || "ACTIVE").trim().toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      this.throwValidation("Invalid template status");
    }

    const subjectId = this.parseOptionalPositiveInt(merged.subjectId, "Invalid subject");
    const chapterId = this.parseOptionalPositiveInt(merged.chapterId, "Invalid chapter");
    const conceptId = this.parseOptionalPositiveInt(merged.conceptId, "Invalid concept");
    const totalMarks = this.parseOptionalPositiveInt(merged.totalMarks, "Total marks must be greater than zero");
    const durationMinutes = this.parseOptionalPositiveInt(
      merged.durationMinutes,
      "Duration must be greater than zero"
    );
    const defaultSetCount = this.parseOptionalBoundedPositiveInt(
      merged.defaultSetCount,
      "Default set count must be greater than zero",
      20
    );
    const difficultyLevel = this.normalizeDifficulty(merged.difficultyLevel);
    const examNature = this.normalizeExamNature(merged.examNature);
    const defaultGenerationMode = this.normalizeGenerationMode(merged.defaultGenerationMode);
    const defaultDifficultyCounts = this.normalizeDifficultyCounts(merged.defaultDifficultyCounts);
    const defaultMarksByDifficulty = this.normalizeMarksByDifficulty(merged.defaultMarksByDifficulty);
    const defaultQuestionBankIds = this.normalizeOptionalIdList(merged.defaultQuestionBankIds);

    await this.validateAcademicScope(subjectId, chapterId, conceptId);

    return {
      name: String(merged.name).trim(),
      description: this.emptyToNull(merged.description),
      isGlobal: merged.isGlobal !== false,
      status,
      classGrade: this.emptyToNull(merged.classGrade),
      subClass: this.emptyToNull(merged.subClass),
      subjectId,
      chapterId,
      conceptId,
      examNature,
      timingText: this.emptyToNull(merged.timingText),
      totalMarks,
      durationMinutes,
      difficultyLevel,
      instructions: this.emptyToNull(merged.instructions),
      defaultGenerationMode,
      defaultSetCount,
      defaultDifficultyCounts,
      defaultMarksByDifficulty,
      defaultQuestionBankIds,
      defaultReplaceExistingSets: merged.defaultReplaceExistingSets !== false,
      createdById: existing ? undefined : parseInt(userId),
    };
  }

  async validateAcademicScope(subjectId, chapterId, conceptId) {
    if (!subjectId && (chapterId || conceptId)) {
      this.throwValidation("Subject is required when a chapter or concept is selected");
    }

    if (!subjectId) return;

    const subject = await testPaperRepository.findSubjectById(subjectId);
    if (!subject) {
      this.throwNotFound("Subject not found");
    }

    if (chapterId) {
      const chapter = await testPaperRepository.findChapterById(chapterId);
      if (!chapter || chapter.subjectId !== subjectId) {
        this.throwValidation("Selected chapter does not belong to the selected subject");
      }
    }

    if (conceptId) {
      const concept = await testPaperRepository.findConceptById(conceptId);
      if (!concept) {
        this.throwNotFound("Concept not found");
      }

      if (chapterId && concept.chapterId !== chapterId) {
        this.throwValidation("Selected concept does not belong to the selected chapter");
      }

      if (!chapterId && concept.chapter.subjectId !== subjectId) {
        this.throwValidation("Selected concept does not belong to the selected subject");
      }
    }
  }

  normalizeDifficultyCounts(input) {
    if (input === undefined || input === null || input === "") return null;

    const counts = {};
    for (const difficulty of VALID_DIFFICULTIES) {
      counts[difficulty] = this.parseNonNegativeInt(input[difficulty], `${difficulty} count is invalid`);
    }
    return counts;
  }

  normalizeMarksByDifficulty(input) {
    if (input === undefined || input === null || input === "") return null;

    const marks = {};
    for (const difficulty of VALID_DIFFICULTIES) {
      marks[difficulty] = this.parseRequiredPositiveInt(
        input[difficulty] || 1,
        `${difficulty} marks must be greater than zero`
      );
    }
    return marks;
  }

  normalizeOptionalIdList(value) {
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }

    const parsed = [...new Set(value.map((id) => parseInt(id)).filter((id) => Number.isInteger(id) && id > 0))];
    return parsed.length ? parsed : null;
  }

  normalizeDifficulty(value) {
    if (value === undefined || value === null || value === "") return null;
    const normalized = String(value).trim().toUpperCase();
    if (!VALID_DIFFICULTIES.includes(normalized)) {
      this.throwValidation("Invalid difficulty level");
    }
    return normalized;
  }

  normalizeExamNature(value) {
    if (value === undefined || value === null || value === "") return null;
    const normalized = String(value).trim().toUpperCase();
    if (!VALID_EXAM_NATURES.includes(normalized)) {
      this.throwValidation("Exam nature must be On Demand or Public Examinations");
    }
    return normalized;
  }

  normalizeGenerationMode(value) {
    if (value === undefined || value === null || value === "") return null;
    const normalized = String(value).trim().toUpperCase();
    if (!VALID_GENERATION_MODES.includes(normalized)) {
      this.throwValidation("Generation mode must be RANDOM or MANUAL");
    }
    return normalized;
  }

  ensureCanAccess(template, user) {
    if (user.role === "ADMIN") return;
    if (template.status === "ACTIVE" && (template.isGlobal || template.createdById === parseInt(user.id))) return;

    const err = new Error("Forbidden: You cannot access this assessment template.");
    err.statusCode = 403;
    throw err;
  }

  ensureAdmin(user) {
    if (user.role === "ADMIN") return;

    const err = new Error("Only admins can manage assessment templates.");
    err.statusCode = 403;
    throw err;
  }

  parseRequiredPositiveInt(value, message) {
    const parsed = parseInt(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      this.throwValidation(message);
    }
    return parsed;
  }

  parseOptionalPositiveInt(value, message) {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    return this.parseRequiredPositiveInt(value, message);
  }

  parseOptionalBoundedPositiveInt(value, message, max) {
    const parsed = this.parseOptionalPositiveInt(value, message);
    if (parsed && parsed > max) {
      this.throwValidation(`Maximum allowed value is ${max}`);
    }
    return parsed;
  }

  parseNonNegativeInt(value, message) {
    if (value === undefined || value === null || value === "") {
      return 0;
    }

    const parsed = parseInt(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      this.throwValidation(message);
    }
    return parsed;
  }

  emptyToNull(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
  }

  ensureFound(template) {
    if (!template) {
      this.throwNotFound("Assessment template not found");
    }
  }

  throwValidation(message) {
    const err = new Error(message);
    err.statusCode = 400;
    throw err;
  }

  throwNotFound(message) {
    const err = new Error(message);
    err.statusCode = 404;
    throw err;
  }
}

module.exports = new AssessmentTemplateService();
