const crypto = require("node:crypto");
const pino = require("pino");
const pinoHttp = require("pino-http");
const telescopeRepository = require("../repositories/telescope.repository");
const { classifyError } = require("../services/errorClassifier.service");

const SENSITIVE_QUERY_KEYS = ["token", "access_token", "refresh_token", "password", "secret", "cookie", "authorization"];
const SENSITIVE_HEADER_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-google-access-token",
  "x-google-refresh-token",
];
const SENSITIVE_PAYLOAD_KEYS = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "secret",
  "privateKey",
  "apiKey",
];
const MAX_PATH_LENGTH = 500;
const MAX_ROUTE_LENGTH = 255;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_STACK_LENGTH = 6000;
const MAX_FIELD_LENGTH = 4000;
const MAX_CAPTURED_ARRAY_ITEMS = 25;
const MAX_CAPTURED_OBJECT_KEYS = 80;

const logger = pino({
  level: process.env.TELESCOPE_LOG_LEVEL || process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-google-access-token",
      "req.headers.x-google-refresh-token",
      "password",
      "token",
      "accessToken",
      "refreshToken",
    ],
    censor: "[Redacted]",
  },
});

const httpLogger = pinoHttp({
  logger,
  autoLogging: false,
  genReqId: (req) => req.headers["x-request-id"] || crypto.randomUUID(),
});

const truncate = (value, maxLength) => {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const isSensitiveQueryKey = (key) => {
  const normalized = String(key || "").toLowerCase();
  return SENSITIVE_QUERY_KEYS.some((sensitive) => normalized.includes(sensitive));
};

const isSensitiveHeaderKey = (key) => {
  const normalized = String(key || "").toLowerCase();
  return SENSITIVE_HEADER_KEYS.some((sensitive) => normalized === sensitive);
};

const isSensitivePayloadKey = (key) => {
  const normalized = String(key || "").toLowerCase();
  return SENSITIVE_PAYLOAD_KEYS.some((sensitive) => normalized.includes(sensitive.toLowerCase()));
};

const looksLikeBinaryPayload = (key, value) => {
  const normalizedKey = String(key || "").toLowerCase();
  const text = typeof value === "string" ? value : "";
  return (
    text.startsWith("data:") ||
    text.length > MAX_FIELD_LENGTH && /(base64|image|pdf|file|blob|binary|attachment)/i.test(normalizedKey)
  );
};

const sanitizePath = (rawPath = "") => {
  try {
    const url = new URL(rawPath, "http://qbank.local");
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, "[Redacted]");
      }
    }
    return truncate(`${url.pathname}${url.search}`, MAX_PATH_LENGTH);
  } catch {
    return truncate(String(rawPath || "").replace(/(access_token|refresh_token|token)=([^&]+)/gi, "$1=[Redacted]"), MAX_PATH_LENGTH);
  }
};

const sanitizeHeaders = (headers = {}) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (isSensitiveHeaderKey(key)) {
      sanitized[key] = "[Redacted]";
      continue;
    }

    if (Array.isArray(value)) {
      sanitized[key] = value.map((entry) => truncate(entry, MAX_FIELD_LENGTH));
    } else {
      sanitized[key] = truncate(value, MAX_FIELD_LENGTH);
    }
  }
  return sanitized;
};

const sanitizePayload = (value, depth = 0, key = "") => {
  if (value === null || value === undefined) return null;

  if (isSensitivePayloadKey(key)) {
    return "[Redacted]";
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer omitted: ${value.length} bytes]`;
  }

  if (typeof value === "string") {
    if (looksLikeBinaryPayload(key, value)) {
      return `[Binary payload omitted: ${value.length} chars]`;
    }
    return truncate(value, MAX_FIELD_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= 5) return "[Nested value truncated]";

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_CAPTURED_ARRAY_ITEMS).map((item) => sanitizePayload(item, depth + 1, key));
    if (value.length > MAX_CAPTURED_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_CAPTURED_ARRAY_ITEMS} more item(s) omitted]`);
    }
    return items;
  }

  if (typeof value === "object") {
    const output = {};
    const entries = Object.entries(value).slice(0, MAX_CAPTURED_OBJECT_KEYS);
    for (const [entryKey, entryValue] of entries) {
      output[entryKey] = sanitizePayload(entryValue, depth + 1, entryKey);
    }
    const omitted = Object.keys(value).length - entries.length;
    if (omitted > 0) output._omitted = `${omitted} key(s) omitted`;
    return output;
  }

  return truncate(value, MAX_FIELD_LENGTH);
};

