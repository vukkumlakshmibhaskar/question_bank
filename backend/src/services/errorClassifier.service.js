const MAX_STACK_PREVIEW_LINES = 20;
const MAX_CONTEXT_KEYS = 60;
const MAX_CONTEXT_STRING = 1000;

const SOURCE = {
  FRONTEND: "FRONTEND",
  BACKEND: "BACKEND",
  DATABASE: "DATABASE",
  AUTH: "AUTH",
  EXTERNAL_SERVICE: "EXTERNAL_SERVICE",
  JOB_WORKER: "JOB_WORKER",
  NETWORK: "NETWORK",
  UNKNOWN: "UNKNOWN",
};

const KNOWN_EXTERNAL_PATHS = [
  "/api/extraction",
  "/api/lb-workflow",
  "/api/python-engines",
];

const truncate = (value, maxLength = MAX_CONTEXT_STRING) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const sanitizeContext = (value, depth = 0, key = "") => {
  if (value === null || value === undefined) return null;

  const normalizedKey = String(key || "").toLowerCase();
  if (/(password|token|secret|cookie|authorization|apikey|privatekey)/i.test(normalizedKey)) {
    return "[Redacted]";
  }

  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "[Nested value truncated]";

  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => sanitizeContext(item, depth + 1, key));
    if (value.length > 20) items.push(`[${value.length - 20} more item(s) omitted]`);
    return items;
  }

  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, MAX_CONTEXT_KEYS);
    for (const [entryKey, entryValue] of entries) {
      output[entryKey] = sanitizeContext(entryValue, depth + 1, entryKey);
    }
    const omitted = Object.keys(value).length - entries.length;
    if (omitted > 0) output._omitted = `${omitted} key(s) omitted`;
    return output;
  }

  return truncate(value);
};

