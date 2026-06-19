const { Readable } = require("node:stream");

const REQUEST_TIMEOUT_MS = Number(process.env.EXTRACTION_PROXY_TIMEOUT_MS || 600000);
const STATUS_TIMEOUT_MS = Number(process.env.EXTRACTION_STATUS_TIMEOUT_MS || 2500);

const SERVICE_TARGETS = {
  standard: process.env.EXTRACTION_STANDARD_API_BASE || "http://127.0.0.1:8070",
  language: process.env.EXTRACTION_LANGUAGE_API_BASE || "http://127.0.0.1:8090",
  "question-crafter": process.env.EXTRACTION_QUESTION_CRAFTER_API_BASE || "http://127.0.0.1:8100",
};

const BLOCKED_REQUEST_HEADERS = new Set([
  "authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const BLOCKED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const getServiceTarget = (service) => {
  const target = SERVICE_TARGETS[service];
  if (!target) {
    const err = new Error(`Unknown extraction service: ${service}`);
    err.statusCode = 404;
    throw err;
  }
  return target;
};

const buildTargetUrl = (service, proxyPath, rawQuery = "") => {
  const target = new URL(getServiceTarget(service));
  const basePath = target.pathname.replace(/\/+$/, "");
  const cleanPath = String(proxyPath || "").replace(/^\/+/, "");
  target.pathname = cleanPath ? `${basePath}/${cleanPath}` : `${basePath}/`;

  const searchParams = new URLSearchParams(rawQuery);
  searchParams.delete("access_token");
  target.search = searchParams.toString();

  return target.toString();
};

const copyRequestHeaders = (req, hasBody) => {
  const headers = {};

  for (const [key, value] of Object.entries(req.headers)) {
    const normalizedKey = key.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(normalizedKey)) continue;
    if (!hasBody && normalizedKey === "content-type") continue;
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }

  if (req.user?.id) headers["x-qbank-user-id"] = String(req.user.id);
  if (req.user?.role) headers["x-qbank-user-role"] = String(req.user.role);

  return headers;
};

const readRequestBody = async (req) => {
  if (req.method === "GET" || req.method === "HEAD") return undefined;

  if (req.is("application/json") && req.body !== undefined) {
    return Buffer.from(JSON.stringify(req.body));
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const copyResponseHeaders = (upstream, res) => {
  upstream.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "set-cookie") return;
    if (BLOCKED_RESPONSE_HEADERS.has(normalizedKey)) return;
    res.setHeader(key, value);
  });

  if (typeof upstream.headers.getSetCookie === "function") {
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length > 0) {
      res.setHeader("set-cookie", cookies);
      return;
    }
  }

  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) res.setHeader("set-cookie", setCookie);
};

const pipeResponseBody = async (upstream, res) => {
  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body);
  await new Promise((resolve, reject) => {
    nodeStream.on("error", reject);
    res.on("error", reject);
    res.on("finish", resolve);
    nodeStream.pipe(res);
  });
};

const proxy = async ({ req, res, service, proxyPath, rawQuery }) => {
  const body = await readRequestBody(req);
  const hasBody = body !== undefined;
  const targetUrl = buildTargetUrl(service, proxyPath, rawQuery);
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers: copyRequestHeaders(req, hasBody),
    body,
    redirect: "manual",
    signal: timeoutSignal,
  });

  res.status(upstream.status);
  copyResponseHeaders(upstream, res);
  await pipeResponseBody(upstream, res);
};

const checkTargetStatus = async ([service, target]) => {
  const startedAt = Date.now();

  try {
    const response = await fetch(target, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });

    return {
      service,
      target,
      online: true,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      service,
      target,
      online: false,
      error: error.name === "TimeoutError" ? "Timed out" : "Not reachable",
      latencyMs: Date.now() - startedAt,
    };
  }
};

const getStatus = async () => {
  const services = await Promise.all(Object.entries(SERVICE_TARGETS).map(checkTargetStatus));
  const online = services.length > 0 && services.every((service) => service.online);

  return {
    online,
    status: online ? "online" : "offline",
    checkedAt: new Date().toISOString(),
    services,
  };
};

const getTargets = () => ({ ...SERVICE_TARGETS });

module.exports = {
  getStatus,
  getTargets,
  proxy,
};