const sanitizeQuery = (query = {}) => {
  const output = {};
  for (const [key, value] of Object.entries(query || {})) {
    output[key] = isSensitiveQueryKey(key) ? "[Redacted]" : sanitizePayload(value, 0, key);
  }
  return output;
};

const getUploadedFileMeta = (req) => {
  const fileMeta = (file) => ({
    fieldName: file.fieldname,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  });

  if (req.file) return [fileMeta(req.file)];
  if (Array.isArray(req.files)) return req.files.map(fileMeta);
  if (req.files && typeof req.files === "object") {
    return Object.values(req.files).flat().map(fileMeta);
  }
  return [];
};

const getRequestPayload = (req) => {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  const uploadedFiles = getUploadedFileMeta(req);

  if (contentType.includes("multipart/form-data")) {
    return {
      _type: "multipart/form-data",
      note: "File contents are omitted by Telescope.",
      fields: sanitizePayload(req.body || {}),
      files: uploadedFiles,
    };
  }

  if (!req.body || Object.keys(req.body || {}).length === 0) {
    return uploadedFiles.length ? { files: uploadedFiles } : null;
  }

  return sanitizePayload(req.body);
};

const parseResponseBody = (body, headers = {}) => {
  if (body === null || body === undefined) return "Empty Response";

  const contentType = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();

  if (Buffer.isBuffer(body)) {
    return `[Buffer response omitted: ${body.length} bytes]`;
  }

  if (typeof body === "object") {
    return sanitizePayload(body);
  }

  const text = String(body);
  if (!text) return "Empty Response";

  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return sanitizePayload(JSON.parse(text));
    } catch {
      return truncate(text, MAX_FIELD_LENGTH);
    }
  }

  if (contentType.includes("text/plain")) {
    return truncate(text, MAX_FIELD_LENGTH);
  }

  if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return sanitizePayload(JSON.parse(text));
    } catch {
      return truncate(text, MAX_FIELD_LENGTH);
    }
  }

  if (contentType.includes("text/html")) return "HTML Response";

  return truncate(text, MAX_FIELD_LENGTH);
};

const buildTags = (payload) => {
  const tags = [
    `method:${payload.method}`,
    `status:${payload.statusCode}`,
  ];
  if (payload.userId) tags.push(`user:${payload.userId}`);
  if (payload.userRole) tags.push(`role:${payload.userRole}`);
  if (payload.statusCode >= 400) tags.push("failed");
  if (payload.durationMs >= 1000) tags.push("slow");
  return tags;
};

const shouldSkip = (req) => {
  const path = req.originalUrl || req.url || "";
  if (!path.startsWith("/api")) return true;
  if (path.startsWith("/api/telescope")) return true;
  if (path.startsWith("/api/extraction/") && req.method === "GET" && path.includes("assets/")) return true;
  if (path.startsWith("/api/lb-workflow/") && req.method === "GET" && path.includes("assets/")) return true;
  return false;
};

const getIpAddress = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (Array.isArray(forwardedFor)) return forwardedFor[0];
  if (forwardedFor) return String(forwardedFor).split(",")[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
};

const getRouteName = (req) => {
  const baseUrl = req.baseUrl || "";
  const routePath = req.route?.path || "";
  const route = `${baseUrl}${routePath}`;
  return route ? truncate(route, MAX_ROUTE_LENGTH) : null;
};

const getTraceId = (req, fallback) => {
  const headerTraceId = req.headers["x-trace-id"];
  if (Array.isArray(headerTraceId)) return truncate(headerTraceId[0], 80);
  if (headerTraceId) return truncate(headerTraceId, 80);
  return fallback;
};

