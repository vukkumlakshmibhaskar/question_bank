<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotificationStore } from '../stores/notification'
import api from '../services/api'

const router = useRouter()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()

const userRole = computed(() => authStore.userRole)
const loading = ref(false)
const uploading = ref(false)
const downloadingTemplate = ref(false)
const documentsLoading = ref(false)
const evaluators = ref([])
const pagination = ref({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
const templateRows = ref(25)
const excelFile = ref(null)
const documentFiles = ref([])
const uploadErrors = ref([])
const uploadResult = ref(null)
const selectedEvaluator = ref(null)
const previewDocument = ref(null)

const filters = ref({
  search: '',
  name: '',
  mobile: '',
  email: '',
  pan: '',
  aadhaar: '',
  designation: '',
  pageSize: 10,
})

const hasPreviousPage = computed(() => pagination.value.page > 1)
const hasNextPage = computed(() => pagination.value.page < pagination.value.totalPages)

const fetchEvaluators = async (page = pagination.value.page || 1) => {
  loading.value = true
  try {
    const params = {
      page,
      pageSize: filters.value.pageSize,
    }
    Object.entries(filters.value).forEach(([key, value]) => {
      const text = String(value || '').trim()
      if (text && key !== 'pageSize') params[key] = text
    })

    const response = await api.get('/evaluators', { params })
    evaluators.value = response.data?.data || []
    pagination.value = response.data?.pagination || pagination.value
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load evaluators.')
  } finally {
    loading.value = false
  }
}

const clearFilters = async () => {
  filters.value = {
    search: '',
    name: '',
    mobile: '',
    email: '',
    pan: '',
    aadhaar: '',
    designation: '',
    pageSize: 10,
  }
  await fetchEvaluators(1)
}

const downloadTemplate = async () => {
  downloadingTemplate.value = true
  try {
    const rows = Math.min(Math.max(parseInt(templateRows.value) || 25, 1), 500)
    const response = await api.get('/evaluators/template', {
      params: { rows },
      responseType: 'blob',
    })
    const blob = new Blob([response.data], {
      type: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Evaluator_Bulk_Upload_Template_${rows}_Rows.xlsm`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
    notificationStore.success('Evaluator template downloaded.')
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to download evaluator template.')
  } finally {
    downloadingTemplate.value = false
  }
}

const handleExcelChange = (event) => {
  excelFile.value = event.target.files?.[0] || null
  uploadErrors.value = []
}

const handleDocumentsChange = (event) => {
  documentFiles.value = Array.from(event.target.files || [])
}

const uploadEvaluators = async () => {
  if (!excelFile.value) {
    notificationStore.warning('Select the completed evaluator Excel file first.')
    return
  }

  const formData = new FormData()
  formData.append('excel', excelFile.value)
  documentFiles.value.forEach((file) => formData.append('documents', file))

  uploading.value = true
  uploadErrors.value = []
  uploadResult.value = null
  try {
    const response = await api.post('/evaluators/bulk-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    uploadResult.value = response.data?.result
    excelFile.value = null
    documentFiles.value = []
    notificationStore.success(response.data?.message || 'Evaluator upload completed.')
    await fetchEvaluators(1)
  } catch (err) {
    uploadErrors.value = err.response?.data?.details || []
    notificationStore.error(err.response?.data?.error || 'Evaluator upload failed.')
  } finally {
    uploading.value = false
  }
}

const openDocuments = async (evaluator) => {
  selectedEvaluator.value = { ...evaluator, documents: [] }
  previewDocument.value = null
  documentsLoading.value = true
  try {
    const response = await api.get(`/evaluators/${evaluator.id}/documents`)
    selectedEvaluator.value = response.data
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load evaluator documents.')
    selectedEvaluator.value = null
  } finally {
    documentsLoading.value = false
  }
}

const closeDocuments = () => {
  if (previewDocument.value?.url) {
    window.URL.revokeObjectURL(previewDocument.value.url)
  }
  selectedEvaluator.value = null
  previewDocument.value = null
}

const fetchDocumentBlob = async (doc) => {
  const response = await api.get(`/evaluators/documents/${doc.id}/download`, {
    responseType: 'blob',
  })
  return new Blob([response.data], { type: doc.mimeType || response.headers?.['content-type'] })
}

const previewEvaluatorDocument = async (doc) => {
  try {
    if (previewDocument.value?.url) {
      window.URL.revokeObjectURL(previewDocument.value.url)
    }
    const blob = await fetchDocumentBlob(doc)
    previewDocument.value = {
      ...doc,
      url: window.URL.createObjectURL(blob),
    }
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'This document cannot be previewed.')
  }
}

const downloadEvaluatorDocument = async (doc) => {
  try {
    const blob = await fetchDocumentBlob(doc)
    const url = window.URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = doc.originalName || doc.fileName
    window.document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to download document.')
  }
}

const formatDate = (value) => {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

onMounted(() => fetchEvaluators(1))
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
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
          Dashboard
        </router-link>
        <router-link to="/questions" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
          Question Bank
        </router-link>
        <router-link to="/manage-questions" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/></svg>
          Manage Questions
        </router-link>
        <router-link to="/manage-multi-questions" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="5" rx="1"/><rect x="4" y="11" width="16" height="9" rx="1"/><path d="M8 14h8M8 17h5"/></svg>
          Manage Multi Questions
        </router-link>
        <router-link to="/extraction" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
          Extraction
        </router-link>
        <router-link to="/evaluator-bulk-upload" class="nav-item active" v-if="userRole === 'ADMIN'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
          Evaluator Bulk Upload
        </router-link>
        <router-link to="/test-papers" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Test Papers
        </router-link>
        <router-link to="/assessment-builder" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h3"/></svg>
          Assessment Builder
        </router-link>
        <router-link to="/subjects" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          Subjects & Chapters
        </router-link>
<router-link to="/admin/users" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          User Manager
        </router-link>
<router-link to="/reviews" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>
          Extraction Reviews
        </router-link>
<router-link to="/admin/audit-logs" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          Audit Logs
        </router-link>
        <router-link to="/telescope" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="M12 3v6"/><path d="M12 15v6"/></svg>
          Telescope
        </router-link>
</nav>

      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="user-avatar">{{ authStore.user?.name ? authStore.user.name.charAt(0) : 'U' }}</div>
          <div class="user-info">
            <span class="user-name" :title="authStore.user?.name">{{ authStore.user?.name || 'User Name' }}</span>
            <span class="user-role badge" :class="`badge-${userRole?.toLowerCase()}`">{{ userRole || 'TEACHER' }}</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" @click="handleLogout">Sign Out</button>
      </div>
    </aside>

    <main class="main-content">
      <header class="header">
        <div>
          <p class="page-kicker">Evaluator Administration</p>
          <h2 class="page-title">Evaluator Bulk Upload</h2>
        </div>
        <button class="btn btn-secondary btn-sm action-button" type="button" :disabled="loading" @click="fetchEvaluators(1)">
          Refresh
        </button>
      </header>

      <div class="content-body fade-in-el">
        <section class="section-card upload-workspace">
          <div class="template-panel">
            <div>
              <h3>Download Template</h3>
              <p>Generate a macro-enabled evaluator template by row count. Maximum 500 rows.</p>
            </div>
            <div class="template-actions">
              <input v-model="templateRows" class="form-control row-input" type="number" min="1" max="500" />
              <button class="btn btn-primary btn-sm" type="button" :disabled="downloadingTemplate" @click="downloadTemplate">
                {{ downloadingTemplate ? 'Preparing...' : 'Download .xlsm Template' }}
              </button>
            </div>
          </div>

          <div class="upload-grid">
            <div class="form-group">
              <label class="form-label" for="evaluator-excel">Completed Evaluator Excel</label>
              <input id="evaluator-excel" class="form-control" type="file" accept=".xls,.xlsx,.xlsm" @change="handleExcelChange" />
              <small>{{ excelFile?.name || 'Upload the completed evaluator workbook.' }}</small>
            </div>
            <div class="form-group">
              <label class="form-label" for="evaluator-documents">Images / Documents</label>
              <input id="evaluator-documents" class="form-control" type="file" multiple accept="image/*,.pdf,.doc,.docx" @change="handleDocumentsChange" />
              <small>{{ documentFiles.length }} file{{ documentFiles.length === 1 ? '' : 's' }} selected</small>
            </div>
            <button class="btn btn-primary upload-button" type="button" :disabled="uploading" @click="uploadEvaluators">
              {{ uploading ? 'Uploading...' : 'Upload Evaluators' }}
            </button>
          </div>

          <div v-if="uploadResult" class="upload-result">
            Created {{ uploadResult.created }}, updated {{ uploadResult.updated }}, documents stored {{ uploadResult.documentCount }}.
          </div>
          <div v-if="uploadErrors.length" class="upload-errors">
            <strong>Validation errors</strong>
            <div v-for="item in uploadErrors" :key="item.rowNumber || item.errors.join('-')">
              Row {{ item.rowNumber || '-' }}: {{ item.errors.join(', ') }}
            </div>
          </div>
        </section>

        <section class="section-card filter-workspace">
          <div class="filter-grid">
            <div class="form-group">
              <label class="form-label">Search</label>
              <input v-model="filters.search" class="form-control" placeholder="Name, mobile, email, PAN..." @keyup.enter="fetchEvaluators(1)" />
            </div>
            <div class="form-group">
              <label class="form-label">Name</label>
              <input v-model="filters.name" class="form-control" placeholder="Evaluator name" @keyup.enter="fetchEvaluators(1)" />
            </div>
            <div class="form-group">
              <label class="form-label">Mobile</label>
              <input v-model="filters.mobile" class="form-control" placeholder="Mobile" @keyup.enter="fetchEvaluators(1)" />
            </div>
            <div class="form-group">
              <label class="form-label">Email</label>
              <input v-model="filters.email" class="form-control" placeholder="Email" @keyup.enter="fetchEvaluators(1)" />
            </div>
            <div class="form-group">
              <label class="form-label">PAN</label>
              <input v-model="filters.pan" class="form-control" placeholder="PAN" @keyup.enter="fetchEvaluators(1)" />
            </div>
            <div class="form-group">
              <label class="form-label">Aadhaar</label>
              <input v-model="filters.aadhaar" class="form-control" placeholder="Aadhaar" @keyup.enter="fetchEvaluators(1)" />
            </div>
            <div class="form-group">
              <label class="form-label">Designation</label>
              <input v-model="filters.designation" class="form-control" placeholder="Designation" @keyup.enter="fetchEvaluators(1)" />
            </div>
            <div class="form-group">
              <label class="form-label">Page Size</label>
              <select v-model="filters.pageSize" class="form-control" @change="fetchEvaluators(1)">
                <option :value="10">10</option>
                <option :value="25">25</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
              </select>
            </div>
          </div>
          <div class="filter-actions">
            <button class="btn btn-primary btn-sm" type="button" @click="fetchEvaluators(1)">Search</button>
            <button class="btn btn-secondary btn-sm" type="button" @click="clearFilters">Clear</button>
          </div>
        </section>

        <section class="section-card table-card">
          <div class="table-heading">
            <div>
              <h3>Evaluators</h3>
              <p>{{ pagination.total }} record{{ pagination.total === 1 ? '' : 's' }} found</p>
            </div>
          </div>

          <div v-if="loading" class="spinner-container">
            <div class="spinner"></div>
            <p class="spinner-text">Loading evaluators...</p>
          </div>
          <div v-else-if="evaluators.length === 0" class="empty-state">
            <h3>No evaluators found</h3>
            <p>Upload a completed evaluator template or adjust the filters.</p>
          </div>
          <div v-else class="table-scroll">
            <table class="evaluator-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Email</th>
                  <th>PAN</th>
                  <th>Aadhaar</th>
                  <th>Designation</th>
                  <th>Documents</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="evaluator in evaluators" :key="evaluator.id">
                  <td data-label="Name"><strong>{{ evaluator.fullName }}</strong></td>
                  <td data-label="Mobile">{{ evaluator.mobile }}</td>
                  <td data-label="Email">{{ evaluator.email || '-' }}</td>
                  <td data-label="PAN">{{ evaluator.pan || '-' }}</td>
                  <td data-label="Aadhaar">{{ evaluator.aadhaar || '-' }}</td>
                  <td data-label="Designation">{{ evaluator.designation || '-' }}</td>
                  <td data-label="Documents">
                    <div class="document-cell">
                      <strong>{{ evaluator._count?.documents || 0 }}</strong>
                      <button class="btn btn-secondary btn-sm" type="button" @click="openDocuments(evaluator)">View</button>
                    </div>
                  </td>
                  <td data-label="Updated">{{ formatDate(evaluator.updatedAt) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pagination-row">
            <button class="btn btn-secondary btn-sm" type="button" :disabled="!hasPreviousPage" @click="fetchEvaluators(pagination.page - 1)">Previous</button>
            <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
            <button class="btn btn-secondary btn-sm" type="button" :disabled="!hasNextPage" @click="fetchEvaluators(pagination.page + 1)">Next</button>
          </div>
        </section>
      </div>

      <div v-if="selectedEvaluator" class="modal-overlay" @click.self="closeDocuments">
        <div class="modal-box document-modal">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Evaluator Documents</p>
              <h3>{{ selectedEvaluator.fullName }}</h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close documents" @click="closeDocuments">&times;</button>
          </div>
          <div class="modal-content document-layout">
            <div class="document-list">
              <div v-if="documentsLoading" class="spinner-container">
                <div class="spinner"></div>
                <p class="spinner-text">Loading documents...</p>
              </div>
              <div v-else-if="!selectedEvaluator.documents?.length" class="empty-docs">No documents uploaded for this evaluator.</div>
              <div v-for="doc in selectedEvaluator.documents" v-else :key="doc.id" class="document-row">
                <div>
                  <strong>{{ doc.originalName }}</strong>
                  <span>{{ doc.documentType || 'GENERAL' }} · {{ (doc.fileSize / 1024).toFixed(1) }} KB</span>
                </div>
                <div class="document-actions">
                  <button class="btn btn-secondary btn-sm" type="button" @click="previewEvaluatorDocument(doc)">Preview</button>
                  <button class="btn btn-primary btn-sm" type="button" @click="downloadEvaluatorDocument(doc)">Download</button>
                </div>
              </div>
            </div>
            <div class="preview-pane">
              <div v-if="!previewDocument" class="empty-docs">Select a document to preview.</div>
              <img v-else-if="previewDocument.mimeType?.startsWith('image/')" :src="previewDocument.url" :alt="previewDocument.originalName" />
              <iframe v-else-if="previewDocument.mimeType === 'application/pdf'" :src="previewDocument.url" title="Evaluator document preview"></iframe>
              <div v-else class="empty-docs">Preview is not available for this file type. Use Download.</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.page-kicker {
  margin: 0 0 0.25rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.upload-workspace,
.filter-workspace,
.table-card {
  margin-bottom: 1.25rem;
}

.template-panel,
.upload-grid,
.filter-actions,
.pagination-row,
.document-cell,
.document-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.template-panel {
  justify-content: space-between;
  margin-bottom: 1rem;
}

.template-panel h3,
.table-heading h3 {
  margin: 0;
  color: var(--text-primary);
}

.template-panel p,
.table-heading p,
.form-group small {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
}

.template-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.row-input {
  max-width: 110px;
}

.upload-grid {
  align-items: flex-end;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) auto;
}

.upload-button {
  width: auto;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 0.85rem;
}

.filter-actions {
  justify-content: flex-end;
  margin-top: 1rem;
}

.upload-result,
.upload-errors {
  margin-top: 1rem;
  padding: 0.85rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
}

.upload-result {
  color: #34d399;
  background: rgba(16, 185, 129, 0.08);
}

.upload-errors {
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.08);
}

.table-heading {
  display: flex;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.table-scroll {
  overflow-x: auto;
}

.evaluator-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 980px;
}

.evaluator-table th,
.evaluator-table td {
  padding: 0.9rem;
  border-bottom: 1px solid var(--border-color);
  text-align: left;
}

.evaluator-table th {
  color: var(--text-secondary);
  font-size: 0.75rem;
  text-transform: uppercase;
}

.document-cell {
  justify-content: flex-start;
}

.pagination-row {
  justify-content: flex-end;
  margin-top: 1rem;
  color: var(--text-secondary);
}

.document-modal {
  max-width: 980px;
}

.document-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.9fr) minmax(280px, 1.1fr);
  gap: 1rem;
}

.document-list,
.preview-pane {
  min-height: 360px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  overflow: auto;
}

.document-row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.9rem;
  border-bottom: 1px solid var(--border-color);
}

.document-row span {
  display: block;
  margin-top: 0.25rem;
  color: var(--text-secondary);
}

.preview-pane {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem;
}

.preview-pane img,
.preview-pane iframe {
  width: 100%;
  height: 100%;
  min-height: 340px;
  border: 0;
  object-fit: contain;
}

.empty-docs {
  padding: 1rem;
  color: var(--text-secondary);
  text-align: center;
}

@media (max-width: 760px) {
  .template-panel,
  .template-actions,
  .upload-grid,
  .document-layout,
  .document-row {
    grid-template-columns: 1fr;
    align-items: stretch;
    flex-direction: column;
  }

  .upload-grid {
    display: grid;
  }

  .evaluator-table {
    min-width: 0;
  }

  .evaluator-table thead {
    display: none;
  }

  .evaluator-table tr {
    display: block;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border-color);
  }

  .evaluator-table td {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 0;
    border-bottom: 0;
  }

  .evaluator-table td::before {
    content: attr(data-label);
    color: var(--text-muted);
    font-weight: 700;
  }
}
</style>
