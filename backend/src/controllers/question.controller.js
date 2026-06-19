const questionService = require("../services/question.service");
const questionBankExcelService = require("../services/questionBankExcel.service");

class QuestionController {
  // --- Questions ---
  async getQuestions(req, res, next) {
    try {
      const {
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
        objectiveType,
        questionTypeLabel,
        marks,
        marksMin,
        marksMax,
        page,
        pageSize,
        limit,
        offset,
      } = req.query;
      const questions = await questionService.getQuestionsList({
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
        objectiveType,
        questionTypeLabel,
        marks,
        marksMin,
        marksMax,
        page,
        pageSize,
        limit,
        offset,
      }, req.user);
      return res.status(200).json(questions);
    } catch (error) {
      next(error);
    }
  }

  async getQuestionById(req, res, next) {
    try {
      const { id } = req.params;
      const question = await questionService.getQuestionById(id, req.user);
      return res.status(200).json(question);
    } catch (error) {
      next(error);
    }
  }

  async createQuestion(req, res, next) {
    try {
      const { question, answers } = req.body;
      const createdQuestion = await questionService.createQuestion(
        req.user.id,
        question,
        answers,
        req.user
      );
      return res.status(201).json({
        message: "Question created successfully",
        question: createdQuestion,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateQuestion(req, res, next) {
    try {
      const { id } = req.params;
      const { question, answers } = req.body;
      const updatedQuestion = await questionService.updateQuestion(
        id,
        req.user.id,
        req.user.role,
        question,
        answers
      );
      return res.status(200).json({
        message: "Question updated successfully",
        question: updatedQuestion,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteQuestion(req, res, next) {
    try {
      const { id } = req.params;
      await questionService.deleteQuestion(id, req.user.id, req.user.role);
      return res.status(200).json({ message: "Question deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  async bulkDeleteQuestions(req, res, next) {
    try {
      const { ids } = req.body;
      const result = await questionService.deleteQuestionsBulk(ids, req.user.id, req.user.role);
      return res.status(200).json({
        message: `Successfully deleted ${result.count} questions.`,
        success: true
      });
    } catch (error) {
      next(error);
    }
  }

  // --- Question Banks ---
  async getBanks(req, res, next) {
    try {
      const {
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
      } = req.query;
      const banks = await questionService.getBanksList(req.user.id, {
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
      }, req.user);
      return res.status(200).json(banks);
    } catch (error) {
      next(error);
    }
  }

  async getBankById(req, res, next) {
    try {
      const { id } = req.params;
      const bank = await questionService.getBankById(id);
      return res.status(200).json(bank);
    } catch (error) {
      next(error);
    }
  }

  async createBank(req, res, next) {
    try {
      const bank = await questionService.createQuestionBank(req.user.id, req.body);
      return res.status(201).json({
        message: "Question Bank created successfully",
        bank,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateBank(req, res, next) {
    try {
      const { id } = req.params;
      const bank = await questionService.updateQuestionBank(
        id,
        req.user.id,
        req.user.role,
        req.body
      );
      return res.status(200).json({
        message: "Question Bank updated successfully",
        bank,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteBank(req, res, next) {
    try {
      const { id } = req.params;
      await questionService.deleteBank(id, req.user.id, req.user.role);
      return res.status(200).json({ message: "Question Bank deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  async addQuestionToBank(req, res, next) {
    try {
      const { bankId } = req.params;
      const { questionId, questionIds, sortOrder } = req.body;

      if (Array.isArray(questionIds)) {
        const result = await questionService.addQuestionsToBank(
          bankId,
          questionIds,
          req.user.id,
          req.user.role,
          sortOrder
        );

        return res.status(200).json({
          message: `Successfully linked ${result.count} questions to bank.`,
          count: result.count,
        });
      }

      if (!questionId) {
        return res.status(400).json({ error: "questionId or questionIds is required." });
      }

      await questionService.addQuestionToBank(
        bankId,
        questionId,
        req.user.id,
        req.user.role,
        sortOrder
      );

      return res.status(200).json({ message: "Question linked to bank successfully" });
    } catch (error) {
      next(error);
    }
  }

  async removeQuestionFromBank(req, res, next) {
    try {
      const { bankId, questionId } = req.params;
      await questionService.removeQuestionFromBank(
        bankId,
        questionId,
        req.user.id,
        req.user.role
      );
      return res.status(200).json({ message: "Question unlinked from bank successfully" });
    } catch (error) {
      next(error);
    }
  }

  async removeQuestionsFromBank(req, res, next) {
    try {
      const { bankId } = req.params;
      const { questionIds } = req.body;

      const result = await questionService.removeQuestionsFromBank(
        bankId,
        questionIds,
        req.user.id,
        req.user.role
      );

      return res.status(200).json({
        message: `Successfully unlinked ${result.count} questions from bank.`,
        count: result.count,
      });
    } catch (error) {
      next(error);
    }
  }

  async getLatestExcelTemplateInfo(req, res, next) {
    try {
      return res.status(200).json(questionBankExcelService.getTemplateInfo());
    } catch (error) {
      next(error);
    }
  }

  async downloadLatestExcelTemplate(req, res, next) {
    try {
      const templateInfo = questionBankExcelService.getTemplateInfo();
      const buffer = questionBankExcelService.buildTemplateWorkbookBuffer();

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${templateInfo.fileName}"`);
      res.setHeader("X-QB-Template-Version", templateInfo.version);
      return res.status(200).send(buffer);
    } catch (error) {
      next(error);
    }
  }

  async previewExcelImport(req, res, next) {
    try {
      const preview = await questionBankExcelService.preview(req.file, req.user.id);
      return res.status(200).json(preview);
    } catch (error) {
      next(error);
    }
  }

  async commitExcelImport(req, res, next) {
    try {
      const result = await questionBankExcelService.commit(req.body.previewToken, req.user.id);
      return res.status(200).json({
        message: "Question bank Excel import completed successfully",
        result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new QuestionController();
