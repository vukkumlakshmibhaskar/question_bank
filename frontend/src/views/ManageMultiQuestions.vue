<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotificationStore } from '../stores/notification'
import api from '../services/api'
import { PAGE_SIZE_OPTIONS, createPagination, unpackPaginated } from '../utils/pagination'

const router = useRouter()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()

const userRole = computed(() => authStore.userRole)
const userPermissions = computed(() => authStore.user?.permissions || [])
const canWrite = computed(() => {
  return ['ADMIN', 'TEACHER'].includes(userRole.value) || userPermissions.value.includes('questions:write')
})

const loading = ref(false)
const savingHeader = ref(false)
const bankDetailLoading = ref(false)
const bankDetailError = ref('')
const questionBanks = ref([])
const selectedBankDetail = ref(null)
const questions = ref([])
const pagination = ref(createPagination(10))
const settings = ref({
  questionTypes: [],
  objectiveTypes: [],
  questionHeaders: [],
})

const filters = ref({
  bankId: '',
  parentTopicId: '',
  subTopicId: '',
  questionType: '',
  objectiveType: '',
  questionHeader: '',
  complexity: '',
  questionNo: '',
  questionText: '',
  marks: '',
})

const isHeaderModalOpen = ref(false)
const editingQuestion = ref(null)
const editingHeader = ref('')

