<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotificationStore } from '../stores/notification'
import { useConfirmationStore } from '../stores/confirmation'
import api from '../services/api'
import { PAGE_SIZE_OPTIONS, createPagination, unpackPaginated } from '../utils/pagination'

const router = useRouter()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const confirmationStore = useConfirmationStore()

const userRole = computed(() => authStore.userRole)
const userPermissions = computed(() => authStore.user?.permissions || [])
const canWrite = computed(() => {
  return ['ADMIN', 'TEACHER'].includes(userRole.value) || userPermissions.value.includes('questions:write')
})

const loading = ref(false)
const saving = ref(false)
const linking = ref(false)
const subjectsLoading = ref(false)
const subjectsError = ref('')
const bankDetailLoading = ref(false)
const bankDetailError = ref('')
const subjects = ref([])
const questionBanks = ref([])
const selectedBankDetail = ref(null)
const questions = ref([])
const pagination = ref(createPagination(10))

const filters = ref({
  bankId: '',
  parentTopicId: '',
  subTopicId: '',
  questionMode: '',
  questionNo: '',
  questionText: '',
  complexity: '',
  sourceFileName: '',
})

const isViewModalOpen = ref(false)
const isQuestionModalOpen = ref(false)
const isLinkModalOpen = ref(false)
const selectedQuestion = ref(null)
const editingQuestion = ref(null)
const linkTargetQuestion = ref(null)
const linkBankId = ref('')
const hydratingForm = ref(false)

const questionContent = ref('')
const questionType = ref('MCQ')
const questionDifficulty = ref('MEDIUM')
const questionStatus = ref('DRAFT')
const formSubjectId = ref('')
const formChapterId = ref('')
const formConceptId = ref('')
const questionExplanation = ref('')
const answers = ref([
  { content: '', isCorrect: false, explanation: '' },
  { content: '', isCorrect: false, explanation: '' },
])

const questionModeOptions = [
  { value: '', label: 'All Modes' },
  { value: 'AUDIO', label: 'Audio' },
  { value: 'CHECKBOX', label: 'CheckBox' },
  { value: 'IMAGE', label: 'Image' },
  { value: 'LIST', label: 'List' },
  { value: 'RICHTEXTEDITOR', label: 'RichTextEditor' },
  { value: 'TEXT_PARAGRAPH', label: 'Text / Paragraph' },
  { value: 'VIDEO', label: 'Video' },
]

const complexityOptions = [
  { value: '', label: 'All Complexity' },
  { value: 'EASY', label: 'Easy' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HARD', label: 'Hard' },
]

const typeOptions = [
  { value: 'MCQ', label: 'MCQ' },
  { value: 'TRUE_FALSE', label: 'True / False' },
  { value: 'SHORT_ANSWER', label: 'Short Answer' },
  { value: 'ESSAY', label: 'Essay' },
]

const statusOptions = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'PENDING_REVIEW', label: 'Pending Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
]

const formChaptersList = computed(() => {
  if (!formSubjectId.value) return []
  const subject = subjects.value.find((item) => item.id === parseInt(formSubjectId.value))
  return subject?.chapters || []
})

const formConceptsList = computed(() => {
  if (!formChapterId.value) return []
  const chapter = formChaptersList.value.find((item) => item.id === parseInt(formChapterId.value))
  return chapter?.concepts || []
})

const parentTopicOptions = computed(() => {
  const topicMap = new Map()

  if (!filters.value.bankId) {
    return []
  }

  if (selectedBankDetail.value) {
    for (const bankQuestion of selectedBankDetail.value.bankQuestions || []) {
      const chapter = bankQuestion.question?.concept?.chapter
      if (!chapter) continue
      topicMap.set(chapter.id, {
        id: chapter.id,
        name: chapter.name,
        subjectName: chapter.subject?.name || '',
      })
    }
  }

  return Array.from(topicMap.values()).sort((left, right) =>
    topicLabel(left).localeCompare(topicLabel(right)),
  )
})

const subTopicOptions = computed(() => {
  if (!filters.value.parentTopicId) return []
  const conceptMap = new Map()
  const parentId = parseInt(filters.value.parentTopicId)

  if (selectedBankDetail.value) {
    for (const bankQuestion of selectedBankDetail.value.bankQuestions || []) {
      const concept = bankQuestion.question?.concept
      if (!concept || concept.chapter?.id !== parentId) continue
      conceptMap.set(concept.id, concept)
    }
  } else {
    for (const subject of subjects.value) {
      for (const chapter of subject.chapters || []) {
        if (chapter.id !== parentId) continue
        for (const concept of chapter.concepts || []) {
          conceptMap.set(concept.id, concept)
        }
      }
    }
  }

  return Array.from(conceptMap.values()).sort((left, right) =>
    String(left.name || '').localeCompare(String(right.name || '')),
  )
})

