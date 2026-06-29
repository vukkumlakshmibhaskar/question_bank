const testPaperService = require("../services/testPaper.service");

class TestPaperController {
  async getTestPapers(req, res, next) {
    try {
      const testPapers = await testPaperService.getTestPapers(req.query, req.user);
      return res.status(200).json(testPapers);
    } catch (error) {
      next(error);
    }
  }

  async getTestPaperById(req, res, next) {
    try {
      const testPaper = await testPaperService.getTestPaperById(req.params.id, req.user);
      return res.status(200).json(testPaper);
    } catch (error) {
      next(error);
    }
  }

  async getAssessmentSummary(req, res, next) {
    try {
      const summary = await testPaperService.getAssessmentSummary(req.params.id, req.user);
      return res.status(200).json(summary);
    } catch (error) {
      next(error);
    }
  }

  async getAssessmentMarks(req, res, next) {
    try {
      const marks = await testPaperService.getAssessmentMarks(req.params.id, req.user);
      return res.status(200).json(marks);
    } catch (error) {
      next(error);
    }
  }

  async getBlueprint(req, res, next) {
    try {
      const blueprint = await testPaperService.getBlueprint(req.params.id, req.user);
      return res.status(200).json(blueprint);
    } catch (error) {
      next(error);
    }
  }

  async updateBlueprint(req, res, next) {
    try {
      const blueprint = await testPaperService.updateBlueprint(req.params.id, req.body, req.user);
      return res.status(200).json({
        message: "Assessment blueprint saved successfully",
        blueprint,
      });
    } catch (error) {
      next(error);
    }
  }

  async validateBlueprintGeneration(req, res, next) {
    try {
      const validation = await testPaperService.validateBlueprintGeneration(req.params.id, req.body, req.user);
      return res.status(200).json(validation);
    } catch (error) {
      next(error);
    }
  }

  async applyBlueprintSectionMapping(req, res, next) {
    try {
      const result = await testPaperService.applyBlueprintSectionMapping(req.params.id, req.body, req.user);
      return res.status(200).json({
        message: "Section mapping applied successfully",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  async createTestPaper(req, res, next) {
    try {
      const testPaper = await testPaperService.createTestPaper(req.body, req.user);
      return res.status(201).json({
        message: "Test paper created successfully",
        testPaper,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateTestPaper(req, res, next) {
    try {
      const testPaper = await testPaperService.updateTestPaper(req.params.id, req.body, req.user);
      return res.status(200).json({
        message: "Test paper updated successfully",
        testPaper,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateTestPaperStatus(req, res, next) {
    try {
      const testPaper = await testPaperService.updateTestPaperStatus(
        req.params.id,
        req.body.status,
        req.user
      );
      return res.status(200).json({
        message: "Test paper status updated successfully",
        testPaper,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteTestPaper(req, res, next) {
    try {
      await testPaperService.deleteTestPaper(req.params.id, req.user);
      return res.status(200).json({ message: "Test paper deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  async generateQuestionPaperSets(req, res, next) {
    try {
      const testPaper = await testPaperService.generateQuestionPaperSets(
        req.params.id,
        req.body,
        req.user
      );
      return res.status(201).json({
        message: "Questions generated successfully",
        testPaper,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteQuestionPaperSet(req, res, next) {
    try {
      await testPaperService.deleteTestPaperSet(req.params.id, req.params.setId, req.user);
      return res.status(200).json({ message: "Question paper set deleted successfully" });
    } catch (error) {
      next(error);
    }
  }

  async getTranslationLanguages(req, res, next) {
    try {
      const result = await testPaperService.getTranslationLanguages();
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getTranslationHealth(req, res, next) {
    try {
      const result = await testPaperService.getTranslationHealth();
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async translateQuestionPaperSet(req, res, next) {
    try {
      const result = await testPaperService.submitSetTranslation(
        req.params.id,
        req.params.setId,
        req.body,
        req.user
      );
      return res.status(202).json({
        message: "Translation job submitted successfully",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getTranslationJobStatus(req, res, next) {
    try {
      const result = await testPaperService.getTranslationJobStatus(
        req.params.id,
        req.params.jobId,
        req.user
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getTranslationJobResult(req, res, next) {
    try {
      const result = await testPaperService.getTranslationJobResult(
        req.params.id,
        req.params.jobId,
        req.query.language,
        req.user
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TestPaperController();
