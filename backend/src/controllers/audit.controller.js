const auditService = require("../services/audit.service");

class AuditController {
  async getAuditLogs(req, res, next) {
    try {
      const logs = await auditService.getAuditLogs(req.query);
      return res.status(200).json(logs);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuditController();