const availableLinkBanks = computed(() => {
  if (!linkTargetQuestion.value) return questionBanks.value
  const linkedIds = new Set((linkTargetQuestion.value.bankQuestions || []).map((item) => item.bankId))
  return questionBanks.value.filter((bank) => !linkedIds.has(bank.id))
})

const selectedBankName = computed(() => {
  const bank = questionBanks.value.find((item) => item.id === parseInt(filters.value.bankId))
  return bank?.name || ''
})

watch(formSubjectId, () => {
  if (hydratingForm.value) return
  formChapterId.value = ''
  formConceptId.value = ''
})

watch(formChapterId, () => {
  if (hydratingForm.value) return
  formConceptId.value = ''
})

watch(questionType, (newType) => {
  if (hydratingForm.value) return
  resetAnswersForType(newType)
})

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const fetchSubjects = async () => {
  subjectsLoading.value = true
  subjectsError.value = ''
  try {
    const response = await api.get('/subjects')
    subjects.value = response.data || []
  } catch (err) {
    subjectsError.value = err.response?.data?.error || 'Failed to load taxonomy.'
    throw err
  } finally {
    subjectsLoading.value = false
  }
}

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

    const response = await api.get('/questions', { params })
    const unpacked = unpackPaginated(response.data, {
      ...pagination.value,
      page,
    })
    questions.value = unpacked.rows
    pagination.value = unpacked.pagination
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load questions.')
  } finally {
    loading.value = false
  }
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

const clearFilters = async () => {
  filters.value = {
    bankId: '',
    parentTopicId: '',
    subTopicId: '',
    questionMode: '',
    questionNo: '',
    questionText: '',
    complexity: '',
    sourceFileName: '',
  }
  selectedBankDetail.value = null
  await fetchQuestions(1)
}

const resetQuestionForm = () => {
  editingQuestion.value = null
  questionContent.value = ''
  questionType.value = 'MCQ'
  questionDifficulty.value = 'MEDIUM'
  questionStatus.value = 'DRAFT'
  formSubjectId.value = ''
  formChapterId.value = ''
  formConceptId.value = ''
  questionExplanation.value = ''
  resetAnswersForType('MCQ')
}

const resetAnswersForType = (type) => {
  if (type === 'MCQ') {
    answers.value = [
      { content: '', isCorrect: false, explanation: '' },
      { content: '', isCorrect: false, explanation: '' },
    ]
    return
  }

  if (type === 'TRUE_FALSE') {
    answers.value = [
      { content: 'True', isCorrect: true, explanation: '' },
      { content: 'False', isCorrect: false, explanation: '' },
    ]
    return
  }

  answers.value = []
}

const openCreateQuestion = () => {
  resetQuestionForm()
  isQuestionModalOpen.value = true
}

const openEditQuestion = async (question) => {
  try {
    const response = await api.get(`/questions/${question.id}`)
    const detail = response.data
    hydratingForm.value = true
    editingQuestion.value = detail
    questionContent.value = detail.content || ''
    questionType.value = detail.type || 'MCQ'
    questionDifficulty.value = detail.difficulty || 'MEDIUM'
    questionStatus.value = detail.status || 'DRAFT'
    formSubjectId.value = detail.concept?.chapter?.subject?.id
      ? String(detail.concept.chapter.subject.id)
      : ''
    formChapterId.value = detail.concept?.chapter?.id ? String(detail.concept.chapter.id) : ''
    formConceptId.value = detail.concept?.id ? String(detail.concept.id) : ''
    questionExplanation.value = detail.explanation || ''
    answers.value = (detail.answers || []).map((answer) => ({
      content: answer.content || '',
      isCorrect: Boolean(answer.isCorrect),
      explanation: answer.explanation || '',
    }))
    if (answers.value.length === 0) resetAnswersForType(questionType.value)
    hydratingForm.value = false
    isQuestionModalOpen.value = true
  } catch (err) {
    hydratingForm.value = false
    notificationStore.error(err.response?.data?.error || 'Failed to open question.')
  }
}

