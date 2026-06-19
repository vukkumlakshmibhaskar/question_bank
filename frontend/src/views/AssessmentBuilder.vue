<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotificationStore } from '../stores/notification'
import api from '../services/api'

const router = useRouter()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()

const userRole = computed(() => authStore.userRole)
const canWrite = computed(() => userRole.value === 'ADMIN' || authStore.user?.permissions?.includes('questions:write'))

const loading = ref(false)
const saving = ref(false)
const validating = ref(false)
const generating = ref(false)
const mappingSections = ref(false)
const errorMessage = ref('')
const testPapers = ref([])
const questionBanks = ref([])
const selectedPaperId = ref('')
const selectedBankIds = ref([])
const setCount = ref(1)
const replaceExisting = ref(true)
const sections = ref([])
const validation = ref(null)

const unpackRows = (payload) => {
  if (Array.isArray(payload)) return payload
  return payload?.rows || payload?.data || payload?.items || []
}

const selectedPaper = computed(() =>
  testPapers.value.find((paper) => paper.id === parseInt(selectedPaperId.value)),
)

const selectedBankSummary = computed(() => {
  if (selectedBankIds.value.length === 0) return 'No banks selected'
  return `${selectedBankIds.value.length} bank${selectedBankIds.value.length === 1 ? '' : 's'} selected`
})

const totalRequired = computed(() =>
  sections.value.reduce((sum, section) => sum + (parseInt(section.requiredCount) || 0), 0),
)

const totalOptional = computed(() =>
  sections.value.reduce((sum, section) => sum + (parseInt(section.optionalCount) || 0), 0),
)

const validationState = computed(() => {
  if (!validation.value) return 'Not checked'
  return validation.value.valid ? 'Ready' : 'Needs attention'
})

onMounted(async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const [papersResponse, banksResponse] = await Promise.all([
      api.get('/test-papers'),
      api.get('/question-banks'),
    ])
    testPapers.value = unpackRows(papersResponse.data)
    questionBanks.value = unpackRows(banksResponse.data)
    if (testPapers.value[0]) {
      selectedPaperId.value = testPapers.value[0].id
    }
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to load assessment builder data.'
  } finally {
    loading.value = false
  }
})

watch(selectedPaperId, async (value) => {
  validation.value = null
  if (!value) {
    sections.value = []
    selectedBankIds.value = []
    return
  }
  await loadBlueprint()
})

const loadBlueprint = async () => {
  if (!selectedPaperId.value) return
  try {
    const response = await api.get(`/test-papers/${selectedPaperId.value}/blueprint`)
    sections.value = (response.data.sections || []).map(normalizeSectionForForm)
    const paper = selectedPaper.value
    selectedBankIds.value = normalizeIdArray(paper?.defaultQuestionBankIds)
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to load section blueprint.'
  }
}

const normalizeSectionForForm = (section = {}, index = 0) => ({
  id: section.id,
  sectionName: section.sectionName || `Section ${index + 1}`,
  sectionOrder: section.sectionOrder || index + 1,
  startsAtQuestion: section.startsAtQuestion || '',
  endsAtQuestion: section.endsAtQuestion || '',
  requiredCount: section.requiredCount || 0,
  optionalCount: section.optionalCount || 0,
  marksPerQuestion: section.marksPerQuestion || '',
  questionType: section.questionType || '',
  sourceBankIds: normalizeIdArray(section.sourceBankIds),
  validationStatus: section.validationStatus || 'DRAFT',
})

const normalizeIdArray = (value) => {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((id) => parseInt(id)).filter((id) => Number.isInteger(id) && id > 0))]
}

const addSection = () => {
  const nextOrder = sections.value.length + 1
  sections.value.push(normalizeSectionForForm({
    sectionName: `Section ${String.fromCharCode(64 + nextOrder)}`,
    sectionOrder: nextOrder,
    requiredCount: 1,
    optionalCount: 0,
  }, nextOrder - 1))
}

const removeSection = (index) => {
  sections.value.splice(index, 1)
  sections.value = sections.value.map((section, idx) => ({
    ...section,
    sectionOrder: idx + 1,
  }))
  validation.value = null
}

