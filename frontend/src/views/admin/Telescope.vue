<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import api from '../../services/api'
import { createPagination, unpackPaginated, PAGE_SIZE_OPTIONS } from '../../utils/pagination'

const router = useRouter()
const authStore = useAuthStore()
const userRole = computed(() => authStore.userRole)

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'requests', label: 'Requests' },
  { id: 'errors', label: 'Errors' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'services', label: 'Extraction' },
  { id: 'reviews', label: 'Extraction Reviews' },
  { id: 'data-health', label: 'Data Health' },
  { id: 'audit-logs', label: 'Audit Logs' },
]

const activeTab = ref('overview')
const loading = ref(false)
const errorMessage = ref('')
const summary = ref(null)
const services = ref(null)
const dataHealth = ref(null)
const requests = ref([])
const errors = ref([])
const jobs = ref([])
const auditLogs = ref([])
const selectedRequest = ref(null)
const selectedError = ref(null)
const requestDetailLoading = ref(false)
const requestDetailError = ref('')
const errorDetailLoading = ref(false)
const errorDetailError = ref('')
const requestRequestTab = ref('payload')
const requestResponseTab = ref('response')
const errorDetailTab = ref('trace')

const requestFilters = ref({ method: 'ALL', status: 'ALL', search: '' })
const errorFilters = ref({ source: 'ALL', severity: 'ALL', status: 'ALL', search: '' })
const jobFilters = ref({ status: 'ALL' })
const auditFilters = ref({ action: 'ALL', search: '' })
const auditActions = ref([])

const paginations = ref({
  requests: createPagination(10),
  errors: createPagination(10),
  jobs: createPagination(10),
  auditLogs: createPagination(10),
})

const requestPayloadTabs = [
  { id: 'payload', label: 'Payload' },
  { id: 'headers', label: 'Headers' },
]

const responsePayloadTabs = [
  { id: 'response', label: 'Response' },
  { id: 'response_headers', label: 'Headers' },
  { id: 'auth_context', label: 'Auth Context' },
]

const errorDetailTabs = [
  { id: 'trace', label: 'Trace' },
  { id: 'context', label: 'Context' },
  { id: 'request', label: 'Request' },
  { id: 'raw', label: 'Raw' },
]

const summaryCards = computed(() => {
  const counts = summary.value?.counts || {}
  return [
    { label: 'Requests 24h', value: counts.requests24h ?? 0 },
    { label: 'Errors 24h', value: counts.errors24h ?? 0 },
    { label: 'Avg Duration', value: `${counts.averageDurationMs ?? 0} ms` },
    { label: 'Failed Jobs', value: counts.failedJobs ?? 0 },
    { label: 'Running Jobs', value: counts.runningJobs ?? 0 },
    { label: 'Pending Reviews', value: counts.pendingReviews ?? 0 },
  ]
})

const dataCards = computed(() => {
  const totals = dataHealth.value?.totals || {}
  return [
    { label: 'Questions', value: totals.questions ?? 0 },
    { label: 'Uploads', value: totals.uploads ?? 0 },
    { label: 'Pending Reviews', value: totals.pendingReviews ?? 0 },
    { label: 'Approved Reviews', value: totals.approvedReviews ?? 0 },
    { label: 'Rejected Reviews', value: totals.rejectedReviews ?? 0 },
    { label: 'Failed Jobs', value: totals.failedJobs ?? 0 },
  ]
})

const selectedRequestAttributes = computed(() => {
  const request = selectedRequest.value
  if (!request) return []

  return [
    { label: 'Time', value: `${formatDate(request.createdAt)}` },
    { label: 'Request ID', value: request.requestId || 'N/A' },
    { label: 'Method', value: request.method, badge: 'method' },
    { label: 'Controller Action', value: request.route || 'N/A' },
    { label: 'Path', value: request.path || 'N/A' },
    { label: 'Status', value: request.statusCode, badge: 'status' },
    { label: 'Duration', value: `${request.durationMs || 0} ms` },
    { label: 'IP Address', value: request.ipAddress || 'N/A' },
    { label: 'Memory usage', value: request.memoryMb ? `${request.memoryMb} MB` : 'Not captured' },
    { label: 'User', value: request.userEmail || request.userRole || 'Guest/System' },
    { label: 'User Agent', value: request.userAgent || 'N/A' },
  ]
})

const currentRequestPayload = computed(() => {
  const request = selectedRequest.value
  if (!request) return null

  if (requestRequestTab.value === 'headers') return request.requestHeaders

  return {
    query: request.queryParams || {},
    payload: request.requestPayload || null,
  }
})

const currentResponsePayload = computed(() => {
  const request = selectedRequest.value
  if (!request) return null

  if (requestResponseTab.value === 'response_headers') return request.responseHeaders
  if (requestResponseTab.value === 'auth_context') return currentAuthContext.value
  return request.responseBody
})

const currentAuthContext = computed(() => {
  const request = selectedRequest.value
  if (!request) return null

  return {
    authentication: {
      strategy: 'JWT bearer token',
      serverSession: 'Not used by this Express application',
      authenticated: Boolean(request.userId || request.userEmail || request.userRole),
      userId: request.userId || null,
      userEmail: request.userEmail || null,
      role: request.userRole || null,
    },
    request: {
      requestId: request.requestId || null,
      method: request.method || null,
      path: request.path || null,
      route: request.route || null,
      statusCode: request.statusCode || null,
      durationMs: request.durationMs || 0,
      ipAddress: request.ipAddress || null,
      userAgent: request.userAgent || null,
      memoryMb: request.memoryMb || null,
      happenedAt: request.createdAt || null,
      tags: request.tags || [],
    },
    privacy: {
      authorizationHeader: 'Not stored',
      cookies: 'Not stored',
      rawTokens: 'Not stored',
      uploadedFiles: 'Not stored in request logs',
    },
  }
})

