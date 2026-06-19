<script setup>
import { ref, onMounted, computed, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useNotificationStore } from '../stores/notification'
import { useConfirmationStore } from '../stores/confirmation'
import api from '../services/api'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const confirmationStore = useConfirmationStore()
const userRole = computed(() => authStore.userRole)
const userPermissions = computed(() => authStore.user?.permissions || [])

const canApprove = computed(() => userRole.value === 'ADMIN' || userPermissions.value.includes('questions:approve'))
const canWrite = computed(() => userRole.value === 'ADMIN' || userPermissions.value.includes('questions:write'))

const reviewId = route.params.id
const review = ref(null)
const subjects = ref([])
const loading = ref(false)
const saving = ref(false)
const approving = ref(false)
const rejecting = ref(false)
const normalizingSections = ref(false)
const mediaUploading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

// Collapsed states for UI tree
const collapsedChapters = ref({})
const collapsedConcepts = ref({})
const showPromptRaw = ref(false)
const showLegacyTree = ref(false)
const selectedSectionKey = ref('all')
const questionFilter = ref('all')
const questionSearch = ref('')

const getMediaUrl = (path) => {
  if (!path) return ''
  const value = String(path)
  if (/^(https?:|data:|blob:)/i.test(value)) return value
  const apiRoot = (api.defaults.baseURL || '').replace(/\/api\/?$/, '')
  const mediaUrl = `${apiRoot}${value.startsWith('/') ? value : `/${value}`}`
  if (value.startsWith('/api/extraction/') && authStore.accessToken) {
    const url = new URL(mediaUrl)
    url.searchParams.set('access_token', authStore.accessToken)
    return url.toString()
  }
  return mediaUrl
}