const saveBlueprint = async () => {
  if (!selectedPaperId.value) return
  saving.value = true
  errorMessage.value = ''
  try {
    const response = await api.put(`/test-papers/${selectedPaperId.value}/blueprint`, {
      sections: sections.value.map(sectionPayload),
    })
    sections.value = (response.data.blueprint?.sections || []).map(normalizeSectionForForm)
    validation.value = null
    notificationStore.success('Assessment blueprint saved.')
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to save assessment blueprint.'
  } finally {
    saving.value = false
  }
}

const validateBlueprint = async () => {
  if (!selectedPaperId.value) return
  validating.value = true
  errorMessage.value = ''
  try {
    const response = await api.post(`/test-papers/${selectedPaperId.value}/validate-generation`, {
      questionBankIds: selectedBankIds.value,
      setCount: setCount.value,
    })
    validation.value = response.data
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to validate generation.'
  } finally {
    validating.value = false
  }
}

const applySectionMapping = async () => {
  if (!selectedPaperId.value) return
  mappingSections.value = true
  errorMessage.value = ''
  try {
    const response = await api.post(`/test-papers/${selectedPaperId.value}/apply-section-map`, {
      questionBankIds: selectedBankIds.value,
      setCount: setCount.value,
    })
    validation.value = response.data.validation
    notificationStore.success(`Section mapping applied to ${response.data.updatedCount || 0} questions.`)
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to apply section mapping.'
  } finally {
    mappingSections.value = false
  }
}

const generateSets = async () => {
  if (!selectedPaperId.value) return
  generating.value = true
  errorMessage.value = ''
  try {
    await api.post(`/test-papers/${selectedPaperId.value}/sets/generate`, {
      mode: 'SECTION_BLUEPRINT',
      setCount: setCount.value,
      questionBankIds: selectedBankIds.value,
      replaceExisting: replaceExisting.value,
    })
    notificationStore.success('Section-wise question sets generated.')
    await validateBlueprint()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Unable to generate section-wise sets.'
  } finally {
    generating.value = false
  }
}

const sectionPayload = (section) => ({
  sectionName: section.sectionName,
  sectionOrder: parseInt(section.sectionOrder) || 1,
  startsAtQuestion: section.startsAtQuestion || null,
  endsAtQuestion: section.endsAtQuestion || null,
  requiredCount: parseInt(section.requiredCount) || 0,
  optionalCount: parseInt(section.optionalCount) || 0,
  marksPerQuestion: section.marksPerQuestion || null,
  questionType: section.questionType || null,
  sourceBankIds: normalizeIdArray(section.sourceBankIds),
  validationStatus: section.validationStatus || 'DRAFT',
})

const toggleBank = (bankId) => {
  const parsed = parseInt(bankId)
  if (selectedBankIds.value.includes(parsed)) {
    selectedBankIds.value = selectedBankIds.value.filter((id) => id !== parsed)
  } else {
    selectedBankIds.value = [...selectedBankIds.value, parsed]
  }
  validation.value = null
}

