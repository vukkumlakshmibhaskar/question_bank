const prisma = require("../config/prisma");
const { parsePagination, paginatedResponse } = require("../utils/pagination");

const dayAgo = () => {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date;
};

const TELESCOPE_RETENTION_DAYS = Number.parseInt(process.env.TELESCOPE_RETENTION_DAYS || "7", 10);
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;
let cleanupPromise = null;

const retentionCutoff = () => {
  const date = new Date();
  date.setDate(date.getDate() - (Number.isInteger(TELESCOPE_RETENTION_DAYS) ? TELESCOPE_RETENTION_DAYS : 7));
  return date;
};

const buildSearch = (search) => {
  const trimmed = String(search || "").trim();
  if (!trimmed) return [];

  return [
    { path: { contains: trimmed } },
    { route: { contains: trimmed } },
    { userEmail: { contains: trimmed } },
    { userRole: { contains: trimmed } },
  ];
};

const buildRelatedLogWhere = (...records) => {
  const seen = new Set();
  const OR = [];

  for (const record of records) {
    for (const field of ["requestId", "traceId"]) {
      const value = record?.[field];
      if (!value || seen.has(`${field}:${value}`)) continue;
      seen.add(`${field}:${value}`);
      OR.push({ [field]: value });
    }
  }

  return OR.length ? { OR } : null;
};

class TelescopeRepository {
  async createRequestLog(data) {
    this.scheduleRetentionCleanup();
    return prisma.telescopeRequestLog.create({ data });
  }

  async createErrorLog(data) {
    this.scheduleRetentionCleanup();
    return prisma.telescopeErrorLog.create({ data });
  }

  scheduleRetentionCleanup() {
    const now = Date.now();
    if (cleanupPromise || now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;

    lastCleanupAt = now;
    cleanupPromise = this.cleanupOldLogs()
      .catch((error) => {
        console.warn("Telescope retention cleanup failed:", error.message);
      })
      .finally(() => {
        cleanupPromise = null;
      });
  }

  async cleanupOldLogs() {
    const cutoff = retentionCutoff();
    const [errors, requests] = await prisma.$transaction([
      prisma.telescopeErrorLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
      prisma.telescopeRequestLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      }),
    ]);