const closeQuestionModal = () => {
  if (saving.value) return
  isQuestionModalOpen.value = false
  resetQuestionForm()
}

const addAnswerOption = () => {
  answers.value.push({ content: '', isCorrect: false, explanation: '' })
}

const removeAnswerOption = (index) => {
  if (answers.value.length > 2) answers.value.splice(index, 1)
}

const setTrueFalseCorrect = (index) => {
  answers.value = answers.value.map((answer, answerIndex) => ({
    ...answer,
    isCorrect: answerIndex === index,
  }))
}

const buildQuestionPayload = () => ({
  question: {
    content: questionContent.value,
    type: questionType.value,
    difficulty: questionDifficulty.value,
    status: questionStatus.value,
    explanation: questionExplanation.value,
    conceptId: parseInt(formConceptId.value),
    sourceFileId: editingQuestion.value?.sourceFileId || null,
  },
  answers: answers.value,
})

const validateQuestionForm = () => {
  if (!questionContent.value.trim() || !formConceptId.value) {
    notificationStore.error('Question text and sub topic are required.')
    return false
  }

  if (questionType.value === 'MCQ') {
    if (answers.value.some((answer) => !answer.content.trim())) {
      notificationStore.error('Fill all MCQ options before saving.')
      return false
    }
    if (!answers.value.some((answer) => answer.isCorrect)) {
      notificationStore.error('Select at least one correct MCQ option.')
      return false
    }
  }

  return true
}

const handleSaveQuestion = async () => {
  if (!validateQuestionForm()) return

  saving.value = true
  try {
    const payload = buildQuestionPayload()
    if (editingQuestion.value) {
      await api.put(`/questions/${editingQuestion.value.id}`, payload)
      notificationStore.success('Question updated successfully.')
    } else {
      await api.post('/questions', payload)
      notificationStore.success('Question created successfully.')
    }
    closeQuestionModal()
    await fetchQuestions()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to save question.')
  } finally {
    saving.value = false
  }
}

const openQuestion = (question) => {
  selectedQuestion.value = question
  isViewModalOpen.value = true
}

const closeViewModal = () => {
  isViewModalOpen.value = false
  selectedQuestion.value = null
}

const canDeleteQuestion = (question) => {
  if (!canWrite.value) return false
  if (userRole.value === 'ADMIN') return true
  return question.createdById === parseInt(authStore.user?.id)
}

const handleDeleteQuestion = async (question) => {
  const ok = await confirmationStore.ask({
    title: 'Delete Question',
    message: `Delete Question #${question.id}? This removes it from banks and generated paper links.`,
    confirmText: 'Delete',
    isDanger: true,
  })

  if (!ok) return

  try {
    await api.delete(`/questions/${question.id}`)
    notificationStore.success('Question deleted successfully.')
    await fetchQuestions()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to delete question.')
  }
}

const openLinkModal = (question) => {
  linkTargetQuestion.value = question
  linkBankId.value = filters.value.bankId || ''
  if (linkBankId.value && questionLinkedToBank(question, linkBankId.value)) {
    linkBankId.value = ''
  }
  isLinkModalOpen.value = true
}

const closeLinkModal = () => {
  if (linking.value) return
  isLinkModalOpen.value = false
  linkTargetQuestion.value = null
  linkBankId.value = ''
}

const handleLinkToBank = async () => {
  if (!linkTargetQuestion.value || !linkBankId.value) {
    notificationStore.error('Select a question bank before linking.')
    return
  }

  linking.value = true
  try {
    await api.post(`/question-banks/${linkBankId.value}/questions`, {
      questionId: linkTargetQuestion.value.id,
    })
    notificationStore.success('Question linked to bank successfully.')
    closeLinkModal()
    await fetchQuestionBanks()
    if (filters.value.bankId) await fetchSelectedBankDetail()
    await fetchQuestions()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to link question.')
  } finally {
    linking.value = false
  }
}

const questionLinkedToBank = (question, bankId) => {
  return (question.bankQuestions || []).some((item) => Number(item.bankId) === Number(bankId))
}

const topicLabel = (topic) => {
  return [topic.subjectName, topic.name].filter(Boolean).join(' / ') || topic.name || '-'
}

const questionScope = (question) => {
  const concept = question.concept
  return [
    concept?.chapter?.subject?.name,
    concept?.chapter?.name,
    concept?.name,
  ].filter(Boolean).join(' / ') || '-'
}