const bankQuestionCount = (bank) => bank._count?.bankQuestions || bank.bankQuestions?.length || 0

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="dashboard-wrapper assessment-builder-page">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-logo">Q</div>
        <span class="brand-name">QBank Platform</span>
      </div>

      <nav class="sidebar-nav">
        <router-link to="/dashboard" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>Dashboard</span>
        </router-link>

        <router-link to="/questions" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10,9 9,9 8,9" />
          </svg>
          <span>Question Bank</span>
        </router-link>

        <router-link to="/manage-questions" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <span>Manage Questions</span>
        </router-link>

        <router-link to="/manage-multi-questions" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="18" height="4" rx="1" />
            <rect x="3" y="10" width="18" height="10" rx="1" />
            <line x1="7" y1="14" x2="17" y2="14" />
            <line x1="7" y1="17" x2="13" y2="17" />
          </svg>
          <span>Manage Multi Questions</span>
        </router-link>

        <router-link to="/extraction" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          <span>Extraction</span>
        </router-link>

        <router-link v-if="userRole === 'ADMIN'" to="/evaluator-bulk-upload" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
          <span>Evaluator Bulk Upload</span>
        </router-link>

        <router-link v-if="userRole === 'ADMIN' || userRole === 'TEACHER'" to="/test-papers" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 7h5l2 2h11v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          <span>Test Papers</span>
        </router-link>

        <router-link
          v-if="userRole === 'ADMIN' || userRole === 'TEACHER'"
          to="/assessment-builder"
          class="nav-item"
        >
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
            <line x1="8" y1="7" x2="16" y2="7" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
          <span>Assessment Builder</span>
        </router-link>

        <router-link v-if="userRole === 'ADMIN' || userRole === 'TEACHER'" to="/subjects" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
          </svg>
          <span>Subjects & Chapters</span>
        </router-link>

        <router-link v-if="userRole === 'ADMIN'" to="/admin/users" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <span>User Manager</span>
        </router-link>

        <router-link to="/reviews" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>Extraction Reviews</span>
        </router-link>

        <router-link v-if="userRole === 'ADMIN'" to="/admin/audit-logs" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="14" y2="17" />
          </svg>
          <span>Audit Logs</span>
        </router-link>

        <router-link v-if="userRole === 'ADMIN'" to="/telescope" class="nav-item">
          <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="3" />
            <path d="M3 12h3m12 0h3M12 3v3m0 12v3" />
            <circle cx="12" cy="12" r="8" />
          </svg>
          <span>Telescope</span>
        </router-link>
      </nav>

      <div class="sidebar-footer">
        <div class="user-profile">
          <div class="user-avatar">{{ authStore.user?.name ? authStore.user.name.charAt(0) : 'U' }}</div>
          <div class="user-info">
            <span class="user-name">{{ authStore.user?.name || 'User Name' }}</span>
            <span class="user-role badge" :class="`badge-${userRole?.toLowerCase()}`">{{ userRole || 'TEACHER' }}</span>
          </div>
        </div>
        <button class="btn btn-secondary" @click="handleLogout">Sign Out</button>
      </div>
    </aside>

    <main class="main-content builder-main">
      <header class="builder-header">
        <div>
          <p class="eyebrow">Assessment Production</p>
          <h1>Assessment Builder</h1>
        </div>
        <div class="header-actions">
          <router-link class="builder-button secondary" to="/test-papers">Test Papers</router-link>
          <button class="builder-button" :disabled="saving || !canWrite" @click="saveBlueprint">
            {{ saving ? 'Saving...' : 'Save Blueprint' }}
          </button>
        </div>
      </header>

      <section class="stepper">
        <span class="done">Upload</span>
        <span class="active">Section Map</span>
        <span>Review</span>
        <span>Approve</span>
        <span>Blueprint</span>
        <span>Validate</span>
        <span>Generate</span>
        <span>Preview</span>
        <span>Publish</span>
      </section>

      <div v-if="errorMessage" class="builder-alert">{{ errorMessage }}</div>
      <div v-if="loading" class="builder-loading">Loading assessment builder...</div>

      <div v-else class="builder-grid">
        <section class="builder-panel setup-panel">
          <h2>Production Setup</h2>
          <label>
            Assessment
            <select v-model="selectedPaperId">
              <option value="">Select assessment</option>
              <option v-for="paper in testPapers" :key="paper.id" :value="paper.id">
                {{ paper.title }} - {{ paper.subject?.name || 'No subject' }}
              </option>
            </select>
          </label>

          <div class="meta-strip" v-if="selectedPaper">
            <span>{{ selectedPaper.classGrade }}</span>
            <span>{{ selectedPaper.totalMarks }} marks</span>
            <span>{{ selectedPaper.status }}</span>
          </div>

          <div class="bank-picker">
            <div class="panel-row">
              <h3>Question Banks</h3>
              <span>{{ selectedBankSummary }}</span>
            </div>
            <button
              v-for="bank in questionBanks"
              :key="bank.id"
              type="button"
              class="bank-option"
              :class="{ selected: selectedBankIds.includes(bank.id) }"
              @click="toggleBank(bank.id)"
            >
              <span>{{ bank.name }}</span>
              <small>{{ bankQuestionCount(bank) }} questions</small>
            </button>
          </div>
        </section>

        <section class="builder-panel blueprint-panel">
          <div class="panel-row">
            <div>
              <h2>Section Blueprint</h2>
              <p>{{ totalRequired }} required, {{ totalOptional }} optional</p>
            </div>
            <button class="builder-button secondary" :disabled="!canWrite" @click="addSection">Add Section</button>
          </div>

          <div v-if="sections.length === 0" class="empty-state">
            Add sections like Section A, Section B, or any paper-specific section name.
          </div>

          <div v-else class="section-list">
            <article v-for="(section, index) in sections" :key="`${section.id || 'new'}-${index}`" class="section-card">
              <div class="section-card-header">
                <div class="section-card-title">
                  <span class="section-chip">Section {{ section.sectionOrder || index + 1 }}</span>
                  <input
                    v-model="section.sectionName"
                    :disabled="!canWrite"
                    class="section-title-input"
                    placeholder="Section name"
                  />
                </div>
                <button class="builder-icon-button danger" :disabled="!canWrite" @click="removeSection(index)">Remove</button>
              </div>

              <div class="section-fields">
                <label>
                  Order
                  <input v-model.number="section.sectionOrder" :disabled="!canWrite" type="number" min="1" />
                </label>
                <label>
                  Starts At
                  <input v-model.number="section.startsAtQuestion" :disabled="!canWrite" type="number" min="1" placeholder="1" />
                </label>
                <label>
                  Ends At
                  <input v-model.number="section.endsAtQuestion" :disabled="!canWrite" type="number" min="1" placeholder="28" />
                </label>
                <label>
                  Required
                  <input v-model.number="section.requiredCount" :disabled="!canWrite" type="number" min="0" placeholder="0" />
                </label>
                <label>
                  Optional
                  <input v-model.number="section.optionalCount" :disabled="!canWrite" type="number" min="0" placeholder="0" />
                </label>
                <label>
                  Marks / Question
                  <input v-model.number="section.marksPerQuestion" :disabled="!canWrite" type="number" min="1" placeholder="1" />
                </label>
                <label class="section-type-field">
                  Question Type
                  <input v-model="section.questionType" :disabled="!canWrite" placeholder="Example: 1 Mark (MCQ)" />
                </label>
              </div>
            </article>
          </div>
        </section>

        <aside class="builder-panel validation-panel">
          <div class="panel-row">
            <div>
              <h2>Validation</h2>
              <p>{{ validationState }}</p>
            </div>
            <span class="status-pill" :class="{ ready: validation?.valid }">{{ validationState }}</span>
          </div>

          <div class="generation-controls">
            <label>
              Sets
              <input v-model.number="setCount" type="number" min="1" max="20" />
            </label>
            <label class="check-row">
              <input v-model="replaceExisting" type="checkbox" />
              Replace existing sets
            </label>
          </div>

          <div class="action-stack">
            <button
              class="builder-button secondary"
              :disabled="mappingSections || !selectedPaperId || !selectedBankIds.length || !canWrite"
              @click="applySectionMapping"
            >
              {{ mappingSections ? 'Mapping...' : 'Apply Section Mapping' }}
            </button>
            <button class="builder-button secondary" :disabled="validating || !selectedPaperId" @click="validateBlueprint">
              {{ validating ? 'Checking...' : 'Validate' }}
            </button>
            <button class="builder-button" :disabled="generating || !selectedPaperId || !canWrite" @click="generateSets">
              {{ generating ? 'Generating...' : 'Generate Sets' }}
            </button>
          </div>

          <div v-if="validation?.sections?.length" class="validation-list">
            <div v-for="section in validation.sections" :key="section.sectionName" class="validation-item">
              <strong>{{ section.sectionName }}</strong>
              <span>{{ section.availableQuestionCount }} available / {{ section.requiredQuestionCount }} needed</span>
            </div>
          </div>

          <div v-if="validation?.issues?.length" class="issue-list">
            <div v-for="issue in validation.issues" :key="`${issue.code}-${issue.sectionName || issue.message}`" class="issue-item">
              <strong>{{ issue.code }}</strong>
              <span>{{ issue.message }}</span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  </div>