const complexityOptions = [
  { value: '', label: 'All Complexity' },
  { value: 'EASY', label: 'Easy' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HARD', label: 'Hard' },
]

const selectedBankName = computed(() => {
  const bank = questionBanks.value.find((item) => item.id === parseInt(filters.value.bankId))
  return bank?.name || ''
})

const topicLabel = (topic) => {
  return [topic.subjectName, topic.name].filter(Boolean).join(' / ') || topic.name || '-'
}

const parentTopicOptions = computed(() => {
  if (!filters.value.bankId || !selectedBankDetail.value) return []
  const topicMap = new Map()
  for (const bankQuestion of selectedBankDetail.value.bankQuestions || []) {
    const chapter = bankQuestion.question?.concept?.chapter
    if (!chapter) continue
    topicMap.set(chapter.id, {
      id: chapter.id,
      name: chapter.name,
      subjectName: chapter.subject?.name || '',
    })
  }

  return Array.from(topicMap.values()).sort((left, right) => topicLabel(left).localeCompare(topicLabel(right)))
})

const subTopicOptions = computed(() => {
  if (!filters.value.parentTopicId || !selectedBankDetail.value) return []
  const parentId = parseInt(filters.value.parentTopicId)
  const conceptMap = new Map()
  for (const bankQuestion of selectedBankDetail.value.bankQuestions || []) {
    const concept = bankQuestion.question?.concept
    if (!concept || concept.chapter?.id !== parentId) continue
    conceptMap.set(concept.id, concept)
  }

  return Array.from(conceptMap.values()).sort((left, right) =>
    String(left.name || '').localeCompare(String(right.name || '')),
  )
})

const groupedQuestions = computed(() => {
  const groups = new Map()
  for (const question of questions.value) {
    const header = question.questionHeader || 'Unassigned Header'
    if (!groups.has(header)) {
      groups.set(header, [])
    }
    groups.get(header).push(question)
  }

  return Array.from(groups.entries()).map(([header, items]) => ({
    header,
    items,
    totalMarks: items.reduce((sum, item) => sum + (Number(item.marks) || 0), 0),
  }))
})

const fetchQuestionBanks = async () => {
  const response = await api.get('/question-banks')
  questionBanks.value = response.data || []
}

const fetchSelectedBankDetail = async () => {
  selectedBankDetail.value = null
  bankDetailError.value = ''
  if (!filters.value.bankId) return

  bankDetailLoading.value = true
  try {
    const response = await api.get(`/question-banks/${filters.value.bankId}`)
    selectedBankDetail.value = response.data
  } catch (err) {
    bankDetailError.value = err.response?.data?.error || 'Failed to load bank topics.'
    throw err
  } finally {
    bankDetailLoading.value = false
  }
}

const fetchSettings = async () => {
  const response = await api.get('/multi-questions/settings')
  settings.value = response.data || settings.value
}

const fetchQuestions = async (page = pagination.value.page) => {
  loading.value = true
  try {
    const params = {
      page,
      pageSize: pagination.value.pageSize,
    }
    Object.entries(filters.value).forEach(([key, value]) => {
      const trimmed = String(value || '').trim()
      if (trimmed) params[key] = trimmed
    })

    const response = await api.get('/multi-questions', { params })
    const unpacked = unpackPaginated(response.data, {
      ...pagination.value,
      page,
    })
    questions.value = unpacked.rows
    pagination.value = unpacked.pagination
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load multi questions.')
  } finally {
    loading.value = false
  }
}

const clearFilters = async () => {
  filters.value = {
    bankId: '',
    parentTopicId: '',
    subTopicId: '',
    questionType: '',
    objectiveType: '',
    questionHeader: '',
    complexity: '',
    questionNo: '',
    questionText: '',
    marks: '',
  }
  selectedBankDetail.value = null
  await fetchQuestions(1)
}

const handleQuestionBankChange = async () => {
  filters.value.parentTopicId = ''
  filters.value.subTopicId = ''
  try {
    await fetchSelectedBankDetail()
    await fetchQuestions(1)
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load question bank filters.')
  }
}

const handleParentTopicChange = async () => {
  filters.value.subTopicId = ''
  await fetchQuestions(1)
}

const openHeaderModal = (question) => {
  editingQuestion.value = question
  editingHeader.value = question.questionHeader || ''
  isHeaderModalOpen.value = true
}

const closeHeaderModal = () => {
  if (savingHeader.value) return
  isHeaderModalOpen.value = false
  editingQuestion.value = null
  editingHeader.value = ''
}

const saveQuestionHeader = async () => {
  if (!editingQuestion.value) return
  savingHeader.value = true

  try {
    await api.patch(`/multi-questions/${editingQuestion.value.id}/header`, {
      questionHeader: editingHeader.value,
    })
    notificationStore.success('Question header updated.')
    await Promise.all([fetchSettings(), fetchQuestions()])
    closeHeaderModal()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to update question header.')
  } finally {
    savingHeader.value = false
  }
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const questionTypeLabel = (question) => question.questionTypeLabel || question.type || '-'

const linkedBanksLabel = (question) => {
  const banks = question.bankQuestions?.map((item) => item.bank?.name).filter(Boolean) || []
  return banks.length > 0 ? banks.join(', ') : 'Not linked'
}

const sourceLabel = (question) => {
  return question.sourceFile?.fileName || question.sourceFileName || question.sourceReference || '-'
}

const shortText = (value, length = 150) => {
  const text = String(value || '')
  return text.length > length ? `${text.slice(0, length)}...` : text
}

const formatDate = (value) => {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

onMounted(async () => {
  try {
    await Promise.all([fetchQuestionBanks(), fetchSettings()])
    await fetchQuestions()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to prepare Manage Multi Questions.')
  }
})
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
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Question Bank
        </router-link>
        <router-link to="/manage-questions" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/></svg>
          Manage Questions
        </router-link>
        <router-link to="/manage-multi-questions" class="nav-item active">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="5" rx="1"/><rect x="4" y="11" width="16" height="9" rx="1"/><path d="M8 14h8M8 17h5"/></svg>
          Manage Multi Questions
        </router-link>
        <router-link to="/extraction" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
          Extraction
        </router-link>
        <router-link to="/evaluator-bulk-upload" class="nav-item" v-if="userRole === 'ADMIN'">
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
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>
          User Manager
        </router-link>
<router-link to="/reviews" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Extraction Reviews
        </router-link>
<router-link to="/admin/audit-logs" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/></svg>
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
          <p class="page-kicker">Structured Question Groups</p>
          <h2 class="page-title">Manage Multi Questions</h2>
        </div>
        <div class="header-actions">
          <button class="btn btn-secondary btn-sm action-button" type="button" :disabled="loading" @click="fetchQuestions()">
            Refresh
          </button>
        </div>
      </header>

      <div class="content-body fade-in-el">
        <section class="section-card filter-workspace">
          <div class="filter-grid">
            <div class="form-group">
              <label class="form-label" for="mmq-bank">Question Bank</label>
              <select id="mmq-bank" v-model="filters.bankId" class="form-control" @change="handleQuestionBankChange">
                <option value="">All Question Banks</option>
                <option v-for="bank in questionBanks" :key="bank.id" :value="bank.id">{{ bank.name }}</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-parent-topic">Parent Topic</label>
              <select
                id="mmq-parent-topic"
                v-model="filters.parentTopicId"
                class="form-control"
                :disabled="!filters.bankId || bankDetailLoading || parentTopicOptions.length === 0"
                @change="handleParentTopicChange"
              >
                <option value="">
                  {{ !filters.bankId ? 'Select question bank first' : bankDetailLoading ? 'Loading topics...' : 'All Parent Topics' }}
                </option>
                <option v-for="topic in parentTopicOptions" :key="topic.id" :value="topic.id">{{ topicLabel(topic) }}</option>
              </select>
              <span v-if="bankDetailError" class="field-help is-error">{{ bankDetailError }}</span>
              <span v-else-if="filters.bankId && !bankDetailLoading && parentTopicOptions.length === 0" class="field-help">No parent topics found in this bank.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-sub-topic">Sub Topic</label>
              <select
                id="mmq-sub-topic"
                v-model="filters.subTopicId"
                class="form-control"
                :disabled="!filters.parentTopicId || subTopicOptions.length === 0"
                @change="fetchQuestions(1)"
              >
                <option value="">{{ !filters.parentTopicId ? 'Select parent topic first' : 'All Sub Topics' }}</option>
                <option v-for="topic in subTopicOptions" :key="topic.id" :value="topic.id">{{ topic.name }}</option>
              </select>
              <span v-if="filters.parentTopicId && subTopicOptions.length === 0" class="field-help">No sub topics found under this parent topic.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-type">Question Type</label>
              <select id="mmq-type" v-model="filters.questionType" class="form-control" @change="fetchQuestions(1)">
                <option value="">All Types</option>
                <option v-for="item in settings.questionTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-objective">Objective Type</label>
              <select id="mmq-objective" v-model="filters.objectiveType" class="form-control" @change="fetchQuestions(1)">
                <option value="">All Objective Types</option>
                <option v-for="item in settings.objectiveTypes" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-header">Question Header</label>
              <input
                id="mmq-header"
                v-model="filters.questionHeader"
                class="form-control"
                list="question-header-options"
                type="search"
                placeholder="Section or group..."
                @keyup.enter="fetchQuestions(1)"
              />
              <datalist id="question-header-options">
                <option v-for="item in settings.questionHeaders" :key="item.value" :value="item.value" />
              </datalist>
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-complexity">Complexity</label>
              <select id="mmq-complexity" v-model="filters.complexity" class="form-control" @change="fetchQuestions(1)">
                <option v-for="item in complexityOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-no">Question No.</label>
              <input id="mmq-no" v-model="filters.questionNo" class="form-control" type="search" placeholder="Q-001 or DB id" @keyup.enter="fetchQuestions(1)" />
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-text">Question Text</label>
              <input id="mmq-text" v-model="filters.questionText" class="form-control" type="search" placeholder="Search text..." @keyup.enter="fetchQuestions(1)" />
            </div>

            <div class="form-group">
              <label class="form-label" for="mmq-marks">Marks</label>
              <input id="mmq-marks" v-model="filters.marks" class="form-control" type="number" min="1" placeholder="Exact marks" @keyup.enter="fetchQuestions(1)" />
            </div>
          </div>

          <div class="filter-actions">
            <div class="filter-summary">
              <strong>{{ pagination.total }}</strong>
              <span>question{{ questions.length === 1 ? '' : 's' }}</span>
              <span>{{ groupedQuestions.length }} header group{{ groupedQuestions.length === 1 ? '' : 's' }}</span>
              <span v-if="selectedBankName">in {{ selectedBankName }}</span>
            </div>
            <div class="filter-buttons">
              <button class="btn btn-primary btn-sm action-button" type="button" @click="fetchQuestions(1)">Search</button>
              <button class="btn btn-secondary btn-sm action-button" type="button" @click="clearFilters">Clear</button>
            </div>
          </div>
        </section>

        <section class="section-card results-card">
          <div class="section-header">
            <div>
              <h3 class="section-title">Structured Question Results</h3>
              <p class="section-subtitle">Grouped by editable question headers with marks and metadata columns.</p>
            </div>
          </div>

          <div v-if="loading" class="spinner-container manage-spinner">
            <div class="spinner"></div>
            <p class="spinner-text">Searching multi questions...</p>
          </div>

          <div v-else-if="questions.length === 0" class="empty-state compact-empty">
            <h3>No multi questions found</h3>
            <p>Adjust the filters or import an Excel template with structured question metadata.</p>
          </div>

          <div v-else class="multi-group-list">
            <article v-for="group in groupedQuestions" :key="group.header" class="multi-group-card">
              <div class="group-header">
                <div>
                  <h4>{{ group.header }}</h4>
                  <p>{{ group.items.length }} questions · {{ group.totalMarks }} marks</p>
                </div>
              </div>

              <div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Question No.</th>
                      <th>Question Text</th>
                      <th>Type</th>
                      <th>Objective</th>
                      <th>Complexity</th>
                      <th>Marks</th>
                      <th>Bank</th>
                      <th>Source</th>
                      <th>Updated</th>
                      <th v-if="canWrite">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="question in group.items" :key="question.id">
                      <td>{{ question.questionNo || `#${question.id}` }}</td>
                      <td class="text-cell">{{ shortText(question.content) }}</td>
                      <td>{{ questionTypeLabel(question) }}</td>
                      <td>{{ question.objectiveType || '-' }}</td>
                      <td>
                        <span class="difficulty-pill" :class="`difficulty-${String(question.difficulty || '').toLowerCase()}`">
                          {{ question.difficulty }}
                        </span>
                      </td>
                      <td>{{ question.marks || '-' }}</td>
                      <td>{{ linkedBanksLabel(question) }}</td>
                      <td>{{ sourceLabel(question) }}</td>
                      <td>{{ formatDate(question.updatedAt) }}</td>
                      <td v-if="canWrite">
                        <button class="btn btn-secondary btn-sm action-button" type="button" @click="openHeaderModal(question)">
                          Edit Header
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div v-if="!loading && pagination.total > 0" class="pagination-row">
            <div class="page-size-control">
              <span>{{ pagination.total }} record{{ pagination.total === 1 ? '' : 's' }}</span>
              <select v-model.number="pagination.pageSize" class="form-control" @change="fetchQuestions(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm action-button" type="button" :disabled="pagination.page <= 1" @click="fetchQuestions(pagination.page - 1)">Previous</button>
              <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
              <button class="btn btn-secondary btn-sm action-button" type="button" :disabled="pagination.page >= pagination.totalPages" @click="fetchQuestions(pagination.page + 1)">Next</button>
            </div>
          </div>
        </section>
      </div>
    </main>

    <div v-if="isHeaderModalOpen" class="modal-overlay" @click.self="closeHeaderModal">
      <form class="modal-box header-modal" @submit.prevent="saveQuestionHeader">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Question #{{ editingQuestion?.id }}</p>
            <h3>Edit Question Header</h3>
          </div>
          <button type="button" class="icon-button" aria-label="Close header editor" @click="closeHeaderModal">&times;</button>
        </div>

        <div class="modal-content">
          <div class="form-group">
            <label class="form-label" for="edit-question-header">Question Header</label>
            <input id="edit-question-header" v-model="editingHeader" class="form-control" type="text" list="question-header-options" />
          </div>
          <p class="modal-help">{{ shortText(editingQuestion?.content || '', 220) }}</p>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm action-button" type="button" @click="closeHeaderModal">Cancel</button>
          <button class="btn btn-primary btn-sm action-button" type="submit" :disabled="savingHeader">
            {{ savingHeader ? 'Saving...' : 'Save Header' }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.nav-icon {
  flex: 0 0 18px;
  height: 18px;
  margin-right: 8px;
  width: 18px;
}

.action-button {
  width: auto;
}

.filter-workspace {
  margin-bottom: 1.5rem;
}

.filter-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.filter-grid .form-group {
  margin-bottom: 0;
}

.filter-actions,
.filter-buttons,
.group-header,
.modal-actions {
  align-items: center;
  display: flex;
  gap: 0.75rem;
}

.filter-actions {
  border-top: 1px solid var(--subtle-border);
  justify-content: space-between;
  margin-top: 1.25rem;
  padding-top: 1rem;
}

.filter-summary {
  align-items: baseline;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.filter-summary strong {
  color: var(--text-primary);
  font-size: 1.25rem;
}

.section-subtitle,
.modal-help,
.group-header p {
  color: var(--text-muted);
  font-size: 0.86rem;
}

.manage-spinner {
  padding: 4rem 1rem;
}

.multi-group-list {
  display: grid;
  gap: 1rem;
}

.multi-group-card {
  background: var(--glass-control);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-highlight-strong);
  overflow: hidden;
}

.group-header {
  border-bottom: 1px solid var(--subtle-border);
  justify-content: space-between;
  padding: 1rem 1.1rem;
}

.group-header h4,
.group-header p {
  margin: 0;
}

.table-wrap {
  overflow-x: auto;
}

table {
  border-collapse: collapse;
  min-width: 1120px;
  width: 100%;
}

th,
td {
  border-bottom: 1px solid var(--subtle-border);
  padding: 0.7rem 0.8rem;
  text-align: left;
  vertical-align: top;
}

th {
  color: var(--text-secondary);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.text-cell {
  color: var(--text-primary);
  font-weight: 650;
  max-width: 320px;
  overflow-wrap: anywhere;
}

.difficulty-pill {
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.7rem;
  font-weight: 800;
  padding: 0.24rem 0.5rem;
  text-transform: uppercase;
}

.difficulty-easy {
  background: rgba(16, 185, 129, 0.16);
  color: #34d399;
}

.difficulty-medium {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}

.difficulty-hard {
  background: rgba(239, 68, 68, 0.16);
  color: #fca5a5;
}

.modal-overlay {
  align-items: center;
  background: var(--overlay-bg);
  backdrop-filter: var(--glass-blur-soft);
  -webkit-backdrop-filter: var(--glass-blur-soft);
  display: flex;
  inset: 0;
  justify-content: center;
  overflow-y: auto;
  padding: 1.5rem;
  position: fixed;
  z-index: 1000;
}

.modal-box {
  background: var(--glass-panel);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-shadow), var(--glass-highlight-strong);
  max-height: calc(100vh - 3rem);
  overflow: hidden;
  width: min(100%, 560px);
}

.modal-header,
.modal-actions {
  border-bottom: 1px solid var(--subtle-border);
  justify-content: space-between;
  padding: 1rem 1.25rem;
}

.modal-actions {
  border-bottom: 0;
  border-top: 1px solid var(--subtle-border);
  justify-content: flex-end;
}

.modal-content {
  padding: 1.25rem;
}

.icon-button {
  align-items: center;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  font-size: 1.25rem;
  height: 36px;
  justify-content: center;
  line-height: 1;
  width: 36px;
}

.compact-empty {
  padding: 3rem 1rem;
}

@media (max-width: 1180px) {
  .filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .filter-grid {
    grid-template-columns: 1fr;
  }

  .filter-actions,
  .modal-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-buttons {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .action-button {
    width: 100%;
  }
}
</style>
