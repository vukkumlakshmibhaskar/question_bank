const os = require("node:os");
const telescopeRepository = require("../repositories/telescope.repository");
const auditService = require("./audit.service");
const extractionProxyService = require("./extractionProxy.service");
const extractionReviewImportService = require("./extractionReviewImport.service");
const { classifyError, sanitizeContext } = require("./errorClassifier.service");

const truncate = (value, maxLength) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const safeServiceStatus = async () => {
  try {
    return await extractionProxyService.getStatus();
  } catch (error) {
    return {
      online: false,
      status: "offline",
      checkedAt: new Date().toISOString(),
      services: [],
      error: error.message || "Unable to read extraction status.",
    };
  }
};

class TelescopeService {
  async getSummary() {
    const [counts, services, databaseOnline] = await Promise.all([
      telescopeRepository.getSummaryCounts(),
      safeServiceStatus(),
      telescopeRepository.pingDatabase().catch(() => false),
    ]);

    return {
      checkedAt: new Date().toISOString(),
      backend: {
        online: true,
        uptimeSeconds: Math.round(process.uptime()),
        pid: process.pid,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        host: os.hostname(),
      },
      database: {
        online: databaseOnline,
      },
      extraction: services,
      counts,
    };
  }

  async getRequestLogs(filters) {
    return telescopeRepository.getRequestLogs(filters);
  }

  async getRequestLogDetail(id) {
    return telescopeRepository.getRequestLogById(id);
  }

  async getErrorLogs(filters) {
    return telescopeRepository.getErrorLogs(filters);
  }

  async getErrorLogDetail(id) {
    return telescopeRepository.getErrorLogById(id);
  }

  async recordFrontendError(payload = {}, req = null) {
    const error = new Error(payload.message || "Frontend error");
    error.name = payload.errorType || payload.name || "FrontendError";
    error.stack = payload.stack || payload.stackPreview || "";
    error.statusCode = payload.statusCode || null;

    const classification = classifyError(error, {
      sourceLayer: "FRONTEND",
      confidence: "HIGH",
      frontendRoute: payload.frontendRoute,
      statusCode: payload.statusCode,
      userAction: payload.userAction,
      context: {
        source: "frontend-telemetry",
        componentName: payload.componentName || null,
        info: payload.info || null,
        browser: payload.browser || null,
        api: payload.api || null,
        userAction: payload.userAction || null,
        ...sanitizeContext(payload.context || {}),
      },
    });

    const log = await telescopeRepository.createErrorLog({
      requestId: truncate(payload.requestId, 80),
      traceId: truncate(payload.traceId || payload.requestId, 80),
      method: truncate(payload.method || "FRONTEND", 12),
      path: truncate(payload.frontendRoute || payload.path || "browser", 500),
      statusCode: payload.statusCode ? Number.parseInt(payload.statusCode, 10) : null,
      message: truncate(error.message, 6000),
      stack: truncate(error.stack, 6000),
      userId: req?.user?.id ? Number.parseInt(req.user.id, 10) : null,
      userRole: truncate(req?.user?.role, 40),
      userEmail: truncate(req?.user?.email, 255),
      ipAddress: truncate(req?.ip || req?.socket?.remoteAddress, 120),
      userAgent: truncate(req?.headers?.["user-agent"] || payload.browser?.userAgent, 500),
      frontendRoute: truncate(payload.frontendRoute, 500),
      userAction: truncate(payload.userAction, 255),
      ...classification,
    });

    return {
      id: log.id,
      sourceLayer: log.sourceLayer,
      confidence: log.confidence,
      traceId: log.traceId,
    };
  }

  async getJobs(filters) {
    return telescopeRepository.getJobs(filters);
  }

  async getServices() {
    const status = await safeServiceStatus();
    return {
      ...status,
      targets: extractionProxyService.getTargets(),
    };
  }

  async getDataHealth() {
    return telescopeRepository.getDataHealth();
  }

  async getAuditLogs(filters) {
    return auditService.getAuditLogs(filters);
  }

  async importExtractionReview(payload, user) {
    return extractionReviewImportService.importRows(payload, user);
  }

  async getDiagnostics() {
    const [summary, dataHealth, jobs, requests, errors] = await Promise.all([
      this.getSummary(),
      this.getDataHealth(),
      this.getJobs({ page: 1, pageSize: 10 }),
      this.getRequestLogs({ page: 1, pageSize: 10 }),
      this.getErrorLogs({ page: 1, pageSize: 10 }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      summary,
      dataHealth,
      latestJobs: jobs.data || jobs,
      latestRequests: requests.data || requests,
      latestErrors: errors.data || errors,
    };
  }
}

module.exports = new TelescopeService();