const uploadMediaFile = async (file) => {
  if (!file) return ''
  if (!String(file.type || '').startsWith('image/')) {
    throw new Error('Please upload a JPG, PNG, or GIF image.')
  }

  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post('/uploads/media', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return response.data?.file?.filePath || ''
}

const getPastedImageFile = (event) => {
  const items = Array.from(event.clipboardData?.items || [])
  const imageItem = items.find((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
  return imageItem?.getAsFile() || null
}

const handleReviewQuestionImageUpload = async (event, question) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  mediaUploading.value = true
  try {
    question.imageUrl = await uploadMediaFile(file)
  } catch (err) {
    errorMessage.value = err.response?.data?.error || err.message || 'Failed to upload question image.'
  } finally {
    mediaUploading.value = false
  }
}

const handleReviewQuestionImagePaste = async (event, question) => {
  const file = getPastedImageFile(event)
  if (!file) return

  event.preventDefault()
  mediaUploading.value = true
  try {
    question.imageUrl = await uploadMediaFile(file)
    notificationStore.success('Question image added.')
  } catch (err) {
    errorMessage.value = err.response?.data?.error || err.message || 'Failed to paste question image.'
  } finally {
    mediaUploading.value = false
  }
}

const handleReviewAnswerImageUpload = async (event, answer) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  mediaUploading.value = true
  try {
    answer.imageUrl = await uploadMediaFile(file)
  } catch (err) {
    errorMessage.value = err.response?.data?.error || err.message || 'Failed to upload option image.'
  } finally {
    mediaUploading.value = false
  }
}

const handleReviewAnswerImagePaste = async (event, answer) => {
  const file = getPastedImageFile(event)
  if (!file) return

  event.preventDefault()
  mediaUploading.value = true
  try {
    answer.imageUrl = await uploadMediaFile(file)
    notificationStore.success('Option image added.')
  } catch (err) {
    errorMessage.value = err.response?.data?.error || err.message || 'Failed to paste option image.'
  } finally {
    mediaUploading.value = false
  }
}

// Extracted data model
const extractedData = ref({
  subjectId: '',
  chapters: []
})

const sectionSummary = computed(() => extractedData.value.sectionMap?.sections || [])
const sectionIssues = computed(() => extractedData.value.sectionMap?.validation || [])
const sectionWorkflowEnabled = computed(() => Boolean(extractedData.value.sectionWorkflow?.enabled))

const cleanText = (value) => String(value ?? '').trim()
const sectionKey = (value) => cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unassigned'

const parseQuestionNumber = (value) => {
  const match = cleanText(value).match(/\d+/)
  return match ? Number.parseInt(match[0], 10) : null
}

const getQuestionDisplayNo = (question, fallbackIndex = 0) => (
  cleanText(question?.sourceQuestionNo || question?.questionNo || question?.questionUid) ||
  `Row ${fallbackIndex + 1}`
)

const getQuestionDisplayLabel = (question, fallbackIndex = 0) => {
  const no = getQuestionDisplayNo(question, fallbackIndex)
  const row = question?.extractionRowIndex || question?.sourceRowIndex
  return row ? `Q ${no} | Row ${row}` : `Q ${no}`
}

const getIssueDisplayLabel = (issue) => {
  const parsed = parseQuestionNumber(issue?.questionUid)
  return parsed ? `Q ${parsed}` : issue?.questionUid || 'Question'
}

const sectionByKey = computed(() => {
  const map = new Map()
  for (const section of sectionSummary.value) {
    map.set(sectionKey(section.sectionName), section)
  }
  return map
})

const issuesByQuestionUid = computed(() => {
  const map = new Map()
  for (const issue of sectionIssues.value) {
    const uid = cleanText(issue.questionUid)
    if (!uid) continue
    if (!map.has(uid)) map.set(uid, [])
    map.get(uid).push(issue)
  }
  return map
})

const flattenedQuestions = computed(() => {
  const rows = []
  let globalIndex = 0
  const chapters = extractedData.value.chapters || []
  chapters.forEach((chapter, chIdx) => {
    ;(chapter.concepts || []).forEach((concept, coIdx) => {
      ;(concept.questions || []).forEach((question, qIdx) => {
        const uid = cleanText(question.questionUid) || `QROW${globalIndex + 1}`
        const sourceNo = getQuestionDisplayNo(question, globalIndex)
        const baseNo = parseQuestionNumber(sourceNo)
        const key = `${uid}-${chIdx}-${coIdx}-${qIdx}`
        const sKey = sectionKey(question.sectionName)
        const section = sectionByKey.value.get(sKey)
        const warnings = issuesByQuestionUid.value.get(uid) || []
        rows.push({
          key,
          uid,
          sourceNo,
          baseNo,
          globalIndex: globalIndex + 1,
          chapter,
          concept,
          question,
          chIdx,
          coIdx,
          qIdx,
          sectionKey: sKey,
          sectionName: question.sectionName || 'Unassigned',
          sectionOrder: question.sectionOrder || section?.sectionOrder || 999,
          section,
          warnings,
          hasWarning: warnings.length > 0,
          hasLowConfidence: !['VERIFIED', 'HIGH'].includes(cleanText(question.sectionConfidence).toUpperCase()),
        })
        globalIndex += 1
      })
    })
  })

  return rows.sort((left, right) => (
    (left.sectionOrder - right.sectionOrder) ||
    ((left.question.sourcePageNo || 9999) - (right.question.sourcePageNo || 9999)) ||
    ((left.baseNo || 9999) - (right.baseNo || 9999)) ||
    (left.globalIndex - right.globalIndex)
  ))
})

const sectionOptions = computed(() => {
  const bySection = new Map()
  for (const item of flattenedQuestions.value) {
    if (!bySection.has(item.sectionKey)) {
      bySection.set(item.sectionKey, {
        key: item.sectionKey,
        name: item.sectionName,
        order: item.sectionOrder,
        count: 0,
        warningCount: 0,
      })
    }
    const section = bySection.get(item.sectionKey)
    section.count += 1
    if (item.hasWarning || item.hasLowConfidence) section.warningCount += 1
  }
  return Array.from(bySection.values()).sort((left, right) => left.order - right.order)
})

const visibleQuestionItems = computed(() => {
  const search = cleanText(questionSearch.value).toLowerCase()
  return flattenedQuestions.value.filter((item) => {
    if (selectedSectionKey.value !== 'all' && item.sectionKey !== selectedSectionKey.value) return false
    if (questionFilter.value === 'warnings' && !(item.hasWarning || item.hasLowConfidence)) return false
    if (!search) return true
    const haystack = [
      item.sourceNo,
      item.uid,
      item.sectionName,
      item.question.content,
      item.question.questionHeader,
      item.globalIndex,
    ].map((value) => cleanText(value).toLowerCase()).join(' ')
    return haystack.includes(search)
  })
})

const visibleSectionGroups = computed(() => {
  const groups = new Map()
  for (const item of visibleQuestionItems.value) {
    if (!groups.has(item.sectionKey)) {
      groups.set(item.sectionKey, {
        key: item.sectionKey,
        name: item.sectionName,
        section: item.section,
        items: [],
      })
    }
    groups.get(item.sectionKey).items.push(item)
  }
  return Array.from(groups.values()).sort((left, right) => {
    const leftOrder = left.section?.sectionOrder || left.items[0]?.sectionOrder || 999
    const rightOrder = right.section?.sectionOrder || right.items[0]?.sectionOrder || 999
    return leftOrder - rightOrder
  })
})

const sectionQuestionStats = computed(() => ({
  total: flattenedQuestions.value.length,
  visible: visibleQuestionItems.value.length,
  warnings: flattenedQuestions.value.filter((item) => item.hasWarning || item.hasLowConfidence).length,
}))

const selectSection = (key) => {
  selectedSectionKey.value = key
}

const scrollToQuestion = async (item) => {
  if (!item) return
  selectedSectionKey.value = item.sectionKey
  await nextTick()
  document.getElementById(`review-question-${item.key}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  })
}

const jumpToIssue = (issue) => {
  const item = flattenedQuestions.value.find((candidate) => candidate.uid === issue.questionUid)
  if (item) scrollToQuestion(item)
}

const markSectionVerified = (question) => {
  question.sectionConfidence = 'VERIFIED'
  question.sectionEvidence = {
    ...(question.sectionEvidence || {}),
    signals: [...new Set([...(question.sectionEvidence?.signals || []), 'reviewer-verified'])],
    reviewedAt: new Date().toISOString(),
  }
}

onMounted(async () => {
  await fetchSubjects()
  await fetchReviewDetails()
})

const fetchSubjects = async () => {
  try {
    const response = await api.get('/subjects')
    subjects.value = response.data
  } catch (err) {
    console.error('Failed to load subjects:', err)
  }
}

const fetchReviewDetails = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await api.get(`/reviews/${reviewId}`)
    review.value = response.data
    if (response.data && response.data.extractedData) {
      // Deep clone the extracted data
      extractedData.value = JSON.parse(JSON.stringify(response.data.extractedData))
    }
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to load review details.'
  } finally {
    loading.value = false
  }
}

// Collapsing helpers
const toggleChapter = (index) => {
  collapsedChapters.value[index] = !collapsedChapters.value[index]
}
const toggleConcept = (chIdx, coIdx) => {
  const key = `${chIdx}-${coIdx}`
  collapsedConcepts.value[key] = !collapsedConcepts.value[key]
}

// Hierarchy Mutation Functions
const addChapter = () => {
  extractedData.value.chapters.push({
    name: 'New Chapter',
    description: '',
    concepts: []
  })
}

const removeChapter = async (chIdx) => {
  const ok = await confirmationStore.ask({
    title: 'Remove Chapter',
    message: 'Are you sure you want to remove this chapter and all its concepts/questions?',
    confirmText: 'Remove',
    isDanger: true
  })
  if (ok) {
    extractedData.value.chapters.splice(chIdx, 1)
  }
}

const addConcept = (chIdx) => {
  extractedData.value.chapters[chIdx].concepts.push({
    name: 'New Concept',
    description: '',
    questions: []
  })
  collapsedChapters.value[chIdx] = false // Expand parent chapter
}

const removeConcept = async (chIdx, coIdx) => {
  const ok = await confirmationStore.ask({
    title: 'Remove Concept',
    message: 'Are you sure you want to remove this concept and all its questions?',
    confirmText: 'Remove',
    isDanger: true
  })
  if (ok) {
    extractedData.value.chapters[chIdx].concepts.splice(coIdx, 1)
  }
}

const addQuestion = (chIdx, coIdx) => {
  extractedData.value.chapters[chIdx].concepts[coIdx].questions.push({
    content: 'New Question Text',
    imageUrl: '',
    type: 'MCQ',
    difficulty: 'MEDIUM',
    explanation: '',
    answers: [
      { content: 'Option A', imageUrl: '', isCorrect: true, explanation: '' },
      { content: 'Option B', imageUrl: '', isCorrect: false, explanation: '' }
    ]
  })
  const key = `${chIdx}-${coIdx}`
  collapsedConcepts.value[key] = false // Expand parent concept
}

const removeQuestion = async (chIdx, coIdx, qIdx) => {
  const ok = await confirmationStore.ask({
    title: 'Remove Question',
    message: 'Are you sure you want to remove this question?',
    confirmText: 'Remove',
    isDanger: true
  })
  if (ok) {
    extractedData.value.chapters[chIdx].concepts[coIdx].questions.splice(qIdx, 1)
  }
}

const addAnswer = (chIdx, coIdx, qIdx) => {
  extractedData.value.chapters[chIdx].concepts[coIdx].questions[qIdx].answers.push({
    content: '',
    imageUrl: '',
    isCorrect: false,
    explanation: ''
  })
}

const removeAnswer = (chIdx, coIdx, qIdx, aIdx) => {
  extractedData.value.chapters[chIdx].concepts[coIdx].questions[qIdx].answers.splice(aIdx, 1)
}

const handleQuestionTypeChange = (chIdx, coIdx, qIdx) => {
  const q = extractedData.value.chapters[chIdx].concepts[coIdx].questions[qIdx]
  if (q.type === 'TRUE_FALSE') {
    q.answers = [
      { content: 'True', imageUrl: '', isCorrect: true },
      { content: 'False', imageUrl: '', isCorrect: false }
    ]
  } else if (q.type === 'MCQ' && q.answers.length === 0) {
    q.answers = [
      { content: 'Option A', imageUrl: '', isCorrect: true, explanation: '' },
      { content: 'Option B', imageUrl: '', isCorrect: false, explanation: '' }
    ]
  } else if (q.type === 'SHORT_ANSWER' || q.type === 'ESSAY') {
    q.answers = []
  }
}

const handleSetCorrectAnswer = (chIdx, coIdx, qIdx, aIdx) => {
  const q = extractedData.value.chapters[chIdx].concepts[coIdx].questions[qIdx]
  if (q.type === 'MCQ' || q.type === 'TRUE_FALSE') {
    q.answers.forEach((ans, idx) => {
      ans.isCorrect = (idx === aIdx)
    })
  }
}

// API save/approval functions
const handleSave = async () => {
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const response = await api.put(`/reviews/${reviewId}`, {
      extractedData: extractedData.value
    })
    successMessage.value = 'Draft corrections saved successfully.'
    review.value = response.data.review
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to save changes.'
  } finally {
    saving.value = false
  }
}

const handleNormalizeSections = async () => {
  normalizingSections.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const response = await api.post(`/reviews/${reviewId}/normalize-sections`)
    review.value = response.data.review
    extractedData.value = JSON.parse(JSON.stringify(response.data.review.extractedData))
    successMessage.value = 'Section map refreshed. Check low-confidence questions before approval.'
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to normalize review sections.'
  } finally {
    normalizingSections.value = false
  }
}

const downloadSectionWorkbook = async () => {
  errorMessage.value = ''
  try {
    const response = await api.get(`/reviews/${reviewId}/section-workbook`, {
      responseType: 'blob'
    })
    const blob = new Blob([response.data], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `extraction-review-${reviewId}-section-workbook.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(url)
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to download section workbook.'
  }
}

const handleApprove = async () => {
  approving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    await api.post(`/reviews/${reviewId}/approve`, {
      extractedData: extractedData.value
    })
    notificationStore.success('Extraction approved! Taxonomy and questions successfully imported into active tables.')
    router.push('/reviews')
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to approve review.'
  } finally {
    approving.value = false
  }
}

