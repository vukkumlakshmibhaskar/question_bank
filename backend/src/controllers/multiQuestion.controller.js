const multiQuestionService = require("../services/multiQuestion.service");

class MultiQuestionController {
  async getSettings(req, res, next) {
    try {
      const settings = await multiQuestionService.getSettings();
      return res.status(200).json(settings);
    } catch (error) {
      next(error);
    }
  }

  async getQuestions(req, res, next) {
    try {
      const questions = await multiQuestionService.list(req.query);
      return res.status(200).json(questions);
    } catch (error) {
      next(error);
    }
  }

  async updateHeader(req, res, next) {
    try {
      const question = await multiQuestionService.updateHeader(
        req.params.id,
        req.body.questionHeader,
        req.user.id,
        req.user.role
      );

      return res.status(200).json({
        message: "Question header updated successfully",
        question,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new MultiQuestionController();
