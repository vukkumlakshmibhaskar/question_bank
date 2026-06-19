const assessmentTemplateService = require("../services/assessmentTemplate.service");

class AssessmentTemplateController {
  async getTemplates(req, res, next) {
    try {
      const templates = await assessmentTemplateService.getTemplates(req.query, req.user);
      return res.status(200).json(templates);
    } catch (error) {
      next(error);
    }
  }

  async getTemplateById(req, res, next) {
    try {
      const template = await assessmentTemplateService.getTemplateById(req.params.id, req.user);
      return res.status(200).json(template);
    } catch (error) {
      next(error);
    }
  }

  async createTemplate(req, res, next) {
    try {
      const template = await assessmentTemplateService.createTemplate(req.body, req.user);
      return res.status(201).json({
        message: "Assessment template created successfully",
        template,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateTemplate(req, res, next) {
    try {
      const template = await assessmentTemplateService.updateTemplate(req.params.id, req.body, req.user);
      return res.status(200).json({
        message: "Assessment template updated successfully",
        template,
      });
    } catch (error) {
      next(error);
    }
  }

  async archiveTemplate(req, res, next) {
    try {
      const template = await assessmentTemplateService.archiveTemplate(req.params.id, req.user);
      return res.status(200).json({
        message: "Assessment template archived successfully",
        template,
      });
    } catch (error) {
      next(error);
    }
  }

  async restoreTemplate(req, res, next) {
    try {
      const template = await assessmentTemplateService.restoreTemplate(req.params.id, req.user);
      return res.status(200).json({
        message: "Assessment template restored successfully",
        template,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AssessmentTemplateController();