const handleReject = async () => {
  const ok = await confirmationStore.ask({
    title: 'Reject Extraction',
    message: 'Are you sure you want to reject this extraction? This action is permanent.',
    confirmText: 'Reject',
    isDanger: true
  })
  if (ok) {
    rejecting.value = true
    errorMessage.value = ''
    successMessage.value = ''
    try {
      await api.post(`/reviews/${reviewId}/reject`)
      notificationStore.success('Extraction rejected.')
      router.push('/reviews')
    } catch (err) {
      errorMessage.value = err.response?.data?.error || 'Failed to reject review.'
    } finally {
      rejecting.value = false
    }
  }
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="dashboard-wrapper">
    <!-- Sidebar -->
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
<router-link to="/reviews" class="nav-item active">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Extraction Reviews
        </router-link>
<router-link to="/admin/audit-logs" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
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
        <button class="btn btn-secondary btn-sm" @click="handleLogout" style="width: 100%;">
          Sign Out
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="main-content">
      <!-- Header with back button -->
      <header class="header">
        <div style="display: flex; align-items: center; gap: 1rem;">
          <router-link to="/reviews" class="btn btn-secondary btn-sm" style="width: auto; padding: 0.5rem 1rem;">
            ← Back
          </router-link>
          <h2 class="page-title">Moderate Extraction #{{ reviewId }}</h2>
        </div>
        
        <div class="header-actions" v-if="review && review.status === 'PENDING'">
          <button 
            v-if="canWrite" 
            class="btn btn-secondary btn-sm" 
            :disabled="saving || approving || rejecting"
            @click="handleSave"
            style="width: auto;"
          >
            {{ saving ? 'Saving...' : 'Save Draft' }}
          </button>
          
          <button 
            v-if="canApprove" 
            class="btn btn-primary btn-sm" 
            :disabled="saving || approving || rejecting"
            @click="handleApprove"
            style="width: auto;"
          >
            {{ approving ? 'Approving...' : 'Approve & Import' }}
          </button>
          
          <button 
            v-if="canApprove" 
            class="btn btn-secondary btn-sm btn-reject" 
            :disabled="saving || approving || rejecting"
            @click="handleReject"
            style="width: auto;"
          >
            {{ rejecting ? 'Rejecting...' : 'Reject' }}
          </button>
        </div>
      </header>

      <div class="content-body fade-in-el" style="padding-bottom: 5rem;">
        <!-- Loading -->
        <div v-if="loading" class="spinner-container" style="padding: 5rem;">
          <div class="spinner"></div>
          <div class="spinner-text">Parsing draft json payload...</div>
        </div>

        <!-- Details -->
        <div v-else-if="review">
          <!-- Messages -->
          <div v-if="errorMessage" class="alert alert-error" style="margin-bottom: 1.5rem;">
            <span>{{ errorMessage }}</span>
          </div>
          <div v-if="successMessage" class="alert alert-success" style="margin-bottom: 1.5rem;">
            <span>{{ successMessage }}</span>
          </div>

          <!-- Document details card -->
          <div class="section-card" style="margin-bottom: 1.5rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1.5rem;">
              <div>
                <span class="detail-label">File Name</span>
                <span class="detail-value">{{ review.uploadFile?.fileName }}</span>
              </div>
              <div>
                <span class="detail-label">Staging Status</span>
                <span class="badge" :class="`badge-${review.status.toLowerCase()}`">{{ review.status }}</span>
              </div>
              <div>
                <span class="detail-label">AI Version</span>
                <span class="detail-value" style="font-weight: 700; color: var(--primary);">v{{ review.version || 1 }}</span>
              </div>
              <div>
                <span class="detail-label">Mapped Target Subject</span>
                <div style="margin-top: 0.5rem;">
                  <select 
                    v-model="extractedData.subjectId" 
                    class="form-control" 
                    :disabled="!canWrite || review.status !== 'PENDING'"
                    style="margin-bottom: 0; padding: 0.4rem;"
                  >
                    <option v-for="sub in subjects" :key="sub.id" :value="sub.id">
                      {{ sub.name }}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="section-card section-workspace-card">
            <div class="section-workspace-header">
              <div>
                <span class="detail-label">Section-Aware Review</span>
                <h3>Section Map</h3>
                <p>
                  {{ sectionSummary.length }} section{{ sectionSummary.length === 1 ? '' : 's' }} detected,
                  {{ sectionIssues.length }} validation issue{{ sectionIssues.length === 1 ? '' : 's' }}.
                </p>
              </div>
              <div class="section-workspace-actions">
                <span class="section-state" :class="{ enabled: sectionWorkflowEnabled }">
                  {{ sectionWorkflowEnabled ? 'Section workflow on' : 'Legacy review' }}
                </span>
                <button
                  v-if="canWrite && review.status === 'PENDING'"
                  class="btn btn-secondary btn-sm"
                  style="width: auto;"
                  :disabled="normalizingSections"
                  @click="handleNormalizeSections"
                >
                  {{ normalizingSections ? 'Refreshing...' : 'Normalize Sections' }}
                </button>
                <button
                  class="btn btn-secondary btn-sm"
                  style="width: auto;"
                  @click="downloadSectionWorkbook"
                >
                  Download Section Workbook
                </button>
              </div>
            </div>

            <div v-if="sectionSummary.length" class="section-summary-grid">
              <div v-for="section in sectionSummary" :key="`${section.sectionName}-${section.sectionOrder}`" class="section-summary-item">
                <strong>{{ section.sectionName }}</strong>
                <span>Order {{ section.sectionOrder }}</span>
                <span v-if="section.startsAtQuestion || section.endsAtQuestion">
                  Q {{ section.startsAtQuestion || '?' }} - {{ section.endsAtQuestion || '?' }}
                </span>
                <span>{{ section.confidence || 'MEDIUM' }}</span>
              </div>
            </div>

            <div v-if="sectionIssues.length" class="section-issue-list">
              <button
                v-for="issue in sectionIssues.slice(0, 8)"
                :key="`${issue.code}-${issue.questionUid}-${issue.message}`"
                class="section-issue-item section-issue-button"
                type="button"
                @click="jumpToIssue(issue)"
              >
                <strong>{{ issue.code }}</strong>
                <span>{{ getIssueDisplayLabel(issue) }} - {{ issue.message }}</span>
              </button>
            </div>
          </div>

          <div class="section-card review-workbench-card">
            <div class="review-workbench-header">
              <div>
                <span class="detail-label">Production Review Workspace</span>
                <h3>Section Questions</h3>
                <p>
                  {{ sectionQuestionStats.visible }} visible of {{ sectionQuestionStats.total }} extracted rows.
                  {{ sectionQuestionStats.warnings }} need section review.
                </p>
              </div>
              <div class="review-workbench-tools">
                <input
                  v-model="questionSearch"
                  class="form-control question-search"
                  placeholder="Search Q no, row, text..."
                />
                <div class="segmented-control">
                  <button
                    type="button"
                    :class="{ active: questionFilter === 'all' }"
                    @click="questionFilter = 'all'"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    :class="{ active: questionFilter === 'warnings' }"
                    @click="questionFilter = 'warnings'"
                  >
                    Warnings
                  </button>
                </div>
              </div>
            </div>

            <div class="review-workbench-layout">
              <aside class="section-rail">
                <button
                  type="button"
                  class="section-rail-item"
                  :class="{ active: selectedSectionKey === 'all' }"
                  @click="selectSection('all')"
                >
                  <strong>All Sections</strong>
                  <span>{{ sectionQuestionStats.total }} rows</span>
                </button>
                <button
                  v-for="section in sectionOptions"
                  :key="section.key"
                  type="button"
                  class="section-rail-item"
                  :class="{ active: selectedSectionKey === section.key }"
                  @click="selectSection(section.key)"
                >
                  <strong>{{ section.name }}</strong>
                  <span>{{ section.count }} rows</span>
                  <em v-if="section.warningCount">{{ section.warningCount }} warnings</em>
                </button>
              </aside>

              <div class="section-question-panel">
                <div v-if="visibleSectionGroups.length === 0" class="empty-section-state">
                  No questions match the current filters.
                </div>

                <section
                  v-for="group in visibleSectionGroups"
                  :key="group.key"
                  class="section-question-group"
                >
                  <div class="section-question-group-header">
                    <div>
                      <h4>{{ group.name }}</h4>
                      <span v-if="group.section">
                        Q {{ group.section.startsAtQuestion || '?' }} - {{ group.section.endsAtQuestion || '?' }}
                        | {{ group.section.confidence || 'MEDIUM' }}
                      </span>
                    </div>
                    <strong>{{ group.items.length }} visible</strong>
                  </div>

                  <article
                    v-for="item in group.items"
                    :id="`review-question-${item.key}`"
                    :key="item.key"
                    class="section-question-card"
                    :class="{ warning: item.hasWarning || item.hasLowConfidence }"
                  >
                    <div class="section-question-card-head">
                      <div class="question-title-stack">
                        <strong>{{ getQuestionDisplayLabel(item.question, item.globalIndex - 1) }}</strong>
                        <span>
                          Source row {{ item.globalIndex }}
                          <template v-if="item.question.sourcePageNo">| Page {{ item.question.sourcePageNo }}</template>
                          <template v-if="item.concept?.name">| {{ item.concept.name }}</template>
                        </span>
                      </div>
                      <div class="question-chip-row">
                        <span class="question-chip">{{ item.question.marks || '?' }} mark</span>
                        <span class="question-chip">{{ item.question.questionTypeLabel || item.question.type }}</span>
                        <span class="question-chip" :class="{ caution: item.hasLowConfidence }">
                          {{ item.question.sectionConfidence || 'LOW' }}
                        </span>
                      </div>
                    </div>

                    <div v-if="item.warnings.length || item.hasLowConfidence" class="inline-warning-list">
                      <span v-for="warning in item.warnings" :key="`${item.key}-${warning.code}`">
                        {{ warning.code }}: {{ warning.message }}
                      </span>
                      <span v-if="item.hasLowConfidence && item.warnings.length === 0">
                        LOW_SECTION_CONFIDENCE: Section confidence must be reviewed.
                      </span>
                    </div>

                    <div class="section-card-edit-grid">
                      <label>
                        <span>Section</span>
                        <input
                          v-model="item.question.sectionName"
                          class="form-control"
                          :disabled="!canWrite || review.status !== 'PENDING'"
                        />
                      </label>
                      <label>
                        <span>Printed Q.No</span>
                        <input
                          v-model="item.question.sourceQuestionNo"
                          class="form-control"
                          :disabled="!canWrite || review.status !== 'PENDING'"
                        />
                      </label>
                      <label>
                        <span>Confidence</span>
                        <select
                          v-model="item.question.sectionConfidence"
                          class="form-control"
                          :disabled="!canWrite || review.status !== 'PENDING'"
                        >
                          <option value="VERIFIED">Verified</option>
                          <option value="HIGH">High</option>
                          <option value="MEDIUM">Medium</option>
                          <option value="LOW">Low</option>
                        </select>
                      </label>
                      <label>
                        <span>Choice Group</span>
                        <input
                          v-model="item.question.choiceGroupKey"
                          class="form-control"
                          placeholder="OR group"
                          :disabled="!canWrite || review.status !== 'PENDING'"
                        />
                      </label>
                    </div>

                    <div class="question-preview-edit">
                      <textarea
                        v-model="item.question.content"
                        rows="3"
                        placeholder="Question text..."
                        :disabled="!canWrite || review.status !== 'PENDING'"
                        @paste="handleReviewQuestionImagePaste($event, item.question)"
                      ></textarea>
                      <img
                        v-if="item.question.imageUrl"
                        :src="getMediaUrl(item.question.imageUrl)"
                        alt="Question image preview"
                      />
                    </div>

                    <div v-if="item.question.answers?.length" class="compact-options">
                      <div
                        v-for="(answer, answerIndex) in item.question.answers"
                        :key="`${item.key}-answer-${answerIndex}`"
                        class="compact-option"
                        :class="{ correct: answer.isCorrect }"
                      >
                        <span>{{ String.fromCharCode(65 + answerIndex) }}</span>
                        <input
                          v-model="answer.content"
                          :disabled="!canWrite || review.status !== 'PENDING'"
                          @paste="handleReviewAnswerImagePaste($event, answer)"
                        />
                        <img
                          v-if="answer.imageUrl"
                          :src="getMediaUrl(answer.imageUrl)"
                          alt="Option image preview"
                        />
                      </div>
                    </div>

                    <div class="section-question-actions" v-if="canWrite && review.status === 'PENDING'">
                      <button
                        type="button"
                        class="btn btn-secondary btn-sm"
                        style="width: auto;"
                        @click="markSectionVerified(item.question)"
                      >
                        Mark Verified
                      </button>
                    </div>
                  </article>
                </section>
              </div>
            </div>
          </div>

          <!-- Collapsible Prompt & Raw Response Metadata -->
          <div class="section-card" style="margin-bottom: 2rem; border-color: rgba(99, 102, 241, 0.15); background-color: rgba(99, 102, 241, 0.02);">
            <div class="payload-header">
              <span style="font-size: 0.9rem; font-weight: 600; color: var(--text-secondary);">
                🔍 View AI Extraction Prompt & Raw Gemini Payload
              </span>
              <button class="btn btn-secondary btn-sm payload-toggle" style="width: auto; padding: 0.25rem 0.75rem;" @click="showPromptRaw = !showPromptRaw">
                {{ showPromptRaw ? 'Hide Payload' : 'Show Payload' }}
              </button>
            </div>
            
            <div v-show="showPromptRaw" style="margin-top: 1.25rem; display: flex; flex-direction: column; gap: 1.25rem; border-top: 1px solid var(--border-color); padding-top: 1.25rem;">
              <div>
                <span class="detail-label" style="margin-bottom: 0.5rem;">Prompt Used</span>
                <div style="background-color: var(--bg-app); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-sm); font-family: monospace; font-size: 0.85rem; color: var(--text-primary); white-space: pre-wrap; line-height: 1.4;">
                  {{ review.promptUsed || 'No custom prompt specified.' }}
                </div>
              </div>
              
              <div>
                <span class="detail-label" style="margin-bottom: 0.5rem;">Raw Gemini JSON Response</span>
                <pre style="background-color: var(--bg-app); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-sm); font-size: 0.8rem; color: var(--success); overflow-x: auto; max-height: 250px; line-height: 1.4;">{{ JSON.stringify(review.geminiResponse, null, 2) }}</pre>
              </div>
            </div>
          </div>

          <!-- Editable Tree Container -->
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem;">
              <div>
                <h3 style="font-size: 1.25rem; font-weight: 600;">Legacy Taxonomy Editor</h3>
                <p style="margin: 0.25rem 0 0; color: var(--text-secondary); font-size: 0.9rem;">
                  Use this only for chapter/concept restructuring. Section review above is the production path.
                </p>
              </div>
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button
                  class="btn btn-secondary btn-sm"
                  style="width: auto; padding: 0.4rem 1rem;"
                  @click="showLegacyTree = !showLegacyTree"
                >
                  {{ showLegacyTree ? 'Hide Legacy Editor' : 'Show Legacy Editor' }}
                </button>
                <button
                  v-if="showLegacyTree && canWrite && review.status === 'PENDING'"
                  class="btn btn-primary btn-sm"
                  style="width: auto; padding: 0.4rem 1rem;"
                  @click="addChapter"
                >
                  + Add Chapter
                </button>
              </div>
            </div>

            <!-- Chapters list -->
            <div v-if="showLegacyTree && extractedData.chapters.length === 0" class="section-card" style="text-align: center; padding: 3rem; color: var(--text-secondary);">
              No chapters extracted. Click "+ Add Chapter" to start building.
            </div>

            <div v-else-if="showLegacyTree" class="tree-list">
              <div 
                v-for="(chapter, chIdx) in extractedData.chapters" 
                :key="chIdx" 
                class="tree-node chapter-node"
              >
                <!-- Chapter Header -->
                <div class="node-header chapter-header">
                  <div style="display: flex; align-items: center; gap: 0.75rem; flex-grow: 1;">
                    <button class="btn-collapse" @click="toggleChapter(chIdx)">
                      {{ collapsedChapters[chIdx] ? '▶' : '▼' }}
                    </button>
                    <span class="node-type-label chapter-badge">Chapter {{ chIdx + 1 }}</span>
                    <input 
                      v-model="chapter.name" 
                      class="node-title-input" 
                      placeholder="Chapter Name"
                      :disabled="!canWrite || review.status !== 'PENDING'"
                    />
                  </div>
                  
                  <div style="display: flex; gap: 0.5rem;" v-if="canWrite && review.status === 'PENDING'">
                    <button class="btn btn-secondary btn-sm" style="width: auto;" @click="addConcept(chIdx)">
                      + Add Concept
                    </button>
                    <button class="btn btn-secondary btn-sm btn-delete-node" style="width: auto;" @click="removeChapter(chIdx)">
                      Delete
                    </button>
                  </div>
                </div>

                <!-- Chapter details & concepts -->
                <div v-show="!collapsedChapters[chIdx]" class="node-body">
                  <div class="form-group" style="padding: 0 1rem; margin-bottom: 1.5rem;">
                    <label class="form-label">Chapter Description</label>
                    <textarea 
                      v-model="chapter.description" 
                      class="form-control" 
                      rows="2"
                      placeholder="Brief chapter description"
                      :disabled="!canWrite || review.status !== 'PENDING'"
                    ></textarea>
                  </div>

                  <!-- Concepts list -->
                  <div class="concepts-list">
                    <div 
                      v-for="(concept, coIdx) in chapter.concepts" 
                      :key="coIdx" 
                      class="tree-node concept-node"
                    >
                      <!-- Concept Header -->
                      <div class="node-header concept-header">
                        <div style="display: flex; align-items: center; gap: 0.75rem; flex-grow: 1;">
                          <button class="btn-collapse" @click="toggleConcept(chIdx, coIdx)">
                            {{ collapsedConcepts[`${chIdx}-${coIdx}`] ? '▶' : '▼' }}
                          </button>
                          <span class="node-type-label concept-badge">Concept</span>
                          <input 
                            v-model="concept.name" 
                            class="node-title-input" 
                            placeholder="Concept Name"
                            :disabled="!canWrite || review.status !== 'PENDING'"
                          />
                        </div>
                        
                        <div style="display: flex; gap: 0.5rem;" v-if="canWrite && review.status === 'PENDING'">
                          <button class="btn btn-secondary btn-sm" style="width: auto;" @click="addQuestion(chIdx, coIdx)">
                            + Add Question
                          </button>
                          <button class="btn btn-secondary btn-sm btn-delete-node" style="width: auto;" @click="removeConcept(chIdx, coIdx)">
                            Delete
                          </button>
                        </div>
                      </div>

                      <!-- Concept details & questions -->
                      <div v-show="!collapsedConcepts[`${chIdx}-${coIdx}`]" class="node-body concept-body-node">
                        <div class="form-group" style="padding: 0 1rem; margin-bottom: 1.5rem;">
                          <label class="form-label">Concept Description</label>
                          <textarea 
                            v-model="concept.description" 
                            class="form-control" 
                            rows="2"
                            placeholder="Brief concept description"
                            :disabled="!canWrite || review.status !== 'PENDING'"
                          ></textarea>
                        </div>

                        <!-- Questions list -->
                        <div class="questions-list">
                          <div 
                            v-for="(question, qIdx) in concept.questions" 
                            :key="qIdx" 
                            class="question-editor-card"
                          >
                            <div class="question-header">
                              <span style="font-weight: 600; font-size: 0.95rem; color: var(--primary);">{{ getQuestionDisplayLabel(question, qIdx) }}</span>
                              <button 
                                v-if="canWrite && review.status === 'PENDING'" 
                                class="btn btn-secondary btn-sm btn-delete-node" 
                                style="width: auto; padding: 0.2rem 0.6rem; font-size: 0.75rem;" 
                                @click="removeQuestion(chIdx, coIdx, qIdx)"
                              >
                                Remove Question
                              </button>
                            </div>

                            <div class="section-meta-grid">
                              <div class="form-group">
                                <label class="form-label">Section</label>
                                <input
                                  v-model="question.sectionName"
                                  class="form-control"
                                  placeholder="Section A"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                />
                              </div>
                              <div class="form-group">
                                <label class="form-label">Order</label>
                                <input
                                  v-model.number="question.sectionOrder"
                                  class="form-control"
                                  type="number"
                                  min="1"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                />
                              </div>
                              <div class="form-group">
                                <label class="form-label">Source Q.No</label>
                                <input
                                  v-model="question.sourceQuestionNo"
                                  class="form-control"
                                  placeholder="18"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                />
                              </div>
                              <div class="form-group">
                                <label class="form-label">Page</label>
                                <input
                                  v-model.number="question.sourcePageNo"
                                  class="form-control"
                                  type="number"
                                  min="1"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                />
                              </div>
                              <div class="form-group">
                                <label class="form-label">Confidence</label>
                                <select
                                  v-model="question.sectionConfidence"
                                  class="form-control"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                >
                                  <option value="VERIFIED">Verified</option>
                                  <option value="HIGH">High</option>
                                  <option value="MEDIUM">Medium</option>
                                  <option value="LOW">Low</option>
                                </select>
                              </div>
                              <div class="form-group">
                                <label class="form-label">Marks</label>
                                <input
                                  v-model.number="question.marks"
                                  class="form-control"
                                  type="number"
                                  min="1"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                />
                              </div>
                              <div class="form-group">
                                <label class="form-label">Subparts</label>
                                <input
                                  v-model.number="question.subpartCount"
                                  class="form-control"
                                  type="number"
                                  min="0"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                />
                              </div>
                              <div class="form-group">
                                <label class="form-label">Choice Group</label>
                                <input
                                  v-model="question.choiceGroupKey"
                                  class="form-control"
                                  placeholder="OR-1"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                />
                              </div>
                            </div>

                            <!-- Question Content -->
                            <div class="form-group">
                              <label class="form-label">Question Text / Image</label>
                              <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-input); padding: 0.65rem; display: flex; flex-direction: column; gap: 0.65rem; min-height: 132px;">
                                <textarea
                                  v-model="question.content"
                                  rows="3"
                                  placeholder="Write text here, or paste an image..."
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                  style="width: 100%; resize: vertical; min-height: 72px; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; line-height: 1.45;"
                                  @paste="handleReviewQuestionImagePaste($event, question)"
                                ></textarea>
                                <img
                                  v-if="question.imageUrl"
                                  :src="getMediaUrl(question.imageUrl)"
                                  alt="Question image preview"
                                  style="display: block; max-width: 100%; max-height: 240px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #fff;"
                                />
                                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                  <label
                                    v-if="canWrite && review.status === 'PENDING'"
                                    class="btn btn-secondary btn-sm"
                                    style="width: auto; margin: 0; cursor: pointer; padding: 0.3rem 0.7rem; font-size: 0.78rem;"
                                  >
                                    Add Image
                                    <input type="file" accept="image/*" :disabled="mediaUploading" @change="handleReviewQuestionImageUpload($event, question)" style="display: none;" />
                                  </label>
                                  <button
                                    v-if="question.imageUrl && canWrite && review.status === 'PENDING'"
                                    class="btn btn-secondary btn-sm btn-delete-node"
                                    style="width: auto; padding: 0.3rem 0.7rem; font-size: 0.78rem;"
                                    @click="question.imageUrl = ''"
                                  >
                                    Remove Image
                                  </button>
                                </div>
                              </div>
                            </div>

                            <!-- Options Grid -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                              <div class="form-group">
                                <label class="form-label">Question Type</label>
                                <select 
                                  v-model="question.type" 
                                  class="form-control"
                                  @change="handleQuestionTypeChange(chIdx, coIdx, qIdx)"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                >
                                  <option value="MCQ">Multiple Choice (MCQ)</option>
                                  <option value="TRUE_FALSE">True / False</option>
                                  <option value="SHORT_ANSWER">Short Answer</option>
                                  <option value="ESSAY">Essay</option>
                                </select>
                              </div>
                              
                              <div class="form-group">
                                <label class="form-label">Difficulty</label>
                                <select 
                                  v-model="question.difficulty" 
                                  class="form-control"
                                  :disabled="!canWrite || review.status !== 'PENDING'"
                                >
                                  <option value="EASY">Easy</option>
                                  <option value="MEDIUM">Medium</option>
                                  <option value="HARD">Hard</option>
                                </select>
                              </div>
                            </div>

                            <!-- Answers Section -->
                            <div v-if="question.type === 'MCQ' || question.type === 'TRUE_FALSE'" style="margin-bottom: 1.5rem;">
                              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
                                <span class="form-label" style="margin-bottom: 0;">Answer Options</span>
                                <button 
                                  v-if="canWrite && question.type === 'MCQ' && review.status === 'PENDING'" 
                                  class="btn btn-secondary btn-sm" 
                                  style="width: auto; padding: 0.15rem 0.5rem; font-size: 0.75rem;" 
                                  @click="addAnswer(chIdx, coIdx, qIdx)"
                                >
                                  + Add Option
                                </button>
                              </div>

                              <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                                <div 
                                  v-for="(ans, aIdx) in question.answers" 
                                  :key="aIdx" 
                                  class="answer-option-row"
                                >
                                  <!-- Radio select for correct answer -->
                                  <input 
                                    type="radio" 
                                    :name="`correct-q-${chIdx}-${coIdx}-${qIdx}`" 
                                    :checked="ans.isCorrect"
                                    @change="handleSetCorrectAnswer(chIdx, coIdx, qIdx, aIdx)"
                                    :disabled="!canWrite || review.status !== 'PENDING'"
                                    style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--success);"
                                    title="Mark as correct answer"
                                  />
                                  
                                  <div style="flex: 1; min-width: 220px;">
                                    <div style="border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-input); padding: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
                                      <input
                                        v-model="ans.content"
                                        placeholder="Option text or paste image..."
                                        :disabled="!canWrite || review.status !== 'PENDING'"
                                        style="width: 100%; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit;"
                                        @paste="handleReviewAnswerImagePaste($event, ans)"
                                      />
                                      <img
                                        v-if="ans.imageUrl"
                                        :src="getMediaUrl(ans.imageUrl)"
                                        alt="Option image preview"
                                        style="display: block; max-width: 260px; max-height: 140px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #fff;"
                                      />
                                      <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                                        <label
                                          v-if="canWrite && review.status === 'PENDING'"
                                          class="btn btn-secondary btn-sm"
                                          style="width: auto; margin: 0; padding: 0.25rem 0.6rem; font-size: 0.75rem; cursor: pointer;"
                                        >
                                          Add Image
                                          <input type="file" accept="image/*" :disabled="mediaUploading" @change="handleReviewAnswerImageUpload($event, ans)" style="display: none;" />
                                        </label>
                                        <button
                                          v-if="ans.imageUrl && canWrite && review.status === 'PENDING'"
                                          class="btn btn-secondary btn-sm btn-delete-node"
                                          style="width: auto; padding: 0.25rem 0.6rem; font-size: 0.75rem;"
                                          @click="ans.imageUrl = ''"
                                        >
                                          Remove Image
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  <input 
                                    v-model="ans.explanation" 
                                    class="form-control" 
                                    placeholder="Option explanation (optional)..."
                                    style="margin-bottom: 0; font-size: 0.85rem;"
                                    :disabled="!canWrite || review.status !== 'PENDING'"
                                  />

                                  <button 
                                    v-if="canWrite && question.type === 'MCQ' && question.answers.length > 2 && review.status === 'PENDING'" 
                                    class="btn btn-secondary btn-sm btn-delete-node" 
                                    style="width: auto; padding: 0.4rem; line-height: 1;" 
                                    @click="removeAnswer(chIdx, coIdx, qIdx, aIdx)"
                                    title="Delete Option"
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </div>
                            </div>

                            <!-- Explanation -->
                            <div class="form-group" style="margin-bottom: 0;">
                              <label class="form-label">Solution Explanation</label>
                              <textarea 
                                v-model="question.explanation" 
                                class="form-control" 
                                rows="2"
                                placeholder="Explain why the correct answer is correct..."
                                :disabled="!canWrite || review.status !== 'PENDING'"
                              ></textarea>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.badge-pending {
  background-color: rgba(245, 158, 11, 0.15);
  color: #fbd38d;
}
.badge-approved {
  background-color: rgba(16, 185, 129, 0.15);
  color: #a7f3d0;
}
.badge-rejected {
  background-color: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
}