</template>

<style scoped>
.assessment-builder-page {
  min-height: 100vh;
  background: var(--bg-app);
  color: var(--text-primary);
}

.builder-main {
  min-width: 0;
  overflow: auto;
  padding: clamp(1rem, 2vw, 1.5rem);
}

.builder-header,
.panel-row,
.header-actions,
.action-stack {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.builder-header {
  margin-bottom: 1rem;
}

.eyebrow {
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  margin: 0 0 0.25rem;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  margin: 0;
}

h1 {
  font-size: 1.6rem;
}

h2 {
  font-size: 1rem;
}

h3 {
  font-size: 0.9rem;
}

.stepper {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.stepper span,
.status-pill,
.meta-strip span {
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 700;
  padding: 0.45rem 0.7rem;
  white-space: nowrap;
}

.stepper .done,
.stepper .active,
.status-pill.ready {
  background: rgba(16, 185, 129, 0.15);
  border-color: rgba(16, 185, 129, 0.35);
  color: #34d399;
}

.stepper .active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.45);
  color: var(--primary);
}

.builder-grid {
  display: grid;
  grid-template-areas:
    "setup blueprint"
    "setup validation";
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.builder-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
}

.builder-panel p {
  color: var(--text-secondary);
  font-size: 0.86rem;
  margin-top: 0.25rem;
}

