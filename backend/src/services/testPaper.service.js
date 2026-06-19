const testPaperRepository = require("../repositories/testPaper.repository");
const assessmentTemplateRepository = require("../repositories/assessmentTemplate.repository");
const auditService = require("./audit.service");
const subjectAccessService = require("./subjectAccess.service");
const sectionNormalizerService = require("./sectionNormalizer.service");
const { parsePagination } = require("../utils/pagination");

const VALID_STATUSES = ["DRAFT", "SAVED", "QUESTIONS_GENERATED", "POSTED", "ARCHIVED"];
const VALID_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const VALID_GENERATION_MODES = ["RANDOM", "MANUAL", "SECTION_BLUEPRINT"];
const VALID_EXAM_NATURES = ["ON_DEMAND", "PUBLIC_EXAMINATION"];
const LEGACY_STATUS_MAP = {
  PUBLISHED: "POSTED",
};
const POSTED_LOCKED_FIELDS = [
  "title",
  "description",
  "subjectId",
  "chapterId",
  "conceptId",
  "templateId",
  "classGrade",
  "subClass",
  "examNature",
  "examDate",
  "codeNo",
  "timingText",
  "totalMarks",
  "durationMinutes",
  "difficultyLevel",
  "instructions",
  "defaultGenerationMode",
  "defaultSetCount",
  "defaultDifficultyCounts",
  "defaultMarksByDifficulty",
  "defaultQuestionBankIds",
  "defaultReplaceExistingSets",
];

class TestPaperService {
  async getTestPapers(filters, user) {
    const where = await this.buildWhere(filters, user);
    return testPaperRepository.findMany(where, parsePagination(filters));
  }

  async getTestPaperById(id, user) {
    const paper = await testPaperRepository.findById(id);
    this.ensureFound(paper);
    await this.ensureCanAccess(paper, user);
    return paper;
  }

  async getAssessmentSummary(id, user) {
    const paper = await testPaperRepository.findById(id);
    this.ensureFound(paper);
    await this.ensureCanAccess(paper, user);

    const bankIds = this.collectLinkedBankIds(paper);
    const [linkedBanks, statusHistory] = await Promise.all([
      testPaperRepository.findQuestionBanksByIds(bankIds),
      testPaperRepository.findAuditLogsForTestPaper(paper.id),
    ]);

    return {
      id: paper.id,
      title: paper.title,
      metadata: {
        classGrade: paper.classGrade,
        subClass: paper.subClass,
        subject: paper.subject?.name || null,
        chapter: paper.chapter?.name || null,
        concept: paper.concept?.name || null,
        examNature: paper.examNature,
        examDate: paper.examDate,
        codeNo: paper.codeNo,
        timingText: paper.timingText,
        durationMinutes: paper.durationMinutes,
        totalMarks: paper.totalMarks,
        difficultyLevel: paper.difficultyLevel,
        template: paper.template || null,
      },
      linkedBanks,
      generatedSets: (paper.sets || []).map((set) => ({
        id: set.id,
        label: set.label,
        generationMode: set.generationMode,
        questionCount: set.questionCount,
        totalMarks: set.totalMarks,
        easyCount: set.easyCount,
        mediumCount: set.mediumCount,
        hardCount: set.hardCount,
        sourceBankIds: set.sourceBankIds || [],
        createdAt: set.createdAt,
        updatedAt: set.updatedAt,
      })),
      status: {
        current: paper.status,
        questionCount: this.questionCountFromSets(paper),
        generatedSetCount: paper.sets?.length || 0,
        posted: paper.status === "POSTED",
      },
      statusHistory: statusHistory.map((log) => ({
        id: log.id,
        action: log.action,
        user: log.user,
        oldValue: log.oldValue,
        newValue: log.newValue,
        createdAt: log.createdAt,
      })),
    };
  }

  async getAssessmentMarks(id, user) {
    const paper = await testPaperRepository.findById(id);
    this.ensureFound(paper);
    await this.ensureCanAccess(paper, user);

    const rows = this.generatedQuestionRows(paper);
    const byDifficulty = this.groupMarks(rows, (row) => row.difficulty || "MEDIUM");
    const byQuestionType = this.groupMarks(rows, (row) => row.questionType || "Unspecified");
    const bySection = this.groupMarks(rows, (row) => row.section || "Unsectioned");

    return {
      id: paper.id,
      title: paper.title,
      totalMarks: rows.reduce((sum, row) => sum + row.marks, 0),
      questionCount: rows.length,
      distributions: {
        byDifficulty,
        byQuestionType,
        bySection,
      },
    };
  }

  async getBlueprint(id, user) {
    const paper = await testPaperRepository.findById(id);
    this.ensureFound(paper);
    await this.ensureCanAccess(paper, user);

    return {
      testPaperId: paper.id,
      title: paper.title,
      subjectId: paper.subjectId,
      sections: this.blueprintSectionsForResponse(paper.blueprintSections),
    };
  }

  async updateBlueprint(id, payload = {}, user) {
    const paper = await testPaperRepository.findById(id);
    this.ensureFound(paper);
    await this.ensureCanModify(paper, user);
    this.ensurePostedAssessmentUnlocked(paper);

    const sections = this.normalizeBlueprintSections(payload.sections || payload.blueprintSections || []);
    const updated = await testPaperRepository.replaceBlueprintSections(id, sections);

    await auditService.log({
      userId: user.id,
      action: "SAVE_ASSESSMENT_BLUEPRINT",
      entityType: "TestPaper",
      entityId: paper.id,
      oldValue: this.blueprintSectionsForResponse(paper.blueprintSections),
      newValue: this.blueprintSectionsForResponse(updated.blueprintSections),
    });

    return {
      testPaperId: updated.id,
      title: updated.title,
      sections: this.blueprintSectionsForResponse(updated.blueprintSections),
    };
  }