.detail-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}

.detail-value {
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--text-primary);
}

.section-workspace-card {
  margin-bottom: 1.5rem;
}

.section-workspace-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.section-workspace-header h3 {
  margin: 0.15rem 0;
}

.section-workspace-header p {
  color: var(--text-secondary);
  margin: 0;
}

.section-workspace-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.section-state {
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 700;
  padding: 0.4rem 0.65rem;
}

.section-state.enabled {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(16, 185, 129, 0.35);
  color: #6ee7b7;
}

.section-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
}

.section-summary-item,
.section-issue-item {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  display: grid;
  gap: 0.25rem;
  padding: 0.75rem;
}

.section-summary-item span,
.section-issue-item span {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.section-issue-list {
  display: grid;
  gap: 0.5rem;
  margin-top: 1rem;
}

.section-issue-item {
  border-color: rgba(245, 158, 11, 0.35);
}

.section-issue-button {
  width: 100%;
  background: rgba(245, 158, 11, 0.06);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.section-issue-button:hover {
  border-color: rgba(245, 158, 11, 0.75);
  background: rgba(245, 158, 11, 0.12);
}

.review-workbench-card {
  margin-bottom: 1.5rem;
}

.review-workbench-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.review-workbench-header h3 {
  margin: 0.15rem 0;
}

.review-workbench-header p {
  color: var(--text-secondary);
  margin: 0;
}

.review-workbench-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.75rem;
}

.question-search {
  width: 260px;
  margin-bottom: 0;
}

.segmented-control {
  display: inline-flex;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.segmented-control button {
  background: transparent;
  border: 0;
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: 700;
  padding: 0.55rem 0.8rem;
}

.segmented-control button.active {
  background: var(--primary);
  color: white;
}

.review-workbench-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

.section-rail {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: grid;
  gap: 0.5rem;
  max-height: calc(100vh - 230px);
  overflow-y: auto;
  padding: 0.75rem;
  position: sticky;
  top: 1rem;
}

.section-rail-item {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  display: grid;
  gap: 0.2rem;
  padding: 0.75rem;
  text-align: left;
}

.section-rail-item span,
.section-rail-item em {
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-style: normal;
}

.section-rail-item em {
  color: #fbbf24;
}

.section-rail-item.active,
.section-rail-item:hover {
  background: rgba(99, 102, 241, 0.14);
  border-color: rgba(99, 102, 241, 0.42);
}

.section-question-panel {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.section-question-group {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.section-question-group-header {
  align-items: center;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.9rem 1rem;
}

.section-question-group-header h4 {
  margin: 0 0 0.2rem;
}

.section-question-group-header span,
.section-question-group-header strong {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.section-question-card {
  border-bottom: 1px solid var(--border-color);
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
}

.section-question-card:last-child {
  border-bottom: 0;
}

.section-question-card.warning {
  background: rgba(245, 158, 11, 0.04);
  border-left: 3px solid #f59e0b;
}

.section-question-card-head {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.question-title-stack {
  display: grid;
  gap: 0.2rem;
}

.question-title-stack span {
  color: var(--text-secondary);
  font-size: 0.84rem;
}

.question-chip-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4rem;
}

.question-chip {
  border: 1px solid var(--border-color);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 0.76rem;
  font-weight: 700;
  padding: 0.32rem 0.55rem;
}

.question-chip.caution {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.38);
  color: #fbbf24;
}

.inline-warning-list {
  display: grid;
  gap: 0.35rem;
}

.inline-warning-list span {
  color: #fbbf24;
  font-size: 0.86rem;
}

.section-card-edit-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(140px, 1fr));
  gap: 0.75rem;
}

.section-card-edit-grid label {
  display: grid;
  gap: 0.35rem;
}

.section-card-edit-grid label span {
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}

.question-preview-edit {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  display: grid;
  gap: 0.65rem;
  padding: 0.7rem;
}

.question-preview-edit textarea {
  background: transparent;
  border: 0;
  color: var(--text-primary);
  font: inherit;
  outline: 0;
  resize: vertical;
  width: 100%;
}

.question-preview-edit img {
  background: white;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  max-height: 220px;
  max-width: 100%;
  object-fit: contain;
}

.compact-options {
  display: grid;
  gap: 0.5rem;
}

.compact-option {
  align-items: start;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.55rem;
}

.compact-option.correct {
  border-color: rgba(16, 185, 129, 0.45);
}

.compact-option span {
  align-items: center;
  background: rgba(99, 102, 241, 0.16);
  border-radius: 50%;
  color: var(--text-primary);
  display: inline-flex;
  font-weight: 800;
  height: 26px;
  justify-content: center;
  width: 26px;
}

.compact-option input {
  background: transparent;
  border: 0;
  color: var(--text-primary);
  font: inherit;
  min-width: 0;
  outline: 0;
}

.compact-option img {
  background: white;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  grid-column: 2;
  max-height: 120px;
  max-width: 240px;
  object-fit: contain;
}

.section-question-actions {
  display: flex;
  justify-content: flex-end;
}

.empty-section-state {
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  padding: 2rem;
  text-align: center;
}

.section-meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.btn-reject {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}
.btn-reject:hover:not(:disabled) {
  background-color: #ef4444;
  color: white;
}

.tree-list {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.tree-node {
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.node-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid transparent;
  gap: 1rem;
}

.chapter-header {
  background-color: rgba(255, 255, 255, 0.03);
}

.node-body {
  padding: 1.25rem;
  border-top: 1px solid var(--border-color);
}

.node-title-input {
  background: transparent;
  border: 1px dashed transparent;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 1.1rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  width: 100%;
  max-width: 400px;
}
.node-title-input:hover:not(:disabled) {
  border-color: var(--border-color);
  background: rgba(255, 255, 255, 0.02);
}
.node-title-input:focus:not(:disabled) {
  border-style: solid;
  border-color: var(--primary);
  outline: none;
  background: var(--bg-app);
}

.btn-collapse {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0.25rem;
  line-height: 1;
}

.node-type-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}
.chapter-badge {
  background-color: rgba(99, 102, 241, 0.2);
  color: #c7d2fe;
}
.concept-badge {
  background-color: rgba(16, 185, 129, 0.2);
  color: #a7f3d0;
}

.btn-delete-node {
  background-color: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
  color: #fca5a5;
}
.btn-delete-node:hover:not(:disabled) {
  background-color: #ef4444;
  color: white;
}

.concepts-list {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1rem;
  background-color: rgba(0, 0, 0, 0.15);
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-color);
}

.concept-node {
  border-color: rgba(16, 185, 129, 0.2);
}

.concept-header {
  background-color: rgba(16, 185, 129, 0.03);
}

.concept-body-node {
  border-top-color: rgba(16, 185, 129, 0.2);
}

.questions-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  background-color: rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-md);
}