const normalizeOriginFile = (rawFile) => {
  if (!rawFile) return null;

  let file = String(rawFile)
    .replace(/^file:\/+/, "")
    .replace(/^webpack-internal:\/\/\//, "")
    .replace(/^vite:\/\//, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .split("?")[0]
    .replace(/\\/g, "/");

  const markers = [
    "/backend/src/",
    "backend/src/",
    "/frontend/src/",
    "frontend/src/",
    "/src/",
    "src/",
  ];

  for (const marker of markers) {
    const index = file.indexOf(marker);
    if (index >= 0) {
      return file.slice(index + (marker.startsWith("/") ? 1 : 0));
    }
  }

  return truncate(file, 500);
};

const parseStackLine = (line) => {
  const match = String(line || "").match(/^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
  if (!match) return null;

  const originFile = normalizeOriginFile(match[2]);
  if (!originFile || originFile.includes("node_modules/") || originFile.startsWith("node:")) {
    return null;
  }

  return {
    originFunction: truncate(match[1] || "anonymous", 255),
    originFile,
    originLine: Number.parseInt(match[3], 10),
    originColumn: Number.parseInt(match[4], 10),
  };
};

const parseStackOrigin = (stack) => {
  const lines = String(stack || "").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseStackLine(line);
    if (parsed) return parsed;
  }
  return {};
};

const stackPreview = (stack) => {
  if (!stack) return null;
  return String(stack)
    .split(/\r?\n/)
    .slice(0, MAX_STACK_PREVIEW_LINES)
    .join("\n");
};

const isPrismaError = (error, message) => {
  const name = String(error?.name || error?.constructor?.name || "");
  return (
    name.includes("Prisma") ||
    /^P\d{4}$/.test(String(error?.code || "")) ||
    /prisma|PrismaClient|ConnectorError/i.test(message)
  );
};

const isMysqlError = (error, message) => (
  /^ER_/.test(String(error?.code || "")) ||
  Boolean(error?.sqlState || error?.sqlMessage || error?.errno) ||
  /mysql|sort memory|deadlock|lock wait|duplicate entry|connection.*database/i.test(message)
);

const isAuthError = (error, message, statusCode, req) => {
  const name = String(error?.name || "");
  const path = String(req?.originalUrl || req?.url || "");
  return (
    statusCode === 401 ||
    statusCode === 403 ||
    name === "JsonWebTokenError" ||
    name === "TokenExpiredError" ||
    /jwt|token|unauthorized|forbidden|access denied|permission/i.test(message) ||
    path.startsWith("/api/auth")
  );
};

const isExternalServiceError = (error, message, req, meta) => {
  const path = String(req?.originalUrl || req?.url || "");
  return (
    Boolean(meta.sourceService || meta.externalEndpoint) ||
    Boolean(error?.isAxiosError && error?.config?.url) ||
    KNOWN_EXTERNAL_PATHS.some((prefix) => path.startsWith(prefix)) ||
    /gemini|python parser|lb workflow|extraction service|external service|fetch failed/i.test(message)
  );
};

const isNetworkError = (error, message) => (
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|network|timeout|Network Error/i.test(
    `${error?.code || ""} ${message}`
  )
);

const isJobError = (message, req, meta) => {
  const path = String(req?.originalUrl || req?.url || "");
  return Boolean(meta.jobId || meta.jobType || /job|worker|queue/i.test(message) || path.includes("/jobs"));
};

const inferModule = (originFile, sourceLayer) => {
  if (!originFile) return null;
  const file = originFile.replace(/\\/g, "/");
  if (file.includes("/controllers/")) return "controller";
  if (file.includes("/services/")) return "service";
  if (file.includes("/repositories/")) return "repository";
  if (file.includes("/middleware/")) return "middleware";
  if (file.includes("/routes/")) return "route";
  if (file.includes("/views/")) return "view";
  if (file.includes("/components/")) return "component";
  if (file.includes("/stores/")) return "store";
  if (file.includes("/router/")) return "router";
  return sourceLayer ? sourceLayer.toLowerCase() : null;
};

const severityFor = (sourceLayer, statusCode, error) => {
  if (error?.severity) return truncate(error.severity, 20);
  if (sourceLayer === SOURCE.DATABASE) return "HIGH";
  if (sourceLayer === SOURCE.EXTERNAL_SERVICE) return "HIGH";
  if (sourceLayer === SOURCE.AUTH) return statusCode === 403 ? "MEDIUM" : "LOW";
  if (Number(statusCode || 0) >= 500) return "HIGH";
  if (Number(statusCode || 0) >= 400) return "MEDIUM";
  if (sourceLayer === SOURCE.FRONTEND) return "MEDIUM";
  return "LOW";
};

const classifyError = (error = {}, meta = {}) => {
  const message = String(error?.message || meta.message || "");
  const statusCode = Number(error?.statusCode || meta.statusCode || 0) || null;
  const req = meta.req || null;
  const stack = error?.stack || meta.stack || "";
  const origin = {
    ...parseStackOrigin(stack),
    ...(meta.origin || {}),
  };

  let sourceLayer = meta.sourceLayer || SOURCE.UNKNOWN;
  let confidence = meta.confidence || "LOW";
  let classificationReason = meta.classificationReason || "No classifier rule matched.";
  let databaseProvider = meta.databaseProvider || null;
  let sourceService = meta.sourceService || null;
  let externalEndpoint = meta.externalEndpoint || error?.config?.url || null;

  if (meta.sourceLayer === SOURCE.FRONTEND) {
    confidence = "HIGH";
    classificationReason = "Frontend telemetry reported this browser/Vue error.";
  } else if (isPrismaError(error, message) || isMysqlError(error, message)) {
    sourceLayer = SOURCE.DATABASE;
    confidence = "HIGH";
    databaseProvider = isPrismaError(error, message) ? "Prisma/MySQL" : "MySQL";
    classificationReason = error?.code
      ? `Database error code ${error.code}.`
      : "Database connector/query error matched Prisma/MySQL signatures.";
  } else if (isAuthError(error, message, statusCode, req)) {
    sourceLayer = SOURCE.AUTH;
    confidence = "HIGH";
    classificationReason = "Authentication or authorization failure matched status/token rules.";
  } else if (isExternalServiceError(error, message, req, meta)) {
    sourceLayer = SOURCE.EXTERNAL_SERVICE;
    confidence = meta.sourceService || meta.externalEndpoint ? "HIGH" : "MEDIUM";
    sourceService = sourceService || "External service";
    classificationReason = "Request matched configured extraction/LB/Gemini/external service signatures.";
  } else if (isJobError(message, req, meta)) {
    sourceLayer = SOURCE.JOB_WORKER;
    confidence = "MEDIUM";
    classificationReason = "Error was raised from a job/worker context.";
  } else if (isNetworkError(error, message)) {
    sourceLayer = SOURCE.NETWORK;
    confidence = "MEDIUM";
    classificationReason = "Network/timeout/connection error code matched.";
  } else if (statusCode || req) {
    sourceLayer = SOURCE.BACKEND;
    confidence = statusCode && statusCode < 500 ? "MEDIUM" : "HIGH";
    classificationReason = "Unhandled Express backend error without database/external/auth signatures.";
  }

  const originFile = origin.originFile || meta.originFile || null;
  const sourceModule = meta.sourceModule || inferModule(originFile, sourceLayer);

  return {
    sourceLayer,
    sourceModule,
    sourceService: sourceService ? truncate(sourceService, 120) : null,
    errorCode: truncate(error?.code || error?.errno || error?.sqlState || meta.errorCode, 80),
    errorType: truncate(error?.name || error?.constructor?.name || meta.errorType || "Error", 160),
    severity: severityFor(sourceLayer, statusCode, error),
    confidence,
    databaseProvider,
    externalEndpoint: externalEndpoint ? truncate(externalEndpoint, 500) : null,
    classificationReason: truncate(classificationReason, 4000),
    originFile,
    originLine: origin.originLine || meta.originLine || null,
    originColumn: origin.originColumn || meta.originColumn || null,
    originFunction: origin.originFunction || meta.originFunction || null,
    stackPreview: stackPreview(stack),
    context: sanitizeContext(meta.context || {}),
  };
};

module.exports = {
  SOURCE,
  classifyError,
  sanitizeContext,
  stackPreview,
};