  async validateBlueprintGeneration(id, payload = {}, user) {
    const paper = await testPaperRepository.findById(id);
    this.ensureFound(paper);
    await this.ensureCanAccess(paper, user);

    const questionBankIds = this.resolveBlueprintBankIds(paper, payload.questionBankIds);
    const setCount = this.parseOptionalBoundedPositiveInt(
      payload.setCount || 1,
      "Set count must be greater than zero",
      20
    ) || 1;
    const candidateQuestions = await this.loadGenerationQuestionPool(questionBankIds, user);
    const diagnostics = this.buildSectionBlueprintDiagnostics(paper, candidateQuestions, questionBankIds, setCount);

    return {
      testPaperId: paper.id,
      title: paper.title,
      questionBankIds,
      setCount,
      ...diagnostics,
    };
  }

  async applyBlueprintSectionMapping(id, payload = {}, user) {
    const paper = await testPaperRepository.findById(id);
    this.ensureFound(paper);
    await this.ensureCanModify(paper, user);

    const sections = this.blueprintSectionsForGeneration(paper.blueprintSections);
    if (sections.length === 0) {
      this.throwValidation("Add blueprint sections before applying section mapping.");
    }
    const missingRanges = sections.filter((section) => !section.startsAtQuestion || !section.endsAtQuestion);
    if (missingRanges.length > 0) {
      this.throwValidation("Every section needs start and end question numbers before mapping.");
    }

    const questionBankIds = this.resolveBlueprintBankIds(paper, payload.questionBankIds);
    const pool = await this.loadGenerationQuestionPool(questionBankIds, user);
    const mappings = [];
    const unmatched = [];

    for (const question of pool) {
      const sourceQuestionNo = this.parseQuestionNumberForSectionMapping(question);
      if (!sourceQuestionNo) {
        unmatched.push({
          questionId: question.id,
          reason: "NO_SOURCE_QUESTION_NUMBER",
        });
        continue;
      }

      const section = sections.find((candidate) =>
        sourceQuestionNo >= candidate.startsAtQuestion && sourceQuestionNo <= candidate.endsAtQuestion
      );
      if (!section) {
        unmatched.push({
          questionId: question.id,
          sourceQuestionNo,
          reason: "OUTSIDE_BLUEPRINT_RANGE",
        });
        continue;
      }

      mappings.push({
        questionId: question.id,
        sectionName: section.sectionName,
        sectionOrder: section.sectionOrder,
        sectionConfidence: "HIGH",
        sectionEvidence: {
          source: "ASSESSMENT_BLUEPRINT_RANGE",
          testPaperId: paper.id,
          sourceBankId: question.sourceBankId,
          sourceQuestionNo,
          range: {
            startsAtQuestion: section.startsAtQuestion,
            endsAtQuestion: section.endsAtQuestion,
          },
        },
      });
    }

    if (mappings.length === 0) {
      this.throwValidation("No selected bank questions matched the blueprint ranges.");
    }

    const updatedQuestions = await testPaperRepository.updateQuestionSectionMappings(mappings);
    const updatedPool = await this.loadGenerationQuestionPool(questionBankIds, user);
    const setCount = this.parseOptionalBoundedPositiveInt(
      payload.setCount || 1,
      "Set count must be greater than zero",
      20
    ) || 1;
    const diagnostics = this.buildSectionBlueprintDiagnostics(paper, updatedPool, questionBankIds, setCount);

    await auditService.log({
      userId: user.id,
      action: "APPLY_BLUEPRINT_SECTION_MAPPING",
      entityType: "TestPaper",
      entityId: paper.id,
      newValue: {
        questionBankIds,
        updatedCount: updatedQuestions.length,
        unmatchedCount: unmatched.length,
        sections: sections.map((section) => ({
          sectionName: section.sectionName,
          startsAtQuestion: section.startsAtQuestion,
          endsAtQuestion: section.endsAtQuestion,
        })),
      },
    });

    return {
      testPaperId: paper.id,
      title: paper.title,
      questionBankIds,
      updatedCount: updatedQuestions.length,
      unmatchedCount: unmatched.length,
      unmatched: unmatched.slice(0, 25),
      validation: {
        testPaperId: paper.id,
        title: paper.title,
        questionBankIds,
        setCount,
        ...diagnostics,
      },
    };
  }

  async createTestPaper(payload, user) {
    const data = await this.normalizePayload(payload, user);
    const paper = await testPaperRepository.create(data);

    await auditService.log({
      userId: user.id,
      action: "SAVE_TEST_PAPER",
      entityType: "TestPaper",
      entityId: paper.id,
      newValue: paper,
    });

    return paper;
  }

  async updateTestPaper(id, payload, user) {
    const existing = await testPaperRepository.findById(id);
    this.ensureFound(existing);
    await this.ensureCanModify(existing, user);

    const data = await this.normalizePayload(payload, user, existing);
    this.ensurePostedSettingsChangeAllowed(existing, data, payload.confirmPostedChanges === true);

    const updated = await testPaperRepository.update(id, data);

    await auditService.log({
      userId: user.id,
      action: "SAVE_TEST_PAPER",
      entityType: "TestPaper",
      entityId: updated.id,
      oldValue: existing,
      newValue: updated,
    });

    return updated;
  }

  async updateTestPaperStatus(id, status, user) {
    const existing = await testPaperRepository.findById(id);
    this.ensureFound(existing);
    await this.ensureCanModify(existing, user);

    const normalizedStatus = this.normalizeStatus(status);
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      this.throwValidation("Invalid test paper status");
    }

    const existingStatus = this.normalizeStatus(existing.status);
    if (existingStatus === "POSTED" && normalizedStatus !== "POSTED") {
      this.throwValidation("Posted assessments cannot be moved back to an earlier lifecycle state.");
    }

    if (normalizedStatus === "POSTED") {
      this.ensureReadyToPost(existing);
    }

    const updated = await testPaperRepository.update(id, { status: normalizedStatus });

    await auditService.log({
      userId: user.id,
      action: normalizedStatus === "POSTED" ? "POST_TEST_PAPER" : "CHANGE_TEST_PAPER_STATUS",
      entityType: "TestPaper",
      entityId: updated.id,
      oldValue: { status: existingStatus },
      newValue: { status: updated.status },
    });