const getClientRoute = (req) => {
  const route = req.headers["x-client-route"];
  if (Array.isArray(route)) return truncate(route[0], MAX_PATH_LENGTH);
  return route ? truncate(route, MAX_PATH_LENGTH) : null;
};

const getUserMeta = (req) => ({
  userId: req.user?.id ? Number.parseInt(req.user.id, 10) : null,
  userRole: req.user?.role ? truncate(req.user.role, 40) : null,
  userEmail: req.user?.email ? truncate(req.user.email, 255) : null,
});

const writeSafely = (write) => {
  setImmediate(() => {
    write().catch((error) => {
      logger.warn({ err: error }, "Failed to write Telescope log");
    });
  });
};

const telescopeRequestLogger = (req, res, next) => {
  if (shouldSkip(req)) return next();

  httpLogger(req, res, () => {
    const startedAt = process.hrtime.bigint();
    const requestId = req.id || crypto.randomUUID();
    const traceId = getTraceId(req, requestId);
    let responseBody = null;
    const originalSend = res.send;

    res.send = function telescopeSend(body) {
      responseBody = body;
      return originalSend.call(this, body);
    };

    req.telescopeRequestId = requestId;
    req.telescopeTraceId = traceId;
    if (!res.getHeader("x-request-id")) {
      res.setHeader("x-request-id", requestId);
    }
    if (!res.getHeader("x-trace-id")) {
      res.setHeader("x-trace-id", traceId);
    }

    res.on("finish", () => {
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      const payload = {
        requestId,
        traceId,
        method: truncate(req.method, 12),
        path: sanitizePath(req.originalUrl || req.url),
        route: getRouteName(req),
        frontendRoute: getClientRoute(req),
        statusCode: res.statusCode,
        durationMs,
        ...getUserMeta(req),
        ipAddress: truncate(getIpAddress(req), 120),
        userAgent: truncate(req.headers["user-agent"], MAX_USER_AGENT_LENGTH),
        queryParams: sanitizeQuery(req.query),
        requestHeaders: sanitizeHeaders(req.headers),
        requestPayload: getRequestPayload(req),
        responseHeaders: sanitizeHeaders(res.getHeaders()),
        responseBody: parseResponseBody(responseBody, res.getHeaders()),
        memoryMb: Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10,
      };
      payload.tags = buildTags(payload);

      writeSafely(() => telescopeRepository.createRequestLog(payload));
      req.log?.info({ statusCode: res.statusCode, durationMs, path: payload.path }, "API request completed");
    });

    next();
  });
};

const recordTelescopeError = (err, req, statusCode, meta = {}) => {
  if (!req || shouldSkip(req)) return;

  const classification = classifyError(err, {
    ...meta,
    req,
    statusCode,
    context: {
      ...(meta.context || {}),
      requestId: req.telescopeRequestId || req.id || null,
      traceId: req.telescopeTraceId || getTraceId(req, req.telescopeRequestId || req.id || null),
      route: getRouteName(req),
      clientRoute: getClientRoute(req),
    },
  });

  const payload = {
    requestId: req.telescopeRequestId || req.id || null,
    traceId: req.telescopeTraceId || getTraceId(req, req.telescopeRequestId || req.id || null),
    method: truncate(req.method || "UNKNOWN", 12),
    path: sanitizePath(req.originalUrl || req.url),
    statusCode,
    message: truncate(err?.message || "Internal Server Error", MAX_STACK_LENGTH),
    stack: err?.stack ? truncate(err.stack, MAX_STACK_LENGTH) : null,
    ...getUserMeta(req),
    ipAddress: truncate(getIpAddress(req), 120),
    userAgent: truncate(req.headers?.["user-agent"], MAX_USER_AGENT_LENGTH),
    frontendRoute: getClientRoute(req),
    backendRoute: getRouteName(req),
    ...classification,
  };

  writeSafely(() => telescopeRepository.createErrorLog(payload));
};

module.exports = {
  logger,
  recordTelescopeError,
  telescopeRequestLogger,
};