.question-editor-card {
  background-color: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1.25rem;
}

.question-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0.75rem;
  margin-bottom: 1rem;
}

.payload-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.answer-option-row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .header-actions {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
  }
  
  .header-actions .btn {
    width: 100% !important;
  }
  
  .payload-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }
  
  .payload-header .payload-toggle {
    width: 100% !important;
  }

  .section-workspace-header {
    flex-direction: column;
  }

  .section-workspace-actions {
    justify-content: stretch;
    width: 100%;
  }

  .section-workspace-actions .btn {
    width: 100% !important;
  }

  .section-meta-grid {
    grid-template-columns: 1fr !important;
  }

  .review-workbench-header {
    flex-direction: column;
  }

  .review-workbench-tools,
  .question-search {
    width: 100%;
  }

  .segmented-control {
    width: 100%;
  }

  .segmented-control button {
    flex: 1;
  }

  .review-workbench-layout {
    grid-template-columns: 1fr;
  }

  .section-rail {
    max-height: none;
    position: static;
  }

  .section-question-card-head,
  .section-question-group-header {
    flex-direction: column;
    align-items: stretch;
  }

  .question-chip-row {
    justify-content: flex-start;
  }

  .section-card-edit-grid {
    grid-template-columns: 1fr;
  }
  
  .node-header {
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 0.75rem !important;
    padding: 0.85rem 1rem !important;
  }
  
  .node-header > div:first-child {
    width: 100% !important;
    flex-wrap: wrap !important;
    gap: 0.5rem !important;
  }
  
  .node-title-input {
    max-width: 100% !important;
    flex: 1 1 100% !important;
    order: 3;
    margin-top: 0.25rem !important;
    border: 1px dashed var(--border-color) !important;
    padding: 0.4rem !important;
  }
  
  .node-header > div:last-child {
    display: flex !important;
    width: 100% !important;
    justify-content: flex-start !important;
    gap: 0.5rem !important;
    order: 4;
    padding-left: 2rem !important;
  }
  
  .node-header > div:last-child button {
    flex: 1 1 auto !important;
    justify-content: center !important;
  }
  
  .node-body {
    padding: 1rem 0.75rem !important;
  }
  
  .concepts-list {
    padding: 0.5rem !important;
    gap: 0.75rem !important;
  }
  
  .questions-list {
    padding: 0.5rem !important;
    gap: 0.75rem !important;
  }
  
  .question-editor-card {
    padding: 1rem 0.75rem !important;
  }
  
  .answer-option-row {
    flex-wrap: wrap;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid var(--border-color);
    padding: 0.75rem;
    border-radius: var(--radius-sm);
    align-items: stretch;
  }
  
  .answer-option-row input[type="radio"] {
    align-self: center;
  }
  
  .answer-option-row input[placeholder*="Option text"] {
    flex: 1 1 calc(100% - 3.5rem) !important;
    margin-bottom: 0 !important;
  }
  
  .answer-option-row input[placeholder*="explanation"] {
    flex: 1 1 100% !important;
    margin-left: 2rem !important;
    margin-top: 0.5rem !important;
  }
  
  .answer-option-row button {
    align-self: center;
  }
}
</style>