    return updated;
  }

  async deleteTestPaper(id, user) {
    const existing = await testPaperRepository.findById(id);
    this.ensureFound(existing);
    await this.ensureCanModify(existing, user);

    await testPaperRepository.delete(id);

    await auditService.log({
      userId: user.id,
      action: "DELETE_TEST_PAPER",
      entityType: "TestPaper",
      entityId: existing.id,
      oldValue: existing,
    });

    return { success: true };
  }

  async generateQuestionPaperSets(testPaperId, payload, user) {
    const paper = await testPaperRepository.findById(testPaperId);
    this.ensureFound(paper);
    await this.ensureCanModify(paper, user);
    this.ensureCanGenerateQuestions(paper);

    const mode = String(payload.mode || "RANDOM").trim().toUpperCase();
    if (!VALID_GENERATION_MODES.includes(mode)) {
      this.throwValidation("Generation mode must be RANDOM, MANUAL, or SECTION_BLUEPRINT");
    }

    const setCount = this.parseBoundedPositiveInt(payload.setCount || 1, "Set count is required", 20);
    const questionBankIds = mode === "SECTION_BLUEPRINT"
      ? this.resolveBlueprintBankIds(paper, payload.questionBankIds)
      : this.normalizeIdList(payload.questionBankIds, "Select at least one question bank");
    const difficultyCounts = this.normalizeDifficultyCounts(payload.difficultyCounts);
    const marksByDifficulty = this.normalizeMarksByDifficulty(payload.marksByDifficulty);
    const replaceExisting = payload.replaceExisting !== false;

    const candidateQuestions = await this.loadGenerationQuestionPool(questionBankIds, user);
    let pool = candidateQuestions;

    if (mode === "MANUAL") {
      const selectedQuestionIds = this.normalizeIdList(
        payload.selectedQuestionIds,
        "Select at least one manual question"
      );
      const selectedIdSet = new Set(selectedQuestionIds);
      pool = candidateQuestions.filter((question) => selectedIdSet.has(question.id));

      if (pool.length !== selectedQuestionIds.length) {
        this.throwValidation("Manual selection contains questions that are not in the selected banks");
      }
    }

    const setsData = mode === "SECTION_BLUEPRINT"
      ? this.buildSectionBlueprintSets({
          paper,
          setCount,
          questionBankIds,
          pool,
        })
      : this.buildGeneratedSets({
          mode,
          setCount,
          questionBankIds,
          pool,
          difficultyCounts,
          marksByDifficulty,
        });

    if (!replaceExisting) {
      this.ensureNoDuplicateSetLabels(paper, setsData);
    }

    let updatedPaper = await testPaperRepository.replaceGeneratedSets(
      testPaperId,
      setsData,
      replaceExisting
    );
    const previousStatus = this.normalizeStatus(paper.status);

    if (previousStatus !== "QUESTIONS_GENERATED") {
      updatedPaper = await testPaperRepository.update(testPaperId, { status: "QUESTIONS_GENERATED" });
    }

    await auditService.log({
      userId: user.id,
      action: "GENERATE_TEST_PAPER_QUESTIONS",
      entityType: "TestPaper",
      entityId: paper.id,
      oldValue: {
        existingSetCount: paper.sets?.length || 0,
        status: previousStatus,
      },
      newValue: {
        mode,
        setCount,
        questionBankIds,
        difficultyCounts,
        marksByDifficulty,
        replaceExisting,
        status: updatedPaper.status,
      },
    });

    return updatedPaper;
  }

  async deleteTestPaperSet(testPaperId, setId, user) {
    const set = await testPaperRepository.findSetById(setId);
    if (!set || set.testPaperId !== parseInt(testPaperId)) {
      this.throwNotFound("Question paper set not found");
    }

    await this.ensureCanModify(set.testPaper, user);
    this.ensurePostedAssessmentUnlocked(set.testPaper);

    await testPaperRepository.deleteSet(setId);

    await auditService.log({
      userId: user.id,
      action: "DELETE_TEST_PAPER_SET",
      entityType: "TestPaperSet",
      entityId: set.id,
      oldValue: set,
    });

    return { success: true };
  }

  async loadGenerationQuestionPool(questionBankIds, user) {
    const assignedSubjectIds = await subjectAccessService.getAssignedSubjectIds(user);
    const banks = await testPaperRepository.findAccessibleQuestionBanksWithQuestions(
      questionBankIds,
      user,
      assignedSubjectIds
    );
    if (banks.length !== questionBankIds.length) {
      this.throwValidation("One or more selected question banks are unavailable for this user");
    }

    return this.flattenBankQuestions(banks);
  }

  buildSectionBlueprintSets({ paper, setCount, questionBankIds, pool }) {
    const diagnostics = this.buildSectionBlueprintDiagnostics(paper, pool, questionBankIds, setCount);
    if (!diagnostics.valid) {
      const firstError = diagnostics.issues.find((issue) => issue.severity === "error");
      this.throwValidation(firstError?.message || "Section blueprint is not ready for generation");
    }

    const sections = this.blueprintSectionsForGeneration(paper.blueprintSections);
    const usedQuestionIds = new Set();
    const sets = [];

    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      const selectedForSet = [];

      for (const section of sections) {
        const targetCount = section.requiredCount + section.optionalCount;
        if (targetCount <= 0) continue;

        const availableGroups = this.sectionCandidateGroups(section, pool, questionBankIds)
          .filter((group) => group.questions.every((question) => !usedQuestionIds.has(question.id)));
        const orderedGroups = this.shuffle(availableGroups);
        const selectedGroups = [];
        let selectedCount = 0;

        for (const group of orderedGroups) {
          if (selectedCount >= targetCount) break;
          selectedGroups.push(group);
          selectedCount += group.questions.length;
        }

        if (selectedCount < targetCount) {
          this.throwValidation(
            `Not enough verified questions in ${section.sectionName} for ${setCount} duplicate-free set(s).`
          );
        }

        let sectionDisplayOrder = 0;
        let sectionQuestionCount = 0;
        for (const group of selectedGroups) {
          const groupStartsOptional = sectionQuestionCount >= section.requiredCount;
          for (const question of group.questions) {
            sectionDisplayOrder += 1;
            sectionQuestionCount += 1;
            usedQuestionIds.add(question.id);
            selectedForSet.push({
              questionId: question.id,
              difficulty: question.difficulty || "MEDIUM",
              marks: section.marksPerQuestion || question.marks || 1,
              sectionName: section.sectionName,
              sectionOrder: section.sectionOrder,
              sectionDisplayOrder,
              sourceQuestionNo: question.sourceQuestionNo || question.questionNo || null,
              isOptional: groupStartsOptional || sectionQuestionCount > section.requiredCount,
              choiceGroupKey: question.choiceGroupKey || null,
              generationSnapshot: {
                mode: "SECTION_BLUEPRINT",
                sectionName: section.sectionName,
                sectionOrder: section.sectionOrder,
                sectionDisplayOrder,
                sourceQuestionNo: question.sourceQuestionNo || question.questionNo || null,
                sourceBankId: question.sourceBankId,
                sourceBankName: question.sourceBankName,
                sourceFileId: question.sourceFileId || null,
                sourceFileName: question.sourceFileName || question.sourceFile?.fileName || null,
                sectionConfidence: question.sectionConfidence || null,
                generatedAt: new Date().toISOString(),
              },
            });
          }
        }
      }

      const finalOrder = selectedForSet
        .sort((left, right) =>
          (left.sectionOrder || 0) - (right.sectionOrder || 0) ||
          (left.sectionDisplayOrder || 0) - (right.sectionDisplayOrder || 0)
        )
        .map((question, index) => ({
          ...question,
          displayOrder: index + 1,
        }));
      const difficultySummary = this.summarizeDifficulties(finalOrder);

      sets.push({
        label: this.labelForSet(setIndex),
        generationMode: "SECTION_BLUEPRINT",
        sourceBankIds: questionBankIds,
        questionCount: finalOrder.length,
        totalMarks: finalOrder.reduce((sum, question) => sum + question.marks, 0),
        easyCount: difficultySummary.EASY,
        mediumCount: difficultySummary.MEDIUM,
        hardCount: difficultySummary.HARD,
        questions: finalOrder,
      });
    }

    return sets;
  }

  buildSectionBlueprintDiagnostics(paper, pool, questionBankIds, setCount = 1) {
    const sections = this.blueprintSectionsForGeneration(paper.blueprintSections);
    const issues = [];

    if (sections.length === 0) {
      issues.push({
        severity: "error",
        code: "MISSING_BLUEPRINT",
        message: "Add at least one blueprint section before section-wise generation.",
      });
    }

    const sectionSummaries = sections.map((section) => {
      const groups = this.sectionCandidateGroups(section, pool, questionBankIds);
      const availableQuestionCount = groups.reduce((sum, group) => sum + group.questions.length, 0);
      const requiredQuestionCount = section.requiredCount + section.optionalCount;
      const duplicateFreeRequiredCount = requiredQuestionCount * setCount;

      if (requiredQuestionCount <= 0) {
        issues.push({
          severity: "warning",
          code: "EMPTY_SECTION_TARGET",
          sectionName: section.sectionName,
          message: `${section.sectionName} has no required or optional questions configured.`,
        });
      }

      if (availableQuestionCount < duplicateFreeRequiredCount) {
        issues.push({
          severity: "error",
          code: "INSUFFICIENT_SECTION_POOL",
          sectionName: section.sectionName,
          message: `${section.sectionName} needs ${duplicateFreeRequiredCount} verified question(s) for ${setCount} set(s), but only ${availableQuestionCount} are available.`,
        });
      }

      return {
        id: section.id,
        sectionName: section.sectionName,
        sectionOrder: section.sectionOrder,
        requiredCount: section.requiredCount,
        optionalCount: section.optionalCount,
        requiredQuestionCount,
        duplicateFreeRequiredCount,
        availableQuestionCount,
        candidateGroupCount: groups.length,
        marksPerQuestion: section.marksPerQuestion,
        questionType: section.questionType,
        sourceBankIds: section.sourceBankIds?.length ? section.sourceBankIds : questionBankIds,
        status: availableQuestionCount >= duplicateFreeRequiredCount ? "READY" : "NEEDS_ATTENTION",
      };
    });

    return {
      valid: !issues.some((issue) => issue.severity === "error"),
      issues,
      sections: sectionSummaries,
      totalRequiredQuestions: sectionSummaries.reduce((sum, section) => sum + section.requiredQuestionCount, 0),
      totalAvailableQuestions: sectionSummaries.reduce((sum, section) => sum + section.availableQuestionCount, 0),
    };
  }

  sectionCandidateGroups(section, pool, fallbackBankIds = []) {
    const targetSectionKey = sectionNormalizerService.sectionKey(section.sectionName);
    const scopedBankIds = section.sourceBankIds?.length ? section.sourceBankIds : fallbackBankIds;
    const scopedBankIdSet = new Set(scopedBankIds.map((id) => parseInt(id)).filter(Number.isInteger));
    const questionType = String(section.questionType || "").trim().toLowerCase();
    const byGroup = new Map();

    for (const question of pool) {
      if (scopedBankIdSet.size > 0 && !scopedBankIdSet.has(parseInt(question.sourceBankId))) continue;
      if (sectionNormalizerService.sectionKey(question.sectionName) !== targetSectionKey) continue;
      if (!sectionNormalizerService.confidenceAtLeast(question.sectionConfidence, "HIGH")) continue;
      if (section.marksPerQuestion && question.marks && parseInt(question.marks) !== section.marksPerQuestion) continue;
      if (questionType) {
        const candidateType = String(question.questionTypeLabel || question.type || "").trim().toLowerCase();
        if (!candidateType.includes(questionType) && !questionType.includes(candidateType)) continue;
      }

      const groupKey = question.choiceGroupKey || `QUESTION-${question.id}`;
      const current = byGroup.get(groupKey) || {
        groupKey,
        questions: [],
      };
      current.questions.push(question);
      byGroup.set(groupKey, current);
    }

    return Array.from(byGroup.values()).map((group) => ({
      ...group,
      questions: group.questions.sort((left, right) =>
        (left.sectionOrder || 0) - (right.sectionOrder || 0) ||
        (parseInt(left.sourceQuestionNo || left.questionNo) || left.bankSortOrder || left.id) -
          (parseInt(right.sourceQuestionNo || right.questionNo) || right.bankSortOrder || right.id)
      ),
    }));
  }

  blueprintSectionsForResponse(sections = []) {
    return this.blueprintSectionsForGeneration(sections).map((section) => ({
      id: section.id,
      sectionName: section.sectionName,
      sectionOrder: section.sectionOrder,
      startsAtQuestion: section.startsAtQuestion,
      endsAtQuestion: section.endsAtQuestion,
      requiredCount: section.requiredCount,
      optionalCount: section.optionalCount,
      marksPerQuestion: section.marksPerQuestion,
      questionType: section.questionType,
      difficultyMix: section.difficultyMix,
      objectiveMix: section.objectiveMix,
      subpartRule: section.subpartRule,
      sourceBankIds: section.sourceBankIds,
      validationStatus: section.validationStatus,
    }));
  }

  blueprintSectionsForGeneration(sections = []) {
    return (sections || [])
      .map((section, index) => ({
        id: section.id,
        sectionName: String(section.sectionName || `Section ${index + 1}`).trim(),
        sectionOrder: parseInt(section.sectionOrder) || index + 1,
        startsAtQuestion: section.startsAtQuestion ?? null,
        endsAtQuestion: section.endsAtQuestion ?? null,
        requiredCount: parseInt(section.requiredCount) || 0,
        optionalCount: parseInt(section.optionalCount) || 0,
        marksPerQuestion: section.marksPerQuestion ? parseInt(section.marksPerQuestion) : null,
        questionType: section.questionType || null,
        difficultyMix: section.difficultyMix || null,
        objectiveMix: section.objectiveMix || null,
        subpartRule: section.subpartRule || null,
        sourceBankIds: this.normalizeOptionalIdList(section.sourceBankIds) || [],
        validationStatus: section.validationStatus || "DRAFT",
      }))
      .sort((left, right) => left.sectionOrder - right.sectionOrder);
  }

  normalizeBlueprintSections(input) {
    if (!Array.isArray(input)) {
      this.throwValidation("Blueprint sections must be provided as a list.");
    }

    const seenOrders = new Set();
    const seenNames = new Set();

    return input.map((section, index) => {
      const sectionName = this.emptyToNull(section.sectionName || section.name);
      if (!sectionName) {
        this.throwValidation(`Section ${index + 1} needs a name.`);
      }

      const sectionOrder = this.parseRequiredPositiveInt(
        section.sectionOrder || index + 1,
        `${sectionName} needs a valid order.`
      );
      const sectionKey = sectionNormalizerService.sectionKey(sectionName);
      if (seenOrders.has(sectionOrder)) {
        this.throwValidation(`Section order ${sectionOrder} is already used.`);
      }
      if (seenNames.has(sectionKey)) {
        this.throwValidation(`${sectionName} is already used in this blueprint.`);
      }
      seenOrders.add(sectionOrder);
      seenNames.add(sectionKey);

      const requiredCount = this.parseNonNegativeInt(
        section.requiredCount,
        `${sectionName} required count is invalid.`
      );
      const optionalCount = this.parseNonNegativeInt(
        section.optionalCount,
        `${sectionName} optional count is invalid.`
      );
      const marksPerQuestion = this.parseOptionalPositiveInt(
        section.marksPerQuestion,
        `${sectionName} marks per question is invalid.`
      );
      const startsAtQuestion = this.parseOptionalPositiveInt(
        section.startsAtQuestion,
        `${sectionName} start question is invalid.`
      );
      const endsAtQuestion = this.parseOptionalPositiveInt(
        section.endsAtQuestion,
        `${sectionName} end question is invalid.`
      );

      if (startsAtQuestion && endsAtQuestion && startsAtQuestion > endsAtQuestion) {
        this.throwValidation(`${sectionName} start question must be before the end question.`);
      }

      return {
        sectionName,
        sectionOrder,
        startsAtQuestion,
        endsAtQuestion,
        requiredCount,
        optionalCount,
        marksPerQuestion,
        questionType: this.emptyToNull(section.questionType),
        difficultyMix: this.normalizeOptionalJsonObject(section.difficultyMix),
        objectiveMix: this.normalizeOptionalJsonObject(section.objectiveMix),
        subpartRule: this.normalizeOptionalJsonObject(section.subpartRule),
        sourceBankIds: this.normalizeOptionalIdList(section.sourceBankIds),
        validationStatus: this.emptyToNull(section.validationStatus) || "DRAFT",
      };
    });
  }

  normalizeOptionalJsonObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value;
  }

  resolveBlueprintBankIds(paper, payloadBankIds) {
    if (Array.isArray(payloadBankIds) && payloadBankIds.length > 0) {
      return this.normalizeIdList(payloadBankIds, "Select at least one question bank");
    }

    const sectionBankIds = new Set();
    for (const section of paper.blueprintSections || []) {
      this.normalizeJsonIdArray(section.sourceBankIds).forEach((id) => sectionBankIds.add(id));
    }
    if (sectionBankIds.size > 0) return Array.from(sectionBankIds);

    const defaultIds = this.normalizeJsonIdArray(paper.defaultQuestionBankIds);
    if (defaultIds.length > 0) return defaultIds;

    this.throwValidation("Select at least one question bank for section-wise generation.");
  }

  ensureNoDuplicateSetLabels(paper, setsData) {
    const existingLabels = new Set((paper.sets || []).map((set) => String(set.label).toUpperCase()));
    const duplicate = setsData.find((set) => existingLabels.has(String(set.label).toUpperCase()));
    if (duplicate) {
      this.throwValidation(`Set ${duplicate.label} already exists. Replace existing sets or choose a fresh assessment.`);
    }
  }

  buildGeneratedSets({ mode, setCount, questionBankIds, pool, difficultyCounts, marksByDifficulty }) {
    const totalQuestionsPerSet = VALID_DIFFICULTIES.reduce(
      (sum, difficulty) => sum + difficultyCounts[difficulty],
      0
    );

    if (totalQuestionsPerSet <= 0) {
      this.throwValidation("At least one question is required per set");
    }

    const questionsByDifficulty = VALID_DIFFICULTIES.reduce((acc, difficulty) => {
      acc[difficulty] = pool.filter((question) => question.difficulty === difficulty);
      return acc;
    }, {});

    const usedQuestionIds = new Set();
    const sets = [];

    for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
      const selectedForSet = [];

      for (const difficulty of VALID_DIFFICULTIES) {
        const requiredCount = difficultyCounts[difficulty];
        if (requiredCount === 0) continue;

        const available = questionsByDifficulty[difficulty].filter(
          (question) => !usedQuestionIds.has(question.id)
        );
        const ordered = mode === "RANDOM" ? this.shuffle(available) : available;

        if (ordered.length < requiredCount) {
          this.throwValidation(
            `Not enough ${difficulty.toLowerCase()} questions to generate ${setCount} duplicate-free set(s)`
          );
        }

        const selected = ordered.slice(0, requiredCount);
        for (const question of selected) {
          usedQuestionIds.add(question.id);
          selectedForSet.push({
            questionId: question.id,
            difficulty,
            marks: marksByDifficulty[difficulty],
          });
        }
      }

      const finalOrder = mode === "RANDOM" ? this.shuffle(selectedForSet) : selectedForSet;
      const difficultySummary = this.summarizeDifficulties(finalOrder);

      sets.push({
        label: this.labelForSet(setIndex),
        generationMode: mode,
        sourceBankIds: questionBankIds,
        questionCount: finalOrder.length,
        totalMarks: finalOrder.reduce((sum, question) => sum + question.marks, 0),
        easyCount: difficultySummary.EASY,
        mediumCount: difficultySummary.MEDIUM,
        hardCount: difficultySummary.HARD,
        questions: finalOrder.map((question, index) => ({
          questionId: question.questionId,
          marks: question.marks,
          displayOrder: index + 1,
        })),
      });
    }

    return sets;
  }

  collectLinkedBankIds(paper) {
    const ids = new Set();

    this.normalizeJsonIdArray(paper.defaultQuestionBankIds).forEach((id) => ids.add(id));
    for (const set of paper.sets || []) {
      this.normalizeJsonIdArray(set.sourceBankIds).forEach((id) => ids.add(id));
    }

    return Array.from(ids);
  }

  normalizeJsonIdArray(value) {
    if (!Array.isArray(value)) return [];
    return value.map((id) => parseInt(id)).filter((id) => Number.isInteger(id) && id > 0);
  }

  questionCountFromSets(paper) {
    return (paper.sets || []).reduce((sum, set) => sum + (set.questionCount || set.questions?.length || 0), 0);
  }

  generatedQuestionRows(paper) {
    const rows = [];

    for (const set of paper.sets || []) {
      for (const link of set.questions || []) {
        const question = link.question || {};
        rows.push({
          setId: set.id,
          setLabel: set.label,
          questionId: question.id,
          marks: parseInt(link.marks) || 0,
          difficulty: question.difficulty || "MEDIUM",
          questionType: question.questionTypeLabel || question.type || "Unspecified",
          section:
            link.sectionName ||
            question.sectionName ||
            question.questionHeader ||
            question.concept?.name ||
            question.concept?.chapter?.name ||
            "Unsectioned",
        });
      }
    }

    return rows;
  }

  groupMarks(rows, keyFactory) {
    const groups = new Map();

    for (const row of rows) {
      const key = keyFactory(row);
      const current = groups.get(key) || {
        label: key,
        questionCount: 0,
        marks: 0,
      };
      current.questionCount += 1;
      current.marks += row.marks;
      groups.set(key, current);
    }

    return Array.from(groups.values()).sort((left, right) => left.label.localeCompare(right.label));
  }

  flattenBankQuestions(banks) {
    const questionMap = new Map();

    for (const bank of banks) {
      for (const bankQuestion of bank.bankQuestions || []) {
        const question = bankQuestion.question;
        if (!question || questionMap.has(question.id)) continue;

        questionMap.set(question.id, {
          ...question,
          difficulty: question.difficulty || "MEDIUM",
          sourceBankId: bank.id,
          sourceBankName: bank.name,
          bankSortOrder: bankQuestion.sortOrder,
        });
      }
    }

    return Array.from(questionMap.values());
  }

  parseQuestionNumberForSectionMapping(question) {
    const directCandidates = [question.sourceQuestionNo, question.questionNo];
    for (const candidate of directCandidates) {
      const match = String(candidate || "").match(/\d+/);
      if (match) {
        const parsed = parseInt(match[0]);
        if (Number.isInteger(parsed) && parsed > 0) return parsed;
      }
    }

    const sortOrder = parseInt(question.bankSortOrder);
    if (Number.isInteger(sortOrder) && sortOrder >= 0) {
      return sortOrder + 1;
    }

    return null;
  }

  normalizeDifficultyCounts(input = {}) {
    const counts = {};

    for (const difficulty of VALID_DIFFICULTIES) {
      counts[difficulty] = this.parseNonNegativeInt(input[difficulty], `${difficulty} count is invalid`);
    }

    return counts;
  }

  normalizeMarksByDifficulty(input = {}) {
    const marks = {};

    for (const difficulty of VALID_DIFFICULTIES) {
      marks[difficulty] = this.parseRequiredPositiveInt(
        input[difficulty] || 1,
        `${difficulty} marks must be greater than zero`
      );
    }

    return marks;
  }

  normalizeIdList(value, message) {
    if (!Array.isArray(value) || value.length === 0) {
      this.throwValidation(message);
    }

    const parsed = [...new Set(value.map((id) => parseInt(id)).filter((id) => Number.isInteger(id) && id > 0))];
    if (parsed.length === 0) {
      this.throwValidation(message);
    }

    return parsed;
  }

  summarizeDifficulties(questions) {
    return questions.reduce(
      (summary, question) => {
        summary[question.difficulty] += 1;
        return summary;
      },
      { EASY: 0, MEDIUM: 0, HARD: 0 }
    );
  }

  labelForSet(index) {
    let value = index;
    let label = "";

    do {
      label = String.fromCharCode(65 + (value % 26)) + label;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);

    return label;
  }

  shuffle(items) {
    const copy = [...items];

    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }

    return copy;
  }

  async buildWhere(filters = {}, user) {
    const where = {};

    if (user.role !== "ADMIN") {
      where.createdById = parseInt(user.id);
      const assignedSubjectIds = await subjectAccessService.getAssignedSubjectIds(user);
      where.subjectId = subjectAccessService.assignedSubjectFilter(assignedSubjectIds);
    } else if (filters.createdById) {
      where.createdById = parseInt(filters.createdById);
    }

    if (filters.subjectId) {
      const filteredSubjectId = parseInt(filters.subjectId);
      if (where.subjectId) {
        where.AND = [...(where.AND || []), { subjectId: filteredSubjectId }];
      } else {
        where.subjectId = filteredSubjectId;
      }
    }

    if (filters.chapterId) {
      where.chapterId = parseInt(filters.chapterId);
    }

    if (filters.conceptId) {
      where.conceptId = parseInt(filters.conceptId);
    }

    if (filters.classGrade && filters.classGrade.trim() !== "") {
      where.classGrade = { contains: filters.classGrade.trim() };
    }

    if (filters.subClass && filters.subClass.trim() !== "") {
      where.subClass = { contains: filters.subClass.trim() };
    }

    if (filters.examNature) {
      where.examNature = filters.examNature;
    }

    if (filters.codeNo && filters.codeNo.trim() !== "") {
      where.codeNo = { contains: filters.codeNo.trim() };
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.difficultyLevel) {
      where.difficultyLevel = filters.difficultyLevel;
    }

    if (filters.search && filters.search.trim() !== "") {
      const search = filters.search.trim();
      where.OR = [
        { title: { contains: search } },
        { description: { contains: search } },
        { instructions: { contains: search } },
        { classGrade: { contains: search } },
        { subClass: { contains: search } },
        { codeNo: { contains: search } },
        { timingText: { contains: search } },
      ];
    }

    return where;
  }

  async normalizePayload(payload, user, existing = null) {
    const userId = user.id;
    const merged = {
      title: payload.title !== undefined ? payload.title : existing?.title,
      description: payload.description !== undefined ? payload.description : existing?.description,
      subjectId: payload.subjectId !== undefined ? payload.subjectId : existing?.subjectId,
      chapterId: payload.chapterId !== undefined ? payload.chapterId : existing?.chapterId,
      conceptId: payload.conceptId !== undefined ? payload.conceptId : existing?.conceptId,
      templateId: payload.templateId !== undefined ? payload.templateId : existing?.templateId,
      classGrade: payload.classGrade !== undefined ? payload.classGrade : existing?.classGrade,
      subClass: payload.subClass !== undefined ? payload.subClass : existing?.subClass,
      examNature: payload.examNature !== undefined ? payload.examNature : existing?.examNature,
      examDate: payload.examDate !== undefined ? payload.examDate : existing?.examDate,
      codeNo: payload.codeNo !== undefined ? payload.codeNo : existing?.codeNo,
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
      status: payload.status !== undefined ? payload.status : existing?.status,
    };

    if (!merged.title || String(merged.title).trim() === "") {
      this.throwValidation("Assessment title is required");
    }

    if (!merged.classGrade || String(merged.classGrade).trim() === "") {
      this.throwValidation("Class or grade is required");
    }

    const subjectId = this.parseRequiredPositiveInt(merged.subjectId, "Subject is required");
    const templateId = this.parseOptionalPositiveInt(merged.templateId, "Invalid assessment template");
    const totalMarks = this.parseRequiredPositiveInt(merged.totalMarks, "Total marks must be greater than zero");
    const durationMinutes = this.parseRequiredPositiveInt(
      merged.durationMinutes,
      "Duration must be greater than zero"
    );

    const chapterId = this.parseOptionalPositiveInt(merged.chapterId, "Invalid chapter");
    const conceptId = this.parseOptionalPositiveInt(merged.conceptId, "Invalid concept");
    const difficultyLevel = String(merged.difficultyLevel || "MEDIUM").trim().toUpperCase();
    const status = this.normalizeStatus(merged.status || "DRAFT");
    const examNature = this.normalizeExamNature(merged.examNature);
    const examDate = this.parseOptionalDate(merged.examDate, "Exam date is invalid");
    const defaultGenerationMode = this.normalizeGenerationMode(merged.defaultGenerationMode);
    const defaultSetCount = this.parseOptionalBoundedPositiveInt(
      merged.defaultSetCount,
      "Default set count must be greater than zero",
      20
    );
    const defaultDifficultyCounts = this.normalizeOptionalDifficultyCounts(merged.defaultDifficultyCounts);
    const defaultMarksByDifficulty = this.normalizeOptionalMarksByDifficulty(merged.defaultMarksByDifficulty);
    const defaultQuestionBankIds = this.normalizeOptionalIdList(merged.defaultQuestionBankIds);

    if (!VALID_DIFFICULTIES.includes(difficultyLevel)) {
      this.throwValidation("Invalid difficulty level");
    }

    if (!VALID_STATUSES.includes(status)) {
      this.throwValidation("Invalid test paper status");
    }

    await this.validateAcademicScope(subjectId, chapterId, conceptId);
    await subjectAccessService.requireSubjectAccess(user, subjectId);
    await this.validateTemplateAccess(templateId, userId);

    const data = {
      title: String(merged.title).trim(),
      description: this.emptyToNull(merged.description),
      subjectId,
      chapterId,
      conceptId,
      templateId,
      classGrade: String(merged.classGrade).trim(),
      subClass: this.emptyToNull(merged.subClass),
      examNature,
      examDate,
      codeNo: this.emptyToNull(merged.codeNo),
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
      status,
    };

    this.ensurePostMetadata(data);

    if (!existing) {
      data.createdById = parseInt(userId);
    }

    return data;
  }

  async validateAcademicScope(subjectId, chapterId, conceptId) {
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

  async validateTemplateAccess(templateId, userId) {
    if (!templateId) return;

    const template = await assessmentTemplateRepository.findById(templateId);
    if (!template) {
      this.throwNotFound("Assessment template not found");
    }

    if (template.status !== "ACTIVE") {
      this.throwValidation("Archived templates cannot be applied to assessments");
    }

    if (!template.isGlobal && template.createdById !== parseInt(userId)) {
      this.throwValidation("You cannot apply this private assessment template");
    }
  }

  ensureFound(paper) {
    if (!paper) {
      this.throwNotFound("Test paper not found");
    }
  }

  async ensureCanAccess(paper, user) {
    if (user.role !== "ADMIN" && paper.createdById !== parseInt(user.id)) {
      const err = new Error("Forbidden: You can only view your own test papers.");
      err.statusCode = 403;
      throw err;
    }

    await subjectAccessService.requireSubjectAccess(user, paper.subjectId);
  }

  async ensureCanModify(paper, user) {
    if (user.role !== "ADMIN" && paper.createdById !== parseInt(user.id)) {
      const err = new Error("Forbidden: You can only modify your own test papers.");
      err.statusCode = 403;
      throw err;
    }

    await subjectAccessService.requireSubjectAccess(user, paper.subjectId);
  }

  parseRequiredPositiveInt(value, message) {
    const parsed = parseInt(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      this.throwValidation(message);
    }
    return parsed;
  }

  parseBoundedPositiveInt(value, message, max) {
    const parsed = this.parseRequiredPositiveInt(value, message);
    if (parsed > max) {
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

  parseOptionalPositiveInt(value, message) {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const parsed = parseInt(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      this.throwValidation(message);
    }
    return parsed;
  }

  parseOptionalBoundedPositiveInt(value, message, max) {
    const parsed = this.parseOptionalPositiveInt(value, message);
    if (parsed && parsed > max) {
      this.throwValidation(`Maximum allowed value is ${max}`);
    }
    return parsed;
  }

  parseOptionalDate(value, message) {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        this.throwValidation(message);
      }
      return value;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      this.throwValidation(message);
    }

    return parsed;
  }

  normalizeOptionalDifficultyCounts(input) {
    if (input === undefined || input === null || input === "") return null;

    const counts = {};
    for (const difficulty of VALID_DIFFICULTIES) {
      counts[difficulty] = this.parseNonNegativeInt(input[difficulty], `${difficulty} count is invalid`);
    }
    return counts;
  }

  normalizeOptionalMarksByDifficulty(input) {
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

  normalizeExamNature(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const normalized = String(value).trim().toUpperCase();
    if (!VALID_EXAM_NATURES.includes(normalized)) {
      this.throwValidation("Exam nature must be On Demand or Public Examinations");
    }

    return normalized;
  }

  normalizeGenerationMode(value) {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    const normalized = String(value).trim().toUpperCase();
    if (!VALID_GENERATION_MODES.includes(normalized)) {
      this.throwValidation("Generation mode must be RANDOM, MANUAL, or SECTION_BLUEPRINT");
    }

    return normalized;
  }

  normalizeStatus(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return LEGACY_STATUS_MAP[normalized] || normalized;
  }

  ensurePostMetadata(data) {
    if (this.normalizeStatus(data.status) !== "POSTED") {
      return;
    }

    const missing = [];
    if (!data.examNature) missing.push("exam nature");
    if (!data.examDate) missing.push("exam date");
    if (!this.emptyToNull(data.codeNo)) missing.push("code number");
    if (!this.emptyToNull(data.timingText)) missing.push("timing");

    if (missing.length) {
      this.throwValidation(`Please add ${missing.join(", ")} before posting this assessment.`);
    }
  }

  ensureReadyToPost(paper) {
    const currentStatus = this.normalizeStatus(paper.status);
    if (!["QUESTIONS_GENERATED", "POSTED"].includes(currentStatus)) {
      this.throwValidation("Generate questions before posting this assessment.");
    }

    if (!paper.sets?.length) {
      this.throwValidation("Generate at least one question set before posting this assessment.");
    }

    this.ensurePostMetadata({ ...paper, status: "POSTED" });
  }

  ensureCanGenerateQuestions(paper) {
    const currentStatus = this.normalizeStatus(paper.status);
    if (currentStatus === "POSTED") {
      this.throwValidation("Posted assessments are locked. Create a copy or confirm edits before changing questions.");
    }

    if (currentStatus === "ARCHIVED") {
      this.throwValidation("Archived assessments cannot generate questions.");
    }
  }

  ensurePostedAssessmentUnlocked(paper) {
    if (this.normalizeStatus(paper.status) === "POSTED") {
      this.throwValidation("Posted assessments are locked. Question sets cannot be changed after posting.");
    }
  }

  ensurePostedSettingsChangeAllowed(existing, data, confirmed) {
    if (this.normalizeStatus(existing.status) !== "POSTED") {
      return;
    }

    const changedFields = POSTED_LOCKED_FIELDS.filter(
      (field) => !this.valuesMatch(existing[field], data[field])
    );

    if (changedFields.length && !confirmed) {
      const err = new Error("Posted assessment settings are locked. Confirm the change before saving.");
      err.statusCode = 409;
      err.details = { changedFields };
      throw err;
    }
  }

  valuesMatch(left, right) {
    if (left instanceof Date || right instanceof Date) {
      const leftDate = left ? new Date(left) : null;
      const rightDate = right ? new Date(right) : null;
      return (leftDate?.getTime() || null) === (rightDate?.getTime() || null);
    }

    if (Array.isArray(left) || Array.isArray(right) || this.isPlainObject(left) || this.isPlainObject(right)) {
      return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
    }

    return (left ?? null) === (right ?? null);
  }

  isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && value.constructor === Object;
  }

  emptyToNull(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
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

module.exports = new TestPaperService();