const sourceFileLabel = (question) => {
  return question.sourceFile?.fileName || question.sourceFileName || question.sourceReference || question.attachments?.[0]?.fileName || '-'
}

const linkedBanksLabel = (question) => {
  const names = (question.bankQuestions || []).map((item) => item.bank?.name).filter(Boolean)
  return names.length ? names.join(', ') : 'Not linked'
}

const questionModeLabel = (question) => {
  const files = [question.sourceFile, ...(question.attachments || [])].filter(Boolean)
  if (files.some((file) => String(file.mimeType || '').startsWith('audio/'))) return 'Audio'
  if (files.some((file) => String(file.mimeType || '').startsWith('image/'))) return 'Image'
  if (files.some((file) => String(file.mimeType || '').startsWith('video/'))) return 'Video'
  if (question.type === 'MCQ') return 'CheckBox'
  if (question.type === 'TRUE_FALSE') return 'List'
  if (question.type === 'ESSAY') return 'RichTextEditor'
  return 'Text / Paragraph'
}

const shortText = (value, limit = 150) => {
  const text = String(value || '')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

const difficultyClass = (difficulty) => `difficulty-${String(difficulty || '').toLowerCase()}`

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
    await Promise.all([fetchSubjects(), fetchQuestionBanks()])
    await fetchQuestions()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to prepare Manage Questions.')
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
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
          Dashboard
        </router-link>
        <router-link to="/questions" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          Question Bank
        </router-link>
        <router-link to="/manage-questions" class="nav-item active">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/></svg>
          Manage Questions
        </router-link>
        <router-link to="/manage-multi-questions" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="5" rx="1"/><rect x="4" y="11" width="16" height="9" rx="1"/><path d="M8 14h8M8 17h5"/></svg>
          Manage Multi Questions
        </router-link>
        <router-link to="/extraction" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
          Extraction
        </router-link>
        <router-link to="/evaluator-bulk-upload" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>
          Evaluator Bulk Upload
        </router-link>
        <router-link to="/test-papers" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Test Papers
        </router-link>
        <router-link to="/assessment-builder" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h3"/></svg>
          Assessment Builder
        </router-link>
        <router-link to="/subjects" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          Subjects & Chapters
        </router-link>
<router-link to="/admin/users" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          User Manager
        </router-link>
<router-link to="/reviews" class="nav-item">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Extraction Reviews
        </router-link>
<router-link to="/admin/audit-logs" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg class="nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Audit Logs
        </router-link>
        <router-link to="/telescope" class="nav-item" v-if="userRole === 'ADMIN'">
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
        <button class="btn btn-secondary btn-sm" type="button" @click="handleLogout">
          Sign Out
        </button>
      </div>
    </aside>

    <main class="main-content">
      <header class="header">
        <div>
          <p class="page-kicker">Question Workspace</p>
          <h2 class="page-title">Manage Questions</h2>
        </div>
        <div class="header-actions">
          <button class="btn btn-primary btn-sm action-button" type="button" v-if="canWrite" @click="openCreateQuestion">
            Add Question
          </button>
        </div>
      </header>

      <div class="content-body fade-in-el">
        <section class="section-card filter-workspace">
          <div class="filter-grid">
            <div class="form-group">
              <label class="form-label" for="mq-bank">Question Bank</label>
              <select id="mq-bank" v-model="filters.bankId" class="form-control" @change="handleQuestionBankChange">
                <option value="">All Question Banks</option>
                <option v-for="bank in questionBanks" :key="bank.id" :value="bank.id">
                  {{ bank.name }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="mq-parent-topic">Parent Topic</label>
              <select
                id="mq-parent-topic"
                v-model="filters.parentTopicId"
                class="form-control"
                :disabled="!filters.bankId || bankDetailLoading || parentTopicOptions.length === 0"
                @change="handleParentTopicChange"
              >
                <option value="">
                  {{ !filters.bankId ? 'Select question bank first' : bankDetailLoading ? 'Loading topics...' : 'All Parent Topics' }}
                </option>
                <option v-for="topic in parentTopicOptions" :key="topic.id" :value="topic.id">
                  {{ topicLabel(topic) }}
                </option>
              </select>
              <span v-if="bankDetailError" class="field-help is-error">{{ bankDetailError }}</span>
              <span v-else-if="filters.bankId && !bankDetailLoading && parentTopicOptions.length === 0" class="field-help">No parent topics found in this bank.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="mq-sub-topic">Sub Topic</label>
              <select
                id="mq-sub-topic"
                v-model="filters.subTopicId"
                class="form-control"
                :disabled="!filters.parentTopicId || subTopicOptions.length === 0"
                @change="fetchQuestions(1)"
              >
                <option value="">{{ !filters.parentTopicId ? 'Select parent topic first' : 'All Sub Topics' }}</option>
                <option v-for="topic in subTopicOptions" :key="topic.id" :value="topic.id">
                  {{ topic.name }}
                </option>
              </select>
              <span v-if="filters.parentTopicId && subTopicOptions.length === 0" class="field-help">No sub topics found under this parent topic.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="mq-mode">Question Mode</label>
              <select id="mq-mode" v-model="filters.questionMode" class="form-control" @change="fetchQuestions(1)">
                <option v-for="mode in questionModeOptions" :key="mode.value" :value="mode.value">
                  {{ mode.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="mq-no">Question No.</label>
              <input
                id="mq-no"
                v-model="filters.questionNo"
                class="form-control"
                type="number"
                min="1"
                placeholder="ID number"
                @keyup.enter="fetchQuestions(1)"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="mq-text">Question Text</label>
              <input
                id="mq-text"
                v-model="filters.questionText"
                class="form-control"
                type="search"
                placeholder="Search question text..."
                @keyup.enter="fetchQuestions(1)"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="mq-complexity">Complexity</label>
              <select id="mq-complexity" v-model="filters.complexity" class="form-control" @change="fetchQuestions(1)">
                <option v-for="item in complexityOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="mq-source">Source File Name</label>
              <input
                id="mq-source"
                v-model="filters.sourceFileName"
                class="form-control"
                type="search"
                placeholder="PDF or Drive file..."
                @keyup.enter="fetchQuestions(1)"
              />
            </div>
          </div>

          <div class="filter-actions">
            <div class="filter-summary">
              <strong>{{ pagination.total }}</strong>
              <span>result{{ pagination.total === 1 ? '' : 's' }}</span>
              <span v-if="selectedBankName">in {{ selectedBankName }}</span>
            </div>
            <div class="filter-buttons">
              <button class="btn btn-primary btn-sm action-button" type="button" @click="fetchQuestions(1)">
                Search
              </button>
              <button class="btn btn-secondary btn-sm action-button" type="button" @click="clearFilters">
                Clear
              </button>
            </div>
          </div>
        </section>

        <section class="section-card results-card">
          <div class="section-header">
            <div>
              <h3 class="section-title">Single Question Results</h3>
              <p class="section-subtitle">Open, edit, delete, or link questions without losing your filters.</p>
            </div>
            <button class="btn btn-secondary btn-sm action-button" type="button" :disabled="loading" @click="fetchQuestions()">
              Refresh
            </button>
          </div>

          <div v-if="loading" class="spinner-container manage-spinner">
            <div class="spinner"></div>
            <p class="spinner-text">Searching questions...</p>
          </div>

          <div v-else-if="questions.length === 0" class="empty-state compact-empty">
            <h3>No questions found</h3>
            <p>Adjust filters or clear the workspace to see more questions.</p>
          </div>

          <div v-else class="question-result-list">
            <article v-for="question in questions" :key="question.id" class="question-result-card">
              <div class="question-card-top">
                <div class="question-badges">
                  <span class="badge badge-admin">No. {{ question.id }}</span>
                  <span class="mode-pill">{{ questionModeLabel(question) }}</span>
                  <span class="difficulty-pill" :class="difficultyClass(question.difficulty)">
                    {{ question.difficulty }}
                  </span>
                  <span class="status-pill">{{ question.status }}</span>
                </div>
                <div class="question-actions">
                  <button class="btn btn-secondary btn-sm action-button" type="button" @click="openQuestion(question)">
                    Open
                  </button>
                  <button class="btn btn-secondary btn-sm action-button" type="button" v-if="canWrite" @click="openEditQuestion(question)">
                    Edit
                  </button>
                  <button class="btn btn-secondary btn-sm action-button" type="button" v-if="canWrite" @click="openLinkModal(question)">
                    Link to Bank
                  </button>
                  <button class="btn btn-danger btn-sm action-button" type="button" v-if="canDeleteQuestion(question)" @click="handleDeleteQuestion(question)">
                    Delete
                  </button>
                </div>
              </div>

              <p class="question-text">{{ shortText(question.content) }}</p>

              <div class="question-meta-grid">
                <div>
                  <span>Parent / Sub Topic</span>
                  <strong>{{ questionScope(question) }}</strong>
                </div>
                <div>
                  <span>Question Banks</span>
                  <strong>{{ linkedBanksLabel(question) }}</strong>
                </div>
                <div>
                  <span>Source File</span>
                  <strong>{{ sourceFileLabel(question) }}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{{ formatDate(question.updatedAt) }}</strong>
                </div>
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

    <div v-if="isViewModalOpen" class="modal-overlay" @click.self="closeViewModal">
      <div class="modal-box question-modal">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Question No. {{ selectedQuestion?.id }}</p>
            <h3>Question Details</h3>
          </div>
          <button type="button" class="icon-button" aria-label="Close details" @click="closeViewModal">&times;</button>
        </div>

        <div class="modal-content">
          <div class="detail-stack">
            <div>
              <span>Question Text</span>
              <p>{{ selectedQuestion?.content }}</p>
            </div>
            <div class="question-meta-grid">
              <div>
                <span>Mode</span>
                <strong>{{ questionModeLabel(selectedQuestion || {}) }}</strong>
              </div>
              <div>
                <span>Complexity</span>
                <strong>{{ selectedQuestion?.difficulty }}</strong>
              </div>
              <div>
                <span>Source File</span>
                <strong>{{ sourceFileLabel(selectedQuestion || {}) }}</strong>
              </div>
              <div>
                <span>Source Type</span>
                <strong>{{ selectedQuestion?.sourceType || 'MANUAL' }}</strong>
              </div>
              <div>
                <span>Import Job / Review</span>
                <strong>
                  {{ selectedQuestion?.importJobId ? `Job #${selectedQuestion.importJobId}` : '-' }}
                  {{ selectedQuestion?.extractionReviewId ? ` / Review #${selectedQuestion.extractionReviewId}` : '' }}
                </strong>
              </div>
              <div>
                <span>Question Banks</span>
                <strong>{{ linkedBanksLabel(selectedQuestion || {}) }}</strong>
              </div>
            </div>
            <div v-if="selectedQuestion?.answers?.length">
              <span>Answers</span>
              <div class="answer-list">
                <div v-for="answer in selectedQuestion.answers" :key="answer.id" class="answer-row" :class="{ correct: answer.isCorrect }">
                  <strong>{{ answer.isCorrect ? 'Correct' : 'Option' }}</strong>
                  <p>{{ answer.content }}</p>
                </div>
              </div>
            </div>
            <div v-if="selectedQuestion?.explanation">
              <span>Explanation</span>
              <p>{{ selectedQuestion.explanation }}</p>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm action-button" type="button" @click="closeViewModal">Close</button>
        </div>
      </div>
    </div>

    <div v-if="isQuestionModalOpen" class="modal-overlay" @click.self="closeQuestionModal">
      <form class="modal-box question-modal" @submit.prevent="handleSaveQuestion">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Single Question</p>
            <h3>{{ editingQuestion ? `Edit Question #${editingQuestion.id}` : 'Add Question' }}</h3>
          </div>
          <button type="button" class="icon-button" aria-label="Close question editor" @click="closeQuestionModal">&times;</button>
        </div>

        <div class="modal-content">
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="form-subject">Subject</label>
              <select id="form-subject" v-model="formSubjectId" class="form-control" :disabled="subjectsLoading" required>
                <option value="">{{ subjectsLoading ? 'Loading subjects...' : 'Select...' }}</option>
                <option v-for="subject in subjects" :key="subject.id" :value="subject.id">
                  {{ subject.name }}
                </option>
              </select>
              <span v-if="subjectsError" class="field-help is-error">{{ subjectsError }}</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="form-chapter">Parent Topic</label>
              <select id="form-chapter" v-model="formChapterId" class="form-control" :disabled="!formSubjectId || formChaptersList.length === 0" required>
                <option value="">{{ !formSubjectId ? 'Select subject first' : 'Select...' }}</option>
                <option v-for="chapter in formChaptersList" :key="chapter.id" :value="chapter.id">
                  {{ chapter.name }}
                </option>
              </select>
              <span v-if="formSubjectId && formChaptersList.length === 0" class="field-help">No parent topics found for this subject.</span>
            </div>

            <div class="form-group">
              <label class="form-label" for="form-concept">Sub Topic</label>
              <select id="form-concept" v-model="formConceptId" class="form-control" :disabled="!formChapterId || formConceptsList.length === 0" required>
                <option value="">{{ !formChapterId ? 'Select parent topic first' : 'Select...' }}</option>
                <option v-for="concept in formConceptsList" :key="concept.id" :value="concept.id">
                  {{ concept.name }}
                </option>
              </select>
              <span v-if="formChapterId && formConceptsList.length === 0" class="field-help">No sub topics found for this parent topic.</span>
            </div>

            <div class="form-group form-span-3">
              <label class="form-label" for="form-content">Question Text</label>
              <textarea id="form-content" v-model="questionContent" class="form-control textarea-control" required></textarea>
            </div>

            <div class="form-group">
              <label class="form-label" for="form-type">Question Type</label>
              <select id="form-type" v-model="questionType" class="form-control">
                <option v-for="item in typeOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="form-difficulty">Complexity</label>
              <select id="form-difficulty" v-model="questionDifficulty" class="form-control">
                <option value="EASY">Easy</option>
                <option value="MEDIUM">Medium</option>
                <option value="HARD">Hard</option>
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="form-status">Status</label>
              <select id="form-status" v-model="questionStatus" class="form-control">
                <option v-for="item in statusOptions" :key="item.value" :value="item.value">
                  {{ item.label }}
                </option>
              </select>
            </div>

            <div v-if="questionType === 'MCQ'" class="form-group form-span-3 answer-builder">
              <div class="mini-header">
                <label class="form-label">Answer Options</label>
                <button type="button" class="link-button" @click="addAnswerOption">Add Option</button>
              </div>
              <div v-for="(answer, index) in answers" :key="index" class="answer-edit-row">
                <input v-model="answer.isCorrect" type="checkbox" />
                <input v-model="answer.content" class="form-control" type="text" :placeholder="`Option ${index + 1}`" required />
                <button type="button" class="icon-button compact" :disabled="answers.length <= 2" @click="removeAnswerOption(index)">
                  &times;
                </button>
              </div>
            </div>

            <div v-if="questionType === 'TRUE_FALSE'" class="form-group form-span-3 true-false-grid">
              <label class="choice-card">
                <input type="radio" name="tf-correct" :checked="answers[0]?.isCorrect" @change="setTrueFalseCorrect(0)" />
                <span>True is correct</span>
              </label>
              <label class="choice-card">
                <input type="radio" name="tf-correct" :checked="answers[1]?.isCorrect" @change="setTrueFalseCorrect(1)" />
                <span>False is correct</span>
              </label>
            </div>

            <div class="form-group form-span-3">
              <label class="form-label" for="form-explanation">Explanation</label>
              <textarea id="form-explanation" v-model="questionExplanation" class="form-control textarea-control small"></textarea>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm action-button" type="button" @click="closeQuestionModal">Cancel</button>
          <button class="btn btn-primary btn-sm action-button" type="submit" :disabled="saving">
            {{ saving ? 'Saving...' : 'Save Question' }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="isLinkModalOpen" class="modal-overlay" @click.self="closeLinkModal">
      <div class="modal-box link-modal">
        <div class="modal-header">
          <div>
            <p class="page-kicker">Question No. {{ linkTargetQuestion?.id }}</p>
            <h3>Link to Question Bank</h3>
          </div>
          <button type="button" class="icon-button" aria-label="Close link modal" @click="closeLinkModal">&times;</button>
        </div>

        <div class="modal-content">
          <p class="modal-help">{{ shortText(linkTargetQuestion?.content, 220) }}</p>
          <div class="form-group">
            <label class="form-label" for="link-bank">Question Bank</label>
            <select id="link-bank" v-model="linkBankId" class="form-control">
              <option value="">Select bank...</option>
              <option v-for="bank in availableLinkBanks" :key="bank.id" :value="bank.id">
                {{ bank.name }}
              </option>
            </select>
          </div>
          <div v-if="availableLinkBanks.length === 0" class="mini-empty">
            This question is already linked to all available banks.
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary btn-sm action-button" type="button" @click="closeLinkModal">Cancel</button>
          <button class="btn btn-primary btn-sm action-button" type="button" :disabled="linking || !linkBankId" @click="handleLinkToBank">
            {{ linking ? 'Linking...' : 'Link Question' }}
          </button>
        </div>
      </div>
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
.question-card-top,
.question-actions,
.question-badges,
.modal-actions,
.mini-header {
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
  gap: 0.4rem;
}

.filter-summary strong {
  color: var(--text-primary);
  font-size: 1.3rem;
}

.section-subtitle {
  color: var(--text-muted);
  font-size: 0.86rem;
  margin-top: 0.25rem;
}

.manage-spinner {
  padding: 4rem 1rem;
}

.question-result-list {
  display: grid;
  gap: 1rem;
}

.question-result-card {
  background: var(--glass-control);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-highlight-strong);
  padding: 1.15rem;
}

.question-card-top {
  align-items: flex-start;
  justify-content: space-between;
}

.question-actions,
.question-badges {
  flex-wrap: wrap;
}

.question-actions {
  justify-content: flex-end;
}

.question-text {
  color: var(--text-primary);
  font-size: 1.05rem;
  font-weight: 650;
  line-height: 1.5;
  margin: 0.9rem 0 1rem;
  overflow-wrap: anywhere;
}

.question-meta-grid {
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.question-meta-grid > div {
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid var(--subtle-border);
  border-radius: var(--radius-sm);
  min-width: 0;
  padding: 0.65rem 0.75rem;
}

.question-meta-grid span,
.detail-stack span {
  color: var(--text-muted);
  display: block;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
}

.question-meta-grid strong {
  color: var(--text-primary);
  display: block;
  font-size: 0.84rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.mode-pill,
.difficulty-pill,
.status-pill {
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 800;
  padding: 0.3rem 0.58rem;
  text-transform: uppercase;
}

.mode-pill {
  background: rgba(99, 102, 241, 0.16);
  color: #c4b5fd;
}

.status-pill {
  background: rgba(148, 163, 184, 0.14);
  color: var(--text-secondary);
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

.btn-danger {
  background-color: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.28);
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
  width: min(100%, 860px);
}

.question-modal {
  width: min(100%, 920px);
}

.link-modal {
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
  max-height: calc(100vh - 13rem);
  overflow-y: auto;
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

.icon-button.compact {
  flex: 0 0 38px;
  height: 38px;
  width: 38px;
}

.form-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.form-grid .form-group {
  margin-bottom: 0;
}

.form-span-3 {
  grid-column: span 3;
}

.textarea-control {
  min-height: 110px;
  resize: vertical;
}

.textarea-control.small {
  min-height: 80px;
}

.answer-builder {
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid var(--subtle-border);
  border-radius: var(--radius-md);
  padding: 1rem;
}

.mini-header {
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.link-button {
  background: transparent;
  border: 0;
  color: var(--primary);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
}

.answer-edit-row {
  align-items: center;
  display: grid;
  gap: 0.65rem;
  grid-template-columns: 24px minmax(0, 1fr) 38px;
  margin-top: 0.55rem;
}

.answer-edit-row input[type='checkbox'],
.choice-card input {
  accent-color: var(--primary);
}

.true-false-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.choice-card {
  align-items: center;
  background: var(--glass-control);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  gap: 0.65rem;
  padding: 0.85rem 1rem;
}

.detail-stack {
  display: grid;
  gap: 1rem;
}

.detail-stack p {
  color: var(--text-primary);
  line-height: 1.5;
  margin: 0;
  overflow-wrap: anywhere;
}

.answer-list {
  display: grid;
  gap: 0.55rem;
}

.answer-row {
  background: var(--glass-control);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-sm);
  padding: 0.75rem;
}

.answer-row.correct {
  border-color: rgba(16, 185, 129, 0.45);
}

.answer-row strong {
  color: var(--text-secondary);
  display: block;
  font-size: 0.78rem;
  margin-bottom: 0.25rem;
}

.modal-help,
.mini-empty {
  color: var(--text-secondary);
}

.mini-empty {
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem;
  text-align: center;
}

.compact-empty {
  padding: 3rem 1rem;
}

@media (max-width: 1180px) {
  .filter-grid,
  .question-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .filter-grid,
  .question-meta-grid,
  .form-grid,
  .true-false-grid {
    grid-template-columns: 1fr;
  }

  .form-span-3 {
    grid-column: span 1;
  }

  .filter-actions,
  .question-card-top,
  .modal-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-buttons,
  .question-actions {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
  }

  .action-button {
    width: 100%;
  }

  .modal-overlay {
    padding: 0.75rem;
  }

  .modal-box {
    max-height: calc(100dvh - 1.5rem);
  }
}
</style>
