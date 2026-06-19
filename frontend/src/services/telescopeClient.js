const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
const MAX_STACK_LENGTH = 6000
const MAX_FIELD_LENGTH = 1000
const RECENT_WINDOW_MS = 8000

let lastUserAction = null
const recentReports = new Map()

export const createTraceId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `trace-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const getCurrentClientRoute = () => {
  const path = window.location.pathname || '/'
  return `${path}${window.location.search || ''}${window.location.hash || ''}`
}

const truncate = (value, maxLength = MAX_FIELD_LENGTH) => {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

const normalizeError = (error) => {
  if (!error) return { message: 'Unknown frontend error', stack: '' }
  if (typeof error === 'string') return { message: error, stack: '' }
  if (error.reason) return normalizeError(error.reason)

  return {
    message: error.message || String(error),
    stack: error.stack || '',
    name: error.name || error.constructor?.name || 'FrontendError',
  }
}

const sanitizedContext = (value, depth = 0, key = '') => {
  if (value === null || value === undefined) return null
  if (/(password|token|secret|cookie|authorization|apikey|privatekey)/i.test(key)) return '[Redacted]'
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 4) return '[Nested value truncated]'
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizedContext(item, depth + 1, key))

  if (typeof value === 'object') {
    const output = {}
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, 50)) {
      output[entryKey] = sanitizedContext(entryValue, depth + 1, entryKey)
    }
    return output
  }

  return truncate(value)
}

const getActionLabel = (target) => {
  if (!target) return null
  const el = target.closest?.('button, a, input, select, textarea, [role="button"], [data-action]')
  if (!el) return null

  const label =
    el.getAttribute('aria-label') ||
    el.getAttribute('data-action') ||
    el.name ||
    el.value ||
    el.textContent ||
    el.tagName

  return truncate(label?.replace(/\s+/g, ' ').trim(), 255)
}

export const rememberUserAction = (event) => {
  const label = getActionLabel(event.target)
  if (!label) return

  lastUserAction = {
    label,
    route: getCurrentClientRoute(),
    at: new Date().toISOString(),
  }
}

const shouldSkipDuplicate = (payload) => {
  const key = `${payload.message}|${payload.frontendRoute}|${payload.stackPreview?.slice(0, 120)}`
  const now = Date.now()
  const previous = recentReports.get(key) || 0
  recentReports.set(key, now)

  for (const [entryKey, timestamp] of recentReports.entries()) {
    if (now - timestamp > RECENT_WINDOW_MS) recentReports.delete(entryKey)
  }

  return now - previous < RECENT_WINDOW_MS
}

export const reportFrontendError = async (error, meta = {}) => {
  const normalized = normalizeError(error)
  const traceId = meta.traceId || createTraceId()
  const stackPreview = truncate(normalized.stack, MAX_STACK_LENGTH)
  const payload = {
    traceId,
    requestId: meta.requestId || traceId,
    message: truncate(normalized.message, 6000),
    errorType: truncate(normalized.name, 160),
    stack: stackPreview,
    stackPreview,
    frontendRoute: meta.frontendRoute || getCurrentClientRoute(),
    componentName: meta.componentName || null,
    info: truncate(meta.info, 500),
    userAction: meta.userAction || lastUserAction?.label || null,
    statusCode: meta.statusCode || null,
    method: meta.method || 'FRONTEND',
    api: sanitizedContext(meta.api || null),
    context: sanitizedContext({
      ...meta.context,
      lastUserAction,
    }),
    browser: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      online: navigator.onLine,
    },
  }

  if (shouldSkipDuplicate(payload)) return null

  const headers = {
    'Content-Type': 'application/json',
    'x-trace-id': traceId,
    'x-client-route': payload.frontendRoute,
  }

  const accessToken = localStorage.getItem('accessToken')
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  try {
    const response = await fetch(`${API_BASE_URL}/telescope/frontend-errors`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: true,
    })
    return response.ok ? response.json().catch(() => null) : null
  } catch {
    return null
  }
}

export const reportApiNetworkError = (error) => {
  const config = error?.config || {}
  return reportFrontendError(error, {
    traceId: config.metadata?.traceId,
    method: 'API',
    info: 'Axios request failed before a backend response was received.',
    api: {
      method: config.method?.toUpperCase(),
      url: config.url,
      baseURL: config.baseURL,
      timeout: config.timeout,
    },
    context: {
      errorCode: error?.code,
      clientRoute: config.metadata?.clientRoute,
    },
  })
}

export const installFrontendTelemetry = (app, router) => {
  document.addEventListener('click', rememberUserAction, true)

  app.config.errorHandler = (error, instance, info) => {
    reportFrontendError(error, {
      info,
      componentName: instance?.type?.name || instance?.type?.__name || null,
    })
    console.error(error)
  }

  window.addEventListener('error', (event) => {
    reportFrontendError(event.error || event.message, {
      info: 'window.onerror',
      context: {
        filename: event.filename,
        lineNo: event.lineno,
        columnNo: event.colno,
      },
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportFrontendError(event.reason || 'Unhandled promise rejection', {
      info: 'window.unhandledrejection',
    })
  })

  router.onError((error, to) => {
    reportFrontendError(error, {
      info: 'Vue router error',
      frontendRoute: to?.fullPath || getCurrentClientRoute(),
    })
  })
}