const selectedErrorAttributes = computed(() => {
  const item = selectedError.value
  if (!item) return []

  return [
    { label: 'Time', value: formatDate(item.createdAt) },
    { label: 'Error ID', value: item.id ? `#${item.id}` : 'N/A' },
    { label: 'Trace ID', value: item.traceId || 'N/A' },
    { label: 'Request ID', value: item.requestId || 'N/A' },
    { label: 'Source', value: item.sourceLayer || 'UNKNOWN', badge: 'source' },
    { label: 'Severity', value: item.severity || 'LOW', badge: 'severity' },
    { label: 'Confidence', value: item.confidence || 'LOW', badge: 'confidence' },
    { label: 'Status', value: item.statusCode || 500, badge: 'status' },
    { label: 'Method', value: item.method || 'N/A', badge: 'method' },
    { label: 'Path', value: item.path || 'N/A' },
    { label: 'Frontend Route', value: item.frontendRoute || 'N/A' },
    { label: 'Backend Route', value: item.backendRoute || 'N/A' },
    { label: 'Origin', value: formatOrigin(item) },
    { label: 'Module', value: item.sourceModule || 'N/A' },
    { label: 'Service', value: item.sourceService || item.databaseProvider || item.externalEndpoint || 'N/A' },
    { label: 'Error Code', value: item.errorCode || 'N/A' },
    { label: 'Error Type', value: item.errorType || 'N/A' },
    { label: 'User', value: item.userEmail || item.userRole || 'Guest/System' },
    { label: 'User Action', value: item.userAction || 'N/A' },
    { label: 'IP Address', value: item.ipAddress || 'N/A' },
    { label: 'User Agent', value: item.userAgent || 'N/A' },
    { label: 'Classification', value: item.classificationReason || 'N/A' },
  ]
})

const currentErrorDetailPayload = computed(() => {
  const item = selectedError.value
  if (!item) return null

  if (errorDetailTab.value === 'context') return item.context || null
  if (errorDetailTab.value === 'request') {
    return {
      traceId: item.traceId || null,
      requestId: item.requestId || null,
      method: item.method || null,
      path: item.path || null,
      statusCode: item.statusCode || null,
      frontendRoute: item.frontendRoute || null,
      backendRoute: item.backendRoute || null,
      user: {
        id: item.userId || null,
        email: item.userEmail || null,
        role: item.userRole || null,
      },
      client: {
        ipAddress: item.ipAddress || null,
        userAgent: item.userAgent || null,
      },
    }
  }
  if (errorDetailTab.value === 'raw') return item
  return item.stackPreview || item.stack || 'No exception trace was captured for this error.'
})

onMounted(async () => {
  await refreshOverview()
})

const setTab = async (tabId) => {
  activeTab.value = tabId
  if (tabId === 'overview') return refreshOverview()
  if (tabId === 'requests') return fetchRequests()
  if (tabId === 'errors') return fetchErrors()
  if (tabId === 'jobs') return fetchJobs()
  if (tabId === 'services') return fetchServices()
  if (tabId === 'reviews') return fetchDataHealth()
  if (tabId === 'data-health') return fetchDataHealth()
  if (tabId === 'audit-logs') return fetchAuditLogs()
}

const runLoading = async (task) => {
  loading.value = true
  errorMessage.value = ''
  try {
    await task()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to load Telescope data.'
  } finally {
    loading.value = false
  }
}

const refreshCurrent = async () => {
  await setTab(activeTab.value)
}

const refreshOverview = () => runLoading(async () => {
  const [summaryResponse, servicesResponse, dataHealthResponse] = await Promise.all([
    api.get('/telescope/summary'),
    api.get('/telescope/services'),
    api.get('/telescope/data-health'),
  ])
  summary.value = summaryResponse.data
  services.value = servicesResponse.data
  dataHealth.value = dataHealthResponse.data
})

const fetchServices = () => runLoading(async () => {
  const response = await api.get('/telescope/services')
  services.value = response.data
})

const fetchDataHealth = () => runLoading(async () => {
  const response = await api.get('/telescope/data-health')
  dataHealth.value = response.data
})

const fetchRequests = (page = paginations.value.requests.page) => runLoading(async () => {
  const response = await api.get('/telescope/requests', {
    params: {
      page,
      pageSize: paginations.value.requests.pageSize,
      ...requestFilters.value,
    },
  })
  const unpacked = unpackPaginated(response.data, { ...paginations.value.requests, page })
  requests.value = unpacked.rows
  paginations.value.requests = unpacked.pagination
})

const openRequestDetail = async (request) => {
  selectedRequest.value = request
  requestRequestTab.value = 'payload'
  requestResponseTab.value = 'response'
  requestDetailError.value = ''
  requestDetailLoading.value = true

  try {
    const response = await api.get(`/telescope/requests/${request.id}`)
    selectedRequest.value = response.data
  } catch (err) {
    requestDetailError.value = err.response?.data?.error || 'Unable to load request details.'
  } finally {
    requestDetailLoading.value = false
  }
}

const closeRequestDetail = () => {
  selectedRequest.value = null
  requestDetailError.value = ''
  requestDetailLoading.value = false
  requestRequestTab.value = 'payload'
  requestResponseTab.value = 'response'
}

const fetchErrors = (page = paginations.value.errors.page) => runLoading(async () => {
  selectedError.value = null
  errorDetailError.value = ''
  errorDetailTab.value = 'trace'
  const response = await api.get('/telescope/errors', {
    params: {
      page,
      pageSize: paginations.value.errors.pageSize,
      ...errorFilters.value,
    },
  })
  const unpacked = unpackPaginated(response.data, { ...paginations.value.errors, page })
  errors.value = unpacked.rows
  paginations.value.errors = unpacked.pagination
})

const openErrorDetail = async (item) => {
  selectedError.value = item
  errorDetailError.value = ''
  errorDetailTab.value = 'trace'
  errorDetailLoading.value = true

  try {
    const response = await api.get(`/telescope/errors/${item.id}`)
    selectedError.value = response.data
  } catch (err) {
    errorDetailError.value = err.response?.data?.error || 'Unable to load exception details.'
  } finally {
    errorDetailLoading.value = false
  }
}

const closeErrorDetail = () => {
  selectedError.value = null
  errorDetailError.value = ''
  errorDetailLoading.value = false
  errorDetailTab.value = 'trace'
}

const openErrorFromRequest = async (item) => {
  selectedRequest.value = null
  activeTab.value = 'errors'
  await openErrorDetail(item)
}

const openRequestFromError = async (item) => {
  selectedError.value = null
  errorDetailError.value = ''
  activeTab.value = 'requests'
  await openRequestDetail(item)
}

const fetchJobs = (page = paginations.value.jobs.page) => runLoading(async () => {
  const response = await api.get('/telescope/jobs', {
    params: {
      page,
      pageSize: paginations.value.jobs.pageSize,
      ...jobFilters.value,
    },
  })
  const unpacked = unpackPaginated(response.data, { ...paginations.value.jobs, page })
  jobs.value = unpacked.rows
  paginations.value.jobs = unpacked.pagination
})

const fetchAuditLogs = (page = paginations.value.auditLogs.page) => runLoading(async () => {
  const response = await api.get('/telescope/audit-logs', {
    params: {
      page,
      pageSize: paginations.value.auditLogs.pageSize,
      ...auditFilters.value,
    },
  })
  const unpacked = unpackPaginated(response.data, { ...paginations.value.auditLogs, page })
  auditLogs.value = unpacked.rows
  paginations.value.auditLogs = unpacked.pagination
  auditActions.value = unpacked.extra?.actions || auditActions.value
})

