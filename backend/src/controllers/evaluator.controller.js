const evaluatorService = require("../services/evaluator.service");

class EvaluatorController {
  async list(req, res, next) {
    try {
      const result = await evaluatorService.list(req.query);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async downloadTemplate(req, res, next) {
    try {
      const template = evaluatorService.buildTemplate(req.query.rows);
      res.setHeader("Content-Type", "application/vnd.ms-excel.sheet.macroEnabled.12");
      res.setHeader("Content-Disposition", `attachment; filename="${template.filename}"`);
      return res.status(200).send(template.buffer);
    } catch (error) {
      next(error);
    }
  }

  async bulkUpload(req, res, next) {
    try {
      const result = await evaluatorService.bulkUpload({
        excelFile: req.files?.excel?.[0],
        documentFiles: req.files?.documents || [],
        user: req.user,
      });

      return res.status(201).json({
        message: "Evaluator bulk upload completed successfully.",
        result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDocuments(req, res, next) {
    try {
      const evaluator = await evaluatorService.getDocuments(req.params.id, req.user);
      return res.status(200).json(evaluator);
    } catch (error) {
      next(error);
    }
  }

  async downloadDocument(req, res, next) {
    try {
      const { document, absolutePath, exists } = await evaluatorService.getDocumentForDownload(
        req.params.documentId,
        req.user
      );

      if (!exists) {
        return res.status(404).json({ error: "Document file is missing on disk." });
      }

      res.setHeader("Content-Type", document.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${document.originalName}"`);
      return res.sendFile(absolutePath);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new EvaluatorController();
