const telescopeService = require("../services/telescope.service");

class TelescopeController {
  async getSummary(req, res, next) {
    try {
      const summary = await telescopeService.getSummary();
      return res.status(200).json(summary);
    } catch (error) {
      next(error);
    }
  }

  async getRequests(req, res, next) {
    try {
      const requests = await telescopeService.getRequestLogs(req.query);
      return res.status(200).json(requests);
    } catch (error) {
      next(error);
    }
  }

  async getRequestDetail(req, res, next) {
    try {
      const request = await telescopeService.getRequestLogDetail(req.params.id);
      if (!request) {
        return res.status(404).json({ error: "Telescope request log not found." });
      }
      return res.status(200).json(request);
    } catch (error) {
      next(error);
    }
  }

  async getErrors(req, res, next) {
    try {
      const errors = await telescopeService.getErrorLogs(req.query);
      return res.status(200).json(errors);
    } catch (error) {
      next(error);
    }
  }

  async getErrorDetail(req, res, next) {
    try {
      const error = await telescopeService.getErrorLogDetail(req.params.id);
      if (!error) {
        return res.status(404).json({ error: "Telescope error log not found." });
      }
      return res.status(200).json(error);
    } catch (error) {
      next(error);
    }
  }

  async recordFrontendError(req, res, next) {
    try {
      const result = await telescopeService.recordFrontendError(req.body, req);
      return res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getJobs(req, res, next) {
    try {
      const jobs = await telescopeService.getJobs(req.query);
      return res.status(200).json(jobs);
    } catch (error) {
      next(error);
    }
  }

  async getServices(req, res, next) {
    try {
      const services = await telescopeService.getServices();
      return res.status(200).json(services);
    } catch (error) {
      next(error);
    }
  }

  async getDataHealth(req, res, next) {
    try {
      const dataHealth = await telescopeService.getDataHealth();
      return res.status(200).json(dataHealth);
    } catch (error) {
      next(error);
    }
  }

  async getAuditLogs(req, res, next) {
    try {
      const auditLogs = await telescopeService.getAuditLogs(req.query);
      return res.status(200).json(auditLogs);
    } catch (error) {
      next(error);
    }
  }

  async importExtractionReview(req, res, next) {
    try {
      const result = await telescopeService.importExtractionReview(req.body, req.user);
      return res.status(result.updated ? 200 : 201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async exportDiagnostics(req, res, next) {
    try {
      const diagnostics = await telescopeService.getDiagnostics();
      const exportedAt = new Date().toISOString().replace(/[:.]/g, "-");
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="qbank-telescope-diagnostics-${exportedAt}.json"`
      );
      return res.status(200).send(JSON.stringify(diagnostics, null, 2));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TelescopeController();