const downloadDiagnostics = async () => {
  errorMessage.value = ''
  try {
    const response = await api.get('/telescope/diagnostics/export', { responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `qbank-telescope-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to export diagnostics.'
  }
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const formatDate = (dateString) => {
  if (!dateString) return 'N/A'
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const formatMemory = (bytes) => {
  const value = Number(bytes || 0)
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${Math.round(value / 1024 / 1024)} MB`
}

const formatJson = (value) => {
  if (value === null || value === undefined || value === '') return 'Not captured for this request.'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}

const truncateText = (value, maxLength = 68) => {
  const text = String(value || '')
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

const hasCapturedValue = (value) => {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value).length > 0
  return true
}

const statusClass = (statusCode) => {
  const code = Number(statusCode || 0)
  if (code >= 500) return 'status-error'
  if (code >= 400) return 'status-warning'
  if (code >= 300) return 'status-muted'
  return 'status-ok'
}

const sourceClass = (sourceLayer) => {
  const source = String(sourceLayer || '').toUpperCase()
  if (source === 'DATABASE') return 'source-database'
  if (source === 'FRONTEND') return 'source-frontend'
  if (source === 'BACKEND') return 'source-backend'
  if (source === 'AUTH') return 'source-auth'
  if (source === 'EXTERNAL_SERVICE') return 'source-external'
  if (source === 'JOB_WORKER') return 'source-job'
  if (source === 'NETWORK') return 'source-network'
  return 'status-muted'
}

const confidenceClass = (confidence) => {
  const normalized = String(confidence || '').toUpperCase()
  if (normalized === 'HIGH') return 'status-ok'
  if (normalized === 'MEDIUM') return 'status-warning'
  return 'status-muted'
}

const severityClass = (severity) => {
  const normalized = String(severity || '').toUpperCase()
  if (normalized === 'HIGH' || normalized === 'CRITICAL') return 'status-error'
  if (normalized === 'MEDIUM') return 'status-warning'
  return 'status-muted'
}

const formatOrigin = (item) => {
  if (!item?.originFile) return 'Origin not captured'
  const position = item.originLine
    ? `:${item.originLine}${item.originColumn ? `:${item.originColumn}` : ''}`
    : ''
  const fn = item.originFunction ? ` (${item.originFunction})` : ''
  return `${item.originFile}${position}${fn}`
}

const jobStatusClass = (status) => {
  const normalized = String(status || '').toLowerCase()
  if (normalized === 'failed') return 'status-error'
  if (normalized === 'completed') return 'status-ok'
  if (normalized === 'processing' || normalized === 'pending') return 'status-warning'
  return 'status-muted'
}

const serviceStatusClass = (online) => online ? 'status-ok' : 'status-error'
</script>

<template>
  <div class="dashboard-wrapper">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-logo">Q</div>
        <span class="brand-name">QBank Platform</span>
      </div>

      <nav class="sidebar-nav">
        <router-link to="/dashboard" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
          Dashboard
        </router-link>
        <router-link to="/questions" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Question Bank
        </router-link>
        <router-link to="/manage-questions" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/></svg>
          Manage Questions
        </router-link>
        <router-link to="/manage-multi-questions" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><rect x="4" y="4" width="16" height="5" rx="1"/><rect x="4" y="11" width="16" height="9" rx="1"/><path d="M8 14h8M8 17h5"/></svg>
          Manage Multi Questions
        </router-link>
        <router-link to="/extraction" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
          Extraction
        </router-link>
        <router-link to="/evaluator-bulk-upload" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
          Evaluator Bulk Upload
        </router-link>
        <router-link to="/test-papers" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Test Papers
        </router-link>
        <router-link to="/assessment-builder" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h3"/></svg>
          Assessment Builder
        </router-link>
        <router-link to="/subjects" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          Subjects & Chapters
        </router-link>
        <router-link to="/admin/users" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          User Manager
        </router-link>
        <router-link to="/reviews" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Extraction Reviews
        </router-link>
        <router-link to="/admin/audit-logs" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Audit Logs
        </router-link>
        <router-link to="/telescope" class="nav-item active" v-if="userRole === 'ADMIN'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="M12 3v6"/><path d="M12 15v6"/></svg>
          Telescope
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="user-avatar">
            {{ authStore.user?.name ? authStore.user.name.charAt(0) : 'U' }}
          </div>
          <div class="user-info">
            <span class="user-name" :title="authStore.user?.name">{{ authStore.user?.name || 'User Name' }}</span>
            <span class="user-role badge" :class="`badge-${userRole?.toLowerCase()}`">{{ userRole || 'TEACHER' }}</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" @click="handleLogout" style="width: 100%;">
          Sign Out
        </button>
      </div>
    </aside>

    <main class="main-content">
      <header class="header">
        <h2 class="page-title">Telescope</h2>
        <div class="header-actions telescope-header-actions">
          <button class="btn btn-secondary btn-sm" type="button" :disabled="loading" @click="refreshCurrent">
            Refresh
          </button>
          <button class="btn btn-primary btn-sm" type="button" @click="downloadDiagnostics">
            Download Diagnostics
          </button>
        </div>
      </header>

      <div class="content-body fade-in-el">
        <div v-if="errorMessage" class="alert alert-error telescope-alert">
          <span>{{ errorMessage }}</span>
        </div>

        <div class="telescope-tabs" role="tablist">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="telescope-tab"
            :class="{ active: activeTab === tab.id }"
            @click="setTab(tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>

        <div v-if="loading" class="spinner-container telescope-loading">
          <div class="spinner"></div>
          <div class="spinner-text">Loading Telescope data...</div>
        </div>

        <section v-else-if="activeTab === 'overview'" class="telescope-stack">
          <div class="telescope-metrics">
            <div v-for="card in summaryCards" :key="card.label" class="telescope-metric">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
            </div>
          </div>

          <div class="telescope-grid">
            <div class="telescope-panel">
              <div class="panel-heading">
                <h3>System Status</h3>
              </div>
              <div class="status-list">
                <div>
                  <span>Backend</span>
                  <strong class="status-pill status-ok">Online</strong>
                </div>
                <div>
                  <span>Database</span>
                  <strong class="status-pill" :class="summary?.database?.online ? 'status-ok' : 'status-error'">
                    {{ summary?.database?.online ? 'Online' : 'Offline' }}
                  </strong>
                </div>
                <div>
                  <span>Extraction</span>
                  <strong class="status-pill" :class="summary?.extraction?.online ? 'status-ok' : 'status-error'">
                    {{ summary?.extraction?.online ? 'Online' : 'Offline' }}
                  </strong>
                </div>
                <div>
                  <span>Uptime</span>
                  <strong>{{ summary?.backend?.uptimeSeconds || 0 }}s</strong>
                </div>
                <div>
                  <span>Memory RSS</span>
                  <strong>{{ formatMemory(summary?.backend?.memory?.rss) }}</strong>
                </div>
              </div>
            </div>

            <div class="telescope-panel">
              <div class="panel-heading">
                <h3>Recent Errors</h3>
              </div>
              <div v-if="!summary?.counts?.recentErrors?.length" class="empty-dashboard-state">
                No backend errors captured yet.
              </div>
              <div v-else class="compact-list">
                <div v-for="item in summary.counts.recentErrors" :key="item.id" class="compact-row">
                  <span class="status-pill" :class="statusClass(item.statusCode)">{{ item.statusCode || 500 }}</span>
                  <span class="compact-main">{{ item.message }}</span>
                  <span class="compact-time">{{ formatDate(item.createdAt) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="telescope-panel">
            <div class="panel-heading">
              <h3>Extraction Services</h3>
            </div>
            <table class="telescope-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="service in services?.services || []" :key="service.service">
                  <td>{{ service.service }}</td>
                  <td>{{ service.target }}</td>
                  <td><span class="status-pill" :class="serviceStatusClass(service.online)">{{ service.online ? 'Online' : 'Offline' }}</span></td>
                  <td>{{ service.latencyMs ?? 0 }} ms</td>
                </tr>
                <tr v-if="!(services?.services || []).length">
                  <td colspan="4" class="empty-cell">No extraction services configured.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-else-if="activeTab === 'requests'" class="telescope-request-console">
          <div v-if="!selectedRequest" class="telescope-index-panel telescope-request-screen">
            <div class="telescope-card-header">
              <h3>Requests</h3>
              <span>{{ paginations.requests.total }} entries</span>
            </div>

            <div class="table-toolbar telescope-index-toolbar">
              <select v-model="requestFilters.method" class="form-input" @change="fetchRequests(1)">
                <option value="ALL">All Methods</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="DELETE">DELETE</option>
              </select>
              <select v-model="requestFilters.status" class="form-input" @change="fetchRequests(1)">
                <option value="ALL">All Statuses</option>
                <option value="SUCCESS">Success</option>
                <option value="ERROR">Error</option>
                <option value="200">200</option>
                <option value="400">400</option>
                <option value="401">401</option>
                <option value="403">403</option>
                <option value="500">500</option>
              </select>
              <input v-model="requestFilters.search" class="form-input" placeholder="Search path or user" @keyup.enter="fetchRequests(1)" />
              <button class="btn btn-secondary btn-sm" type="button" @click="fetchRequests(1)">Apply</button>
            </div>

            <table class="telescope-table telescope-request-index">
              <thead>
                <tr>
                  <th>Verb</th>
                  <th>Path</th>
                  <th class="text-center">Status</th>
                  <th class="text-right">Duration</th>
                  <th>Happened</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in requests"
                  :key="item.id"
                  class="request-row"
                  :class="{ active: selectedRequest?.id === item.id }"
                  tabindex="0"
                  @click="openRequestDetail(item)"
                  @keydown.enter="openRequestDetail(item)"
                >
                  <td class="table-fit">
                    <span class="status-pill method-pill">{{ item.method }}</span>
                  </td>
                  <td class="path-cell" :title="item.path">{{ truncateText(item.path, selectedRequest ? 44 : 72) }}</td>
                  <td class="table-fit text-center">
                    <span class="status-pill" :class="statusClass(item.statusCode)">{{ item.statusCode }}</span>
                  </td>
                  <td class="table-fit text-right text-muted">{{ item.durationMs }}ms</td>
                  <td class="table-fit text-muted">{{ formatDate(item.createdAt) }}</td>
                  <td class="table-fit">
                    <button class="control-action-btn" type="button" aria-label="Open request" @click.stop="openRequestDetail(item)">
                      →
                    </button>
                  </td>
                </tr>
                <tr v-if="requests.length === 0">
                  <td colspan="6" class="empty-cell">No request logs found.</td>
                </tr>
              </tbody>
            </table>

            <div class="pagination-row telescope-index-pagination">
              <div class="page-size-control">
                <select v-model.number="paginations.requests.pageSize" class="form-input" @change="fetchRequests(1)">
                  <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
                </select>
              </div>
              <div class="pagination-controls">
                <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.requests.page <= 1" @click="fetchRequests(paginations.requests.page - 1)">Previous</button>
                <span>Page {{ paginations.requests.page }} of {{ paginations.requests.totalPages }}</span>
                <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.requests.page >= paginations.requests.totalPages" @click="fetchRequests(paginations.requests.page + 1)">Next</button>
              </div>
            </div>
          </div>

          <div v-else class="telescope-preview-stack telescope-request-screen">
            <div class="telescope-preview-card">
              <div class="telescope-card-header">
                <div>
                  <h3>Request Details</h3>
                  <p class="request-detail-title">
                    {{ selectedRequest.method }} {{ selectedRequest.path }}
                  </p>
                </div>
                <button class="control-action-link" type="button" @click="closeRequestDetail">
                  Back to requests
                </button>
              </div>

              <div v-if="requestDetailLoading" class="fetching-panel">
                <div class="spinner"></div>
                <span>Fetching...</span>
              </div>

              <div v-else-if="requestDetailError" class="fetching-panel">
                {{ requestDetailError }}
              </div>

              <table v-else class="preview-attributes-table">
                <tbody>
                  <tr v-for="row in selectedRequestAttributes" :key="row.label">
                    <td class="table-fit text-muted">{{ row.label }}</td>
                    <td>
                      <span v-if="row.badge === 'method'" class="status-pill method-pill">{{ row.value }}</span>
                      <span v-else-if="row.badge === 'status'" class="status-pill" :class="statusClass(row.value)">{{ row.value }}</span>
                      <span v-else>{{ row.value }}</span>
                    </td>
                  </tr>
                  <tr v-if="hasCapturedValue(selectedRequest.tags)">
                    <td class="table-fit text-muted">Tags</td>
                    <td>
                      <span v-for="tag in selectedRequest.tags" :key="tag" class="status-pill status-muted tag-pill">{{ tag }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="!requestDetailLoading" class="telescope-preview-card overflow-hidden">
              <ul class="preview-pill-tabs">
                <li v-for="tab in requestPayloadTabs" :key="tab.id">
                  <button
                    type="button"
                    :class="{ active: requestRequestTab === tab.id }"
                    @click="requestRequestTab = tab.id"
                  >
                    {{ tab.label }}
                  </button>
                </li>
              </ul>
              <div class="code-bg">
                <pre>{{ formatJson(currentRequestPayload) }}</pre>
              </div>
            </div>

            <div v-if="!requestDetailLoading" class="telescope-preview-card overflow-hidden">
              <ul class="preview-pill-tabs">
                <li v-for="tab in responsePayloadTabs" :key="tab.id">
                  <button
                    type="button"
                    :class="{ active: requestResponseTab === tab.id }"
                    @click="requestResponseTab = tab.id"
                  >
                    {{ tab.label }}
                  </button>
                </li>
              </ul>
              <div class="code-bg">
                <pre>{{ formatJson(currentResponsePayload) }}</pre>
              </div>
            </div>

            <div v-if="!requestDetailLoading" class="telescope-preview-card">
              <div class="telescope-card-header">
                <h3>Related Entries</h3>
                <span>{{ (selectedRequest.relatedErrors || []).length }} errors</span>
              </div>
              <div v-if="!(selectedRequest.relatedErrors || []).length" class="empty-dashboard-state">
                No backend errors were linked to this request.
              </div>
              <article v-for="item in selectedRequest.relatedErrors || []" :key="item.id" class="error-entry">
                <div class="error-meta">
                  <span class="status-pill" :class="statusClass(item.statusCode)">{{ item.statusCode || 500 }}</span>
                  <strong>{{ item.method }} {{ item.path }}</strong>
                  <span>{{ formatDate(item.createdAt) }}</span>
                  <button class="control-action-btn" type="button" aria-label="Open related exception" @click="openErrorFromRequest(item)">
                    &rarr;
                  </button>
                </div>
                <p>{{ item.message }}</p>
                <pre v-if="item.stack">{{ item.stack }}</pre>
              </article>
            </div>
          </div>

        </section>

        <section v-else-if="activeTab === 'errors'" class="telescope-panel telescope-request-console">
          <div v-if="!selectedError" class="telescope-index-panel telescope-request-screen">
            <div class="telescope-card-header">
              <h3>Exceptions</h3>
              <span>{{ paginations.errors.total }} entries</span>
            </div>
            <div class="table-toolbar telescope-index-toolbar telescope-error-toolbar">
              <select v-model="errorFilters.source" class="form-input" @change="fetchErrors(1)">
                <option value="ALL">All Sources</option>
                <option value="FRONTEND">Frontend</option>
                <option value="BACKEND">Backend</option>
                <option value="DATABASE">Database</option>
                <option value="AUTH">Auth</option>
                <option value="EXTERNAL_SERVICE">External Service</option>
                <option value="JOB_WORKER">Job Worker</option>
                <option value="NETWORK">Network</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
              <select v-model="errorFilters.severity" class="form-input" @change="fetchErrors(1)">
                <option value="ALL">All Severity</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
              <select v-model="errorFilters.status" class="form-input" @change="fetchErrors(1)">
                <option value="ALL">All Statuses</option>
                <option value="400">400</option>
                <option value="401">401</option>
                <option value="403">403</option>
                <option value="404">404</option>
                <option value="500">500</option>
              </select>
              <input v-model="errorFilters.search" class="form-input" placeholder="Search exception, path, trace" @keyup.enter="fetchErrors(1)" />
              <button class="btn btn-secondary btn-sm" type="button" @click="fetchErrors(1)">Apply</button>
            </div>

            <table class="telescope-table telescope-request-index telescope-error-index">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Exception</th>
                  <th>Status</th>
                  <th>Severity</th>
                  <th>Origin</th>
                  <th>Happened</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in errors"
                  :key="item.id"
                  class="request-row"
                  tabindex="0"
                  @click="openErrorDetail(item)"
                  @keydown.enter="openErrorDetail(item)"
                >
                  <td>
                    <span class="status-pill" :class="sourceClass(item.sourceLayer)">
                      {{ item.sourceLayer || 'UNKNOWN' }}
                    </span>
                  </td>
                  <td>
                    <strong class="compact-main">{{ truncateText(item.message, 72) }}</strong>
                    <div class="request-detail-title">{{ item.method }} {{ truncateText(item.path, 88) }}</div>
                  </td>
                  <td class="text-center">
                    <span class="status-pill" :class="statusClass(item.statusCode)">{{ item.statusCode || 500 }}</span>
                  </td>
                  <td>
                    <span class="status-pill" :class="severityClass(item.severity)">{{ item.severity || 'LOW' }}</span>
                  </td>
                  <td class="path-cell" :title="formatOrigin(item)">{{ truncateText(formatOrigin(item), 48) }}</td>
                  <td>{{ formatDate(item.createdAt) }}</td>
                  <td class="text-right">
                    <button class="control-action-btn" type="button" aria-label="Open exception" @click.stop="openErrorDetail(item)">
                      &rarr;
                    </button>
                  </td>
                </tr>
                <tr v-if="errors.length === 0">
                  <td colspan="7" class="empty-cell">No exceptions captured yet.</td>
                </tr>
              </tbody>
            </table>

            <div class="pagination-row telescope-index-pagination">
              <div class="page-size-control">
                <select v-model.number="paginations.errors.pageSize" class="form-input" @change="fetchErrors(1)">
                  <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
                </select>
              </div>
              <div class="pagination-controls">
                <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.errors.page <= 1" @click="fetchErrors(paginations.errors.page - 1)">Previous</button>
                <span>Page {{ paginations.errors.page }} of {{ paginations.errors.totalPages }}</span>
                <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.errors.page >= paginations.errors.totalPages" @click="fetchErrors(paginations.errors.page + 1)">Next</button>
              </div>
            </div>
          </div>

          <div v-else class="telescope-preview-stack">
            <div class="telescope-preview-card">
              <div class="telescope-card-header">
                <div>
                  <h3>Exception Details</h3>
                  <p class="request-detail-title">
                    {{ selectedError.sourceLayer || 'UNKNOWN' }} - {{ selectedError.method }} {{ selectedError.path }}
                  </p>
                </div>
                <button class="control-action-link" type="button" @click="closeErrorDetail">
                  Back to exceptions
                </button>
              </div>
              <div v-if="errorDetailLoading" class="fetching-panel">
                <div class="spinner"></div>
                <span>Fetching...</span>
              </div>
              <div v-else-if="errorDetailError" class="fetching-panel">
                {{ errorDetailError }}
              </div>
              <table v-else class="preview-attributes-table">
                <tbody>
                  <tr v-for="row in selectedErrorAttributes" :key="row.label">
                    <td class="table-fit text-muted">{{ row.label }}</td>
                    <td>
                      <span v-if="row.badge === 'method'" class="status-pill method-pill">{{ row.value }}</span>
                      <span v-else-if="row.badge === 'status'" class="status-pill" :class="statusClass(row.value)">{{ row.value }}</span>
                      <span v-else-if="row.badge === 'source'" class="status-pill" :class="sourceClass(row.value)">{{ row.value }}</span>
                      <span v-else-if="row.badge === 'severity'" class="status-pill" :class="severityClass(row.value)">{{ row.value }}</span>
                      <span v-else-if="row.badge === 'confidence'" class="status-pill" :class="confidenceClass(row.value)">{{ row.value }}</span>
                      <span v-else class="text-strong-wrap">{{ row.value }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="!errorDetailLoading && !errorDetailError" class="telescope-preview-card">
              <div class="telescope-card-header">
                <h3>Related Request</h3>
                <span>{{ (selectedError.relatedRequests || []).length }} requests</span>
              </div>
              <div v-if="!(selectedError.relatedRequests || []).length" class="empty-dashboard-state">
                No request log was linked to this exception.
              </div>
              <table v-else class="telescope-table related-link-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Happened</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in selectedError.relatedRequests || []" :key="item.id">
                    <td><span class="status-pill method-pill">{{ item.method }}</span></td>
                    <td class="path-cell" :title="item.path">{{ truncateText(item.path, 88) }}</td>
                    <td><span class="status-pill" :class="statusClass(item.statusCode)">{{ item.statusCode }}</span></td>
                    <td class="text-muted">{{ item.durationMs }}ms</td>
                    <td class="text-muted">{{ formatDate(item.createdAt) }}</td>
                    <td class="text-right">
                      <button class="control-action-btn" type="button" aria-label="Open related request" @click="openRequestFromError(item)">
                        &rarr;
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="!errorDetailLoading && !errorDetailError" class="telescope-preview-card overflow-hidden">
              <ul class="preview-pill-tabs">
                <li v-for="tab in errorDetailTabs" :key="tab.id">
                  <button
                    type="button"
                    :class="{ active: errorDetailTab === tab.id }"
                    @click="errorDetailTab = tab.id"
                  >
                    {{ tab.label }}
                  </button>
                </li>
              </ul>
              <div class="code-bg">
                <pre>{{ formatJson(currentErrorDetailPayload) }}</pre>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'jobs'" class="telescope-panel">
          <div class="table-toolbar">
            <select v-model="jobFilters.status" class="form-input" @change="fetchJobs(1)">
              <option value="ALL">All Jobs</option>
              <option value="PENDING">Pending</option>
              <option value="PROCESSING">Processing</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
          <table class="telescope-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>File</th>
                <th>User</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="job in jobs" :key="job.id">
                <td>#{{ job.id }}</td>
                <td><span class="status-pill" :class="jobStatusClass(job.status)">{{ job.status }}</span></td>
                <td>{{ job.uploadFile?.fileName || 'N/A' }}</td>
                <td>{{ job.createdBy?.email || 'System' }}</td>
                <td>{{ formatDate(job.startedAt) }}</td>
                <td>{{ formatDate(job.completedAt) }}</td>
                <td class="path-cell">{{ job.errorMessage || 'N/A' }}</td>
              </tr>
              <tr v-if="jobs.length === 0">
                <td colspan="7" class="empty-cell">No jobs found.</td>
              </tr>
            </tbody>
          </table>
          <div class="pagination-row">
            <div class="page-size-control">
              <span>{{ paginations.jobs.total }} jobs</span>
              <select v-model.number="paginations.jobs.pageSize" class="form-input" @change="fetchJobs(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.jobs.page <= 1" @click="fetchJobs(paginations.jobs.page - 1)">Previous</button>
              <span>Page {{ paginations.jobs.page }} of {{ paginations.jobs.totalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.jobs.page >= paginations.jobs.totalPages" @click="fetchJobs(paginations.jobs.page + 1)">Next</button>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'services'" class="telescope-panel">
          <div class="panel-heading">
            <h3>Extraction Services</h3>
            <span class="status-pill" :class="services?.online ? 'status-ok' : 'status-error'">
              {{ services?.online ? 'Online' : 'Offline' }}
            </span>
          </div>
          <table class="telescope-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Target</th>
                <th>Status</th>
                <th>HTTP</th>
                <th>Latency</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="service in services?.services || []" :key="service.service">
                <td>{{ service.service }}</td>
                <td>{{ service.target }}</td>
                <td><span class="status-pill" :class="serviceStatusClass(service.online)">{{ service.online ? 'Online' : 'Offline' }}</span></td>
                <td>{{ service.status || 'N/A' }}</td>
                <td>{{ service.latencyMs ?? 0 }} ms</td>
                <td>{{ service.error || 'N/A' }}</td>
              </tr>
              <tr v-if="!(services?.services || []).length">
                <td colspan="6" class="empty-cell">No extraction services configured.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section v-else-if="activeTab === 'reviews'" class="telescope-stack">
          <div class="telescope-metrics">
            <div class="telescope-metric">
              <span>Pending Reviews</span>
              <strong>{{ dataHealth?.totals?.pendingReviews ?? 0 }}</strong>
            </div>
            <div class="telescope-metric">
              <span>Approved Reviews</span>
              <strong>{{ dataHealth?.totals?.approvedReviews ?? 0 }}</strong>
            </div>
            <div class="telescope-metric">
              <span>Rejected Reviews</span>
              <strong>{{ dataHealth?.totals?.rejectedReviews ?? 0 }}</strong>
            </div>
          </div>
          <div class="telescope-panel">
            <div class="panel-heading">
              <h3>Latest Extraction Reviews</h3>
            </div>
            <table class="telescope-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>File</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Created</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="review in dataHealth?.latestReviews || []" :key="review.id">
                  <td>#{{ review.id }}</td>
                  <td>{{ review.uploadFile?.fileName || 'N/A' }}</td>
                  <td><span class="status-pill" :class="jobStatusClass(review.status)">{{ review.status }}</span></td>
                  <td>{{ review.version }}</td>
                  <td>{{ formatDate(review.createdAt) }}</td>
                  <td>{{ formatDate(review.updatedAt) }}</td>
                </tr>
                <tr v-if="!(dataHealth?.latestReviews || []).length">
                  <td colspan="6" class="empty-cell">No extraction reviews found.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-else-if="activeTab === 'data-health'" class="telescope-stack">
          <div class="telescope-metrics">
            <div v-for="card in dataCards" :key="card.label" class="telescope-metric">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
            </div>
          </div>
          <div class="telescope-panel">
            <div class="panel-heading">
              <h3>Data Health Snapshot</h3>
            </div>
            <div class="status-list">
              <div>
                <span>Question records</span>
                <strong>{{ dataHealth?.totals?.questions ?? 0 }}</strong>
              </div>
              <div>
                <span>Upload records</span>
                <strong>{{ dataHealth?.totals?.uploads ?? 0 }}</strong>
              </div>
              <div>
                <span>Jobs needing attention</span>
                <strong>{{ dataHealth?.totals?.failedJobs ?? 0 }}</strong>
              </div>
              <div>
                <span>Jobs currently running</span>
                <strong>{{ dataHealth?.totals?.runningJobs ?? 0 }}</strong>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'audit-logs'" class="telescope-panel">
          <div class="table-toolbar">
            <select v-model="auditFilters.action" class="form-input" @change="fetchAuditLogs(1)">
              <option value="ALL">All Actions</option>
              <option v-for="action in auditActions" :key="action" :value="action">{{ action }}</option>
            </select>
            <input v-model="auditFilters.search" class="form-input" placeholder="Search audit logs" @keyup.enter="fetchAuditLogs(1)" />
            <button class="btn btn-secondary btn-sm" type="button" @click="fetchAuditLogs(1)">Apply</button>
          </div>
          <table class="telescope-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Action</th>
                <th>Entity</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in auditLogs" :key="log.id">
                <td>{{ formatDate(log.createdAt) }}</td>
                <td>{{ log.user?.email || 'System' }}</td>
                <td>{{ log.action }}</td>
                <td>{{ log.entityType }}</td>
                <td>#{{ log.entityId }}</td>
              </tr>
              <tr v-if="auditLogs.length === 0">
                <td colspan="5" class="empty-cell">No audit logs found.</td>
              </tr>
            </tbody>
          </table>
          <div class="pagination-row">
            <div class="page-size-control">
              <span>{{ paginations.auditLogs.total }} audit logs</span>
              <select v-model.number="paginations.auditLogs.pageSize" class="form-input" @change="fetchAuditLogs(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.auditLogs.page <= 1" @click="fetchAuditLogs(paginations.auditLogs.page - 1)">Previous</button>
              <span>Page {{ paginations.auditLogs.page }} of {{ paginations.auditLogs.totalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="paginations.auditLogs.page >= paginations.auditLogs.totalPages" @click="fetchAuditLogs(paginations.auditLogs.page + 1)">Next</button>
            </div>
          </div>
        </section>
      </div>
    </main>

  </div>
</template>

<style scoped>
.telescope-header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.telescope-alert {
  margin-bottom: 1rem;
}

.telescope-loading {
  padding: 4rem 1rem;
}

.telescope-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.telescope-tab {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  color: var(--text-secondary);
  border-radius: 8px;
  padding: 0.6rem 0.9rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.telescope-tab.active {
  background: var(--primary);
  color: white;
  border-color: var(--primary);
}

.telescope-stack {
  display: grid;
  gap: 1rem;
}

.telescope-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 1rem;
}

.telescope-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
}

.telescope-metric,
.telescope-panel {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
}

.telescope-metric {
  min-height: 96px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.telescope-metric span {
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 700;
}

.telescope-metric strong {
  color: var(--text-primary);
  font-size: 1.65rem;
  line-height: 1.1;
}

.telescope-panel {
  padding: 1rem;
  overflow-x: auto;
}

.panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.panel-heading h3 {
  font-size: 1rem;
  margin: 0;
}

.status-list {
  display: grid;
  gap: 0.75rem;
}

.status-list > div,
.compact-row,
.error-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.status-list span,
.compact-time {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  padding: 0.25rem 0.55rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 800;
}

.status-ok {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.28);
}

.status-warning {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.28);
}

.status-error {
  background: rgba(239, 68, 68, 0.12);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.28);
}

.status-muted {
  background: rgba(100, 116, 139, 0.12);
  color: var(--text-secondary);
  border: 1px solid rgba(100, 116, 139, 0.28);
}

.source-database {
  background: rgba(168, 85, 247, 0.14);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.32);
}

.source-frontend {
  background: rgba(59, 130, 246, 0.14);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.32);
}

.source-backend {
  background: rgba(14, 165, 233, 0.14);
  color: #0284c7;
  border: 1px solid rgba(14, 165, 233, 0.32);
}

.source-auth {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.32);
}

.source-external {
  background: rgba(236, 72, 153, 0.14);
  color: #db2777;
  border: 1px solid rgba(236, 72, 153, 0.32);
}

.source-job {
  background: rgba(20, 184, 166, 0.14);
  color: #0f766e;
  border: 1px solid rgba(20, 184, 166, 0.32);
}

.source-network {
  background: rgba(100, 116, 139, 0.16);
  color: #64748b;
  border: 1px solid rgba(100, 116, 139, 0.34);
}

.compact-list,
.error-list {
  display: grid;
  gap: 0.75rem;
}

.compact-row {
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.75rem;
}

.compact-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1rem;
}

.table-toolbar .form-input {
  margin-bottom: 0;
}

.telescope-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  min-width: 760px;
}

.telescope-table th,
.telescope-table td {
  border-bottom: 1px solid var(--border-color);
  padding: 0.85rem;
  vertical-align: top;
}

.telescope-table th {
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 800;
}

.path-cell {
  max-width: 360px;
  overflow-wrap: anywhere;
}

.request-row {
  cursor: pointer;
}

.request-row:hover,
.request-row:focus {
  background: var(--bg-input);
  outline: none;
}

.empty-cell {
  color: var(--text-secondary);
  text-align: center;
  padding: 2rem !important;
}

.error-entry {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
  background: var(--bg-input);
}

.error-entry p {
  margin: 0.75rem 0;
  font-weight: 700;
}

.error-trace-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
  margin: 0.85rem 0;
}

.error-trace-grid div {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-card);
  padding: 0.75rem;
  min-width: 0;
}

.error-trace-grid span {
  display: block;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 800;
  margin-bottom: 0.35rem;
  text-transform: uppercase;
}

.error-trace-grid strong {
  display: block;
  overflow-wrap: anywhere;
}

.classification-reason {
  border-left: 3px solid var(--primary);
  color: var(--text-secondary);
  background: var(--bg-card);
  border-radius: 6px;
  padding: 0.75rem 0.85rem;
  margin: 0.85rem 0;
  font-weight: 800;
}

.trace-details {
  margin-top: 0.85rem;
}

.trace-details summary {
  cursor: pointer;
  color: var(--primary);
  font-weight: 900;
}

.error-entry pre {
  max-height: 240px;
  overflow: auto;
  background: var(--bg-app);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.9rem;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 0.78rem;
}

.text-center {
  text-align: center;
}

.text-right {
  text-align: right;
}

.text-muted {
  color: var(--text-secondary);
}

.table-fit {
  width: 1%;
  white-space: nowrap;
}

.telescope-request-console {
  display: block;
  min-width: 0;
}

.telescope-index-panel,
.telescope-preview-card {
  border: 1px solid var(--border-color);
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow-sm);
  min-width: 0;
}