label {
  display: grid;
  gap: 0.4rem;
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 700;
}

select,
input {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: var(--bg-input);
  color: var(--text-primary);
  font: inherit;
  padding: 0.65rem 0.75rem;
}

.setup-panel {
  grid-area: setup;
  display: grid;
  gap: 1rem;
}

.blueprint-panel {
  grid-area: blueprint;
  min-width: 0;
}

.meta-strip,
.generation-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.bank-picker,
.validation-list,
.issue-list {
  display: grid;
  gap: 0.6rem;
}

.bank-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 7px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0.7rem;
  text-align: left;
}

.bank-option.selected {
  border-color: rgba(99, 102, 241, 0.7);
  background: rgba(99, 102, 241, 0.16);
}

.bank-option small {
  color: var(--text-secondary);
}

.section-list {
  display: grid;
  gap: 0.85rem;
  margin-top: 1rem;
}

.section-card {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-input);
  padding: 0.9rem;
}

.section-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.section-card-title {
  display: grid;
  flex: 1;
  gap: 0.45rem;
  min-width: 0;
}

.section-chip {
  width: fit-content;
  border: 1px solid rgba(99, 102, 241, 0.36);
  border-radius: 999px;
  background: rgba(99, 102, 241, 0.12);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 800;
  padding: 0.28rem 0.55rem;
  text-transform: uppercase;
}

.section-title-input {
  font-size: 1rem;
  font-weight: 800;
}

.section-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
  margin-top: 0.85rem;
}

.section-type-field {
  grid-column: span 2;
  min-width: 220px;
}

.builder-button,
.builder-icon-button {
  border: 1px solid rgba(99, 102, 241, 0.45);
  border-radius: 7px;
  background: var(--primary);
  color: white;
  cursor: pointer;
  font-weight: 800;
  padding: 0.65rem 0.9rem;
  text-decoration: none;
}

.builder-button.secondary,
.builder-icon-button {
  background: transparent;
  color: var(--text-primary);
}

.builder-button:disabled,
.builder-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.builder-icon-button {
  color: #fca5a5;
}

.validation-panel {
  grid-area: validation;
  display: grid;
  gap: 1rem;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.check-row input {
  width: auto;
}

.validation-item,
.issue-item,
.builder-alert,
.builder-loading,
.empty-state {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.85rem;
}

.validation-item,
.issue-item {
  display: grid;
  gap: 0.25rem;
}

.validation-item span,
.issue-item span {
  color: var(--text-secondary);
  font-size: 0.84rem;
}

.issue-item {
  border-color: rgba(245, 158, 11, 0.4);
}

.builder-alert {
  border-color: rgba(239, 68, 68, 0.35);
  color: #fca5a5;
  margin-bottom: 1rem;
}

.builder-loading,
.empty-state {
  color: var(--text-secondary);
}

@media (max-width: 1180px) {
  .builder-grid {
    grid-template-areas:
      "setup"
      "blueprint"
      "validation";
    grid-template-columns: 1fr;
  }
}

@media (max-width: 780px) {
  .builder-header,
  .header-actions,
  .panel-row {
    align-items: stretch;
    flex-direction: column;
  }

  .section-card-header {
    align-items: stretch;
    flex-direction: column;
  }

  .section-type-field {
    grid-template-columns: 1fr;
    grid-column: auto;
  }
}
</style>