    return {
      retentionDays: Number.isInteger(TELESCOPE_RETENTION_DAYS) ? TELESCOPE_RETENTION_DAYS : 7,
      cutoff,
      deletedErrors: errors.count,
      deletedRequests: requests.count,
    };
  }

  async pingDatabase() {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  }

  async getRequestLogs(filters = {}) {
    const where = {};
    const search = buildSearch(filters.search);

    if (filters.method && filters.method !== "ALL") {
      where.method = String(filters.method).toUpperCase();
    }

    if (filters.status && filters.status !== "ALL") {
      const status = String(filters.status).toUpperCase();
      if (status === "ERROR") where.statusCode = { gte: 400 };
      else if (status === "SUCCESS") where.statusCode = { lt: 400 };
      else {
        const parsed = Number.parseInt(status, 10);
        if (Number.isInteger(parsed)) where.statusCode = parsed;
      }
    }

    if (search.length > 0) where.OR = search;

    const pagination = parsePagination(filters);
    const query = {
      where,
      orderBy: { createdAt: "desc" },
    };

    if (!pagination.wantsPagination) {
      return prisma.telescopeRequestLog.findMany({
        ...query,
        take: 50,
      });
    }

    const [total, rows] = await Promise.all([
      prisma.telescopeRequestLog.count({ where }),
      prisma.telescopeRequestLog.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginatedResponse(rows, total, pagination);
  }

  async getRequestLogById(id) {
    const parsedId = Number.parseInt(id, 10);
    if (!Number.isInteger(parsedId)) return null;

    const request = await prisma.telescopeRequestLog.findUnique({
      where: { id: parsedId },
    });

    if (!request) return null;

    const relatedWhere = buildRelatedLogWhere(request);
    const relatedErrors = relatedWhere
      ? await prisma.telescopeErrorLog.findMany({
          where: relatedWhere,
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [];

    return {
      ...request,
      relatedErrors,
    };
  }

  async getErrorLogById(id) {
    const parsedId = Number.parseInt(id, 10);
    if (!Number.isInteger(parsedId)) return null;

    const error = await prisma.telescopeErrorLog.findUnique({
      where: { id: parsedId },
    });

    if (!error) return null;

    const relatedWhere = buildRelatedLogWhere(error);
    const relatedRequests = relatedWhere
      ? await prisma.telescopeRequestLog.findMany({
          where: relatedWhere,
          orderBy: { createdAt: "desc" },
          take: 10,
        })
      : [];

    return {
      ...error,
      relatedRequests,
    };
  }

  async getErrorLogs(filters = {}) {
    const where = {};
    const search = String(filters.search || "").trim();

    if (filters.source && filters.source !== "ALL") {
      where.sourceLayer = String(filters.source).toUpperCase();
    }

    if (filters.severity && filters.severity !== "ALL") {
      where.severity = String(filters.severity).toUpperCase();
    }

    if (filters.status && filters.status !== "ALL") {
      const parsed = Number.parseInt(filters.status, 10);
      if (Number.isInteger(parsed)) where.statusCode = parsed;
    }

    if (search) {
      where.OR = [
        { path: { contains: search } },
        { message: { contains: search } },
        { userEmail: { contains: search } },
        { sourceLayer: { contains: search } },
        { sourceService: { contains: search } },
        { originFile: { contains: search } },
        { classificationReason: { contains: search } },
        { traceId: { contains: search } },
      ];
    }

    const pagination = parsePagination(filters);
    const query = {
      where,
      orderBy: { createdAt: "desc" },
    };

    if (!pagination.wantsPagination) {
      return prisma.telescopeErrorLog.findMany({
        ...query,
        take: 50,
      });
    }

    const [total, rows] = await Promise.all([
      prisma.telescopeErrorLog.count({ where }),
      prisma.telescopeErrorLog.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginatedResponse(rows, total, pagination);
  }

  async getJobs(filters = {}) {
    const where = {};

    if (filters.status && filters.status !== "ALL") {
      where.status = String(filters.status).toUpperCase();
    }

    const pagination = parsePagination(filters);
    const query = {
      where,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        uploadFile: {
          select: {
            id: true,
            fileName: true,
            processingStatus: true,
            createdAt: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
    };

    if (!pagination.wantsPagination) {
      return prisma.processingJob.findMany({
        ...query,
        take: 50,
      });
    }

    const [total, rows] = await Promise.all([
      prisma.processingJob.count({ where }),
      prisma.processingJob.findMany({
        ...query,
        skip: pagination.skip,
        take: pagination.take,
      }),
    ]);

    return paginatedResponse(rows, total, pagination);
  }

  async getDataHealth() {
    const [
      totalQuestions,
      pendingReviews,
      approvedReviews,
      rejectedReviews,
      failedJobs,
      runningJobs,
      uploads,
      latestReviews,
    ] = await Promise.all([
      prisma.question.count(),
      prisma.extractionReview.count({ where: { status: "PENDING" } }),
      prisma.extractionReview.count({ where: { status: "APPROVED" } }),
      prisma.extractionReview.count({ where: { status: "REJECTED" } }),
      prisma.processingJob.count({ where: { status: "FAILED" } }),
      prisma.processingJob.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.uploadFile.count(),
      prisma.extractionReview.findMany({
        select: {
          id: true,
          status: true,
          version: true,
          createdAt: true,
          updatedAt: true,
          uploadFile: {
            select: {
              id: true,
              fileName: true,
              processingStatus: true,
            },
          },
        },
        orderBy: { id: "desc" },
        take: 8,
      }),
    ]);

    return {
      totals: {
        questions: totalQuestions,
        pendingReviews,
        approvedReviews,
        rejectedReviews,
        failedJobs,
        runningJobs,
        uploads,
      },
      latestReviews,
    };
  }

  async getSummaryCounts() {
    const since = dayAgo();
    const [
      requests24h,
      errors24h,
      failedJobs,
      runningJobs,
      pendingReviews,
      auditLogs24h,
      durationAggregate,
      recentErrors,
    ] = await Promise.all([
      prisma.telescopeRequestLog.count({ where: { createdAt: { gte: since } } }),
      prisma.telescopeErrorLog.count({ where: { createdAt: { gte: since } } }),
      prisma.processingJob.count({ where: { status: "FAILED" } }),
      prisma.processingJob.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
      prisma.extractionReview.count({ where: { status: "PENDING" } }),
      prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      prisma.telescopeRequestLog.aggregate({
        where: { createdAt: { gte: since } },
        _avg: { durationMs: true },
      }),
      prisma.telescopeErrorLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    return {
      requests24h,
      errors24h,
      failedJobs,
      runningJobs,
      pendingReviews,
      auditLogs24h,
      averageDurationMs: Math.round(durationAggregate._avg.durationMs || 0),
      recentErrors,
    };
  }
}

module.exports = new TelescopeRepository();