.telescope-request-screen {
  width: 100%;
}

.telescope-index-panel {
  min-width: 0;
  overflow: hidden;
}

.telescope-card-header {
  min-height: 52px;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.telescope-card-header h3 {
  margin: 0;
  font-size: 0.98rem;
  min-width: 0;
}

.request-detail-title {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.86rem;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.text-strong-wrap {
  display: block;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.telescope-card-header span {
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 800;
}

.telescope-index-toolbar {
  grid-template-columns: minmax(110px, 0.8fr) minmax(125px, 0.9fr) minmax(145px, 1fr) auto;
  padding: 0.85rem 1rem;
  margin-bottom: 0;
  border-bottom: 1px solid var(--border-color);
  gap: 0.55rem;
}

.telescope-request-index {
  min-width: 100%;
  table-layout: fixed;
}

.telescope-request-index th:nth-child(1),
.telescope-request-index td:nth-child(1) {
  width: 82px;
}

.telescope-request-index th:nth-child(3),
.telescope-request-index td:nth-child(3) {
  width: 92px;
}

.telescope-request-index th:nth-child(4),
.telescope-request-index td:nth-child(4) {
  width: 110px;
}

.telescope-request-index th:nth-child(5),
.telescope-request-index td:nth-child(5) {
  width: 220px;
}

.telescope-request-index th:nth-child(6),
.telescope-request-index td:nth-child(6) {
  width: 54px;
}

.telescope-error-toolbar {
  grid-template-columns: minmax(130px, 0.8fr) minmax(135px, 0.8fr) minmax(125px, 0.7fr) minmax(180px, 1fr) auto;
}

.telescope-error-index {
  min-width: 1040px;
}

.telescope-error-index th:nth-child(1),
.telescope-error-index td:nth-child(1) {
  width: 130px;
}

.telescope-error-index th:nth-child(3),
.telescope-error-index td:nth-child(3) {
  width: 92px;
}

.telescope-error-index th:nth-child(4),
.telescope-error-index td:nth-child(4) {
  width: 110px;
}

.telescope-error-index th:nth-child(5),
.telescope-error-index td:nth-child(5) {
  width: 240px;
}

.telescope-error-index th:nth-child(6),
.telescope-error-index td:nth-child(6) {
  width: 220px;
}

.telescope-error-index th:nth-child(7),
.telescope-error-index td:nth-child(7) {
  width: 54px;
}

.related-link-table {
  min-width: 760px;
}

.related-link-table th:nth-child(1),
.related-link-table td:nth-child(1) {
  width: 96px;
}

.related-link-table th:nth-child(3),
.related-link-table td:nth-child(3) {
  width: 92px;
}

.related-link-table th:nth-child(4),
.related-link-table td:nth-child(4) {
  width: 100px;
}

.related-link-table th:nth-child(5),
.related-link-table td:nth-child(5) {
  width: 220px;
}

.related-link-table th:nth-child(6),
.related-link-table td:nth-child(6) {
  width: 54px;
}

.telescope-request-index .path-cell {
  max-width: none;
  overflow: hidden;
  overflow-wrap: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.telescope-request-index th,
.telescope-request-index td {
  padding: 0.72rem 0.85rem;
}

.request-row.active,
.request-row.active:hover {
  background: rgba(79, 70, 229, 0.1);
}

.method-pill {
  background: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  border: 1px solid rgba(59, 130, 246, 0.28);
}

.control-action-btn,
.control-action-link {
  border: 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  font-weight: 900;
}

.control-action-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
}

.control-action-btn:hover,
.control-action-link:hover {
  background: rgba(79, 70, 229, 0.1);
}

.control-action-link {
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
}

.telescope-index-pagination {
  padding: 0.8rem 1rem;
  border-top: 1px solid var(--border-color);
}

.telescope-preview-stack {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.overflow-hidden {
  overflow: hidden;
}

.fetching-panel {
  min-height: 180px;
  padding: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-secondary);
  font-weight: 800;
}

.preview-attributes-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  background: var(--bg-input);
}

.preview-attributes-table td {
  border-top: 1px solid var(--border-color);
  padding: 0.82rem 1rem;
  overflow-wrap: anywhere;
}

.preview-attributes-table td:first-child {
  width: 170px;
  font-weight: 800;
}

.tag-pill {
  margin: 0.15rem 0.25rem 0.15rem 0;
}

.preview-pill-tabs {
  list-style: none;
  margin: 0;
  padding: 0.72rem;
  display: flex;
  gap: 0.35rem;
  border-bottom: 1px solid var(--border-color);
}

.preview-pill-tabs button {
  border: 0;
  background: transparent;
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 0.48rem 0.75rem;
  font-weight: 900;
  cursor: pointer;
}

.preview-pill-tabs button.active {
  background: var(--primary);
  color: white;
}

.code-bg {
  background: #111827;
  color: #e5e7eb;
  padding: 1rem;
}

.code-bg pre {
  margin: 0;
  max-height: 460px;
  min-height: 160px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.8rem;
  line-height: 1.55;
}

@media (max-width: 768px) {
  .telescope-header-actions,
  .panel-heading,
  .status-list > div,
  .compact-row,
  .error-meta {
    align-items: stretch;
    flex-direction: column;
  }

  .telescope-metric strong {
    font-size: 1.35rem;
  }

  .telescope-index-toolbar {
    grid-template-columns: 1fr;
  }

  .telescope-request-index th:nth-child(1),
  .telescope-request-index td:nth-child(1) {
    width: 66px;
  }

  .telescope-request-index th:nth-child(3),
  .telescope-request-index td:nth-child(3) {
    width: 70px;
  }

  .telescope-request-index th:nth-child(4),
  .telescope-request-index td:nth-child(4) {
    width: 78px;
  }

  .telescope-request-index th:nth-child(5),
  .telescope-request-index td:nth-child(5) {
    width: 142px;
  }

  .preview-attributes-table td:first-child {
    width: 125px;
  }
}
</style>
