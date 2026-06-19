<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
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
const canWrite = computed(() => userRole.value === 'ADMIN' || userPermissions.value.includes('questions:write'))

// Tabs
const activeTab = ref('questions') // 'questions', 'banks'

// Data lists
const questions = ref([])
const banks = ref([])
const subjects = ref([]) // For filters

// Filters
const filterSubjectId = ref('')
const filterChapterId = ref('')
const filterConceptId = ref('')
const filterDifficulty = ref('')
const filterStatus = ref('')
const filterSearch = ref('')
const filterSourceFileName = ref('')
const questionPagination = ref(createPagination(10))
const bankPagination = ref(createPagination(10))
const subjectsLoading = ref(false)
const subjectsError = ref('')

// Advanced Filters
const showAdvancedFilters = ref(false)
const filterDifficulties = ref([])
const filterTypes = ref([])
const filterStatuses = ref([])
const filterAuthorId = ref('')
const filterDateStart = ref('')
const filterDateEnd = ref('')
const filterAnswerSearch = ref('')
const authors = ref([])

// Bulk Selection States & Methods
const selectedQuestionIds = ref([])

const canDeleteQuestion = (q) => {
  if (!canWrite.value) return false
  if (userRole.value === 'ADMIN') return true
  return q.createdById === parseInt(authStore.user?.id)
}

const deletableQuestions = computed(() => {
  return questions.value.filter(q => canDeleteQuestion(q))
})

const isAllSelected = computed(() => {
  const deletableCount = deletableQuestions.value.length
  return deletableCount > 0 && selectedQuestionIds.value.length === deletableCount
})

const toggleSelectAll = (e) => {
  if (e.target.checked) {
    selectedQuestionIds.value = deletableQuestions.value.map(q => q.id)
  } else {
    selectedQuestionIds.value = []
  }
}

watch(questions, () => {
  selectedQuestionIds.value = []
})

const handleBulkDelete = async () => {
  const count = selectedQuestionIds.value.length
  if (count === 0) return

  const ok = await confirmationStore.ask({
    title: 'Bulk Delete Questions',
    message: `Are you sure you want to delete all ${count} selected questions? This will permanently remove them from the database and disconnect them from all test papers.`,
    confirmText: 'Delete All',
    isDanger: true
  })

  if (ok) {
    errorMessage.value = ''
    successMessage.value = ''
    try {
      const response = await api.post('/questions/bulk-delete', {
        ids: selectedQuestionIds.value
      })
      notificationStore.success(response.data.message || `Successfully deleted ${count} questions.`)
      selectedQuestionIds.value = []
      await fetchQuestions()
    } catch (err) {
      errorMessage.value = err.response?.data?.error || 'Failed to delete selected questions.'
    }
  }
}

// Computed lists for filters
const chaptersList = computed(() => {
  if (!filterSubjectId.value) return []
  const sub = subjects.value.find(s => s.id === parseInt(filterSubjectId.value))
  return sub ? sub.chapters : []
})

const conceptsList = computed(() => {
  if (!filterChapterId.value) return []
  const chap = chaptersList.value.find(c => c.id === parseInt(filterChapterId.value))
  return chap ? chap.concepts : []
})

// Loading & Message states
const loading = ref(false)
const banksLoading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const apiSnapshot = ref(null)
const apiSnapshotLoading = ref(false)
const apiSnapshotError = ref('')

// Modals
const isQuestionModalOpen = ref(false)
const isBankModalOpen = ref(false)
const isBankDetailsModalOpen = ref(false)

// Question Form Fields
const questionContent = ref('')
const questionImageUrl = ref('')
const questionType = ref('MCQ')
const questionDifficulty = ref('MEDIUM')
const questionStatus = ref('DRAFT')
const formSubjectId = ref('')
const formChapterId = ref('')
const formConceptId = ref('')
const questionExplanation = ref('')
const answers = ref([
  { content: '', imageUrl: '', isCorrect: false, explanation: '' },
  { content: '', imageUrl: '', isCorrect: false, explanation: '' }
])
const mediaUploading = ref(false)

// Bank Form Fields
const editingBankId = ref(null)
const bankName = ref('')
const bankDescription = ref('')
const bankIsPublic = ref(false)
const bankAcademicYear = ref('')
const bankSscClass = ref('')
const bankJobRole = ref('')
const bankSubjectCode = ref('')
const bankSubjectName = ref('')

// Question Bank Filters
const bankFilterSearch = ref('')
const bankFilterAcademicYear = ref('')
const bankFilterSscClass = ref('')
const bankFilterJobRole = ref('')
const bankFilterSubjectCode = ref('')
const bankFilterSubjectName = ref('')

// Selected Bank details modal
const selectedBank = ref(null)
const isLinkingQuestionModalOpen = ref(false)
const selectedLinkQuestionIds = ref([])
const isLinkingQuestions = ref(false)
const linkSubjectId = ref('')
const linkQuestionPool = ref([])
const linkQuestionsLoading = ref(false)
const linkQuestionsError = ref('')
const selectedUnlinkQuestionIds = ref([])
const isUnlinkingQuestions = ref(false)

// Bulk Import states
const isImportModalOpen = ref(false)
const importTab = ref('upload') // 'upload', 'drive', 'excel', 'jobs'
const importSubjectId = ref('')
const importChapterId = ref('')
const importConceptId = ref('')
const pdfFile = ref(null)
const isLocalImporting = ref(false)
const isDriveImporting = ref(false)
const importRequestKey = ref('')
const excelTemplateInfo = ref(null)
const excelFile = ref(null)
const excelFileInput = ref(null)
const excelPreview = ref(null)
const excelPreviewToken = ref('')
const isTemplateDownloading = ref(false)
const isExcelPreviewing = ref(false)
const isExcelCommitting = ref(false)

const googleConnected = ref(false)
const driveFiles = ref([])
const driveLoading = ref(false)
const selectedDriveFileId = ref('')

const jobsList = ref([])
const jobsLoading = ref(false)
const pollingTimer = ref(null)

const isImporting = computed(() => (
  isLocalImporting.value ||
  isDriveImporting.value ||
  isExcelPreviewing.value ||
  isExcelCommitting.value ||
  isTemplateDownloading.value
))
const canUploadLocalPdf = computed(() => !!pdfFile.value && !!importConceptId.value && !isLocalImporting.value)
const canImportDrivePdf = computed(() => !!selectedDriveFileId.value && !!importConceptId.value && !isDriveImporting.value)
const canPreviewExcel = computed(() => !!excelFile.value && !isExcelPreviewing.value && !isExcelCommitting.value)
const canCommitExcel = computed(() => (
  !!excelPreviewToken.value &&
  (excelPreview.value?.summary?.errorRows || 0) === 0 &&
  !isExcelPreviewing.value &&
  !isExcelCommitting.value
))

const apiSnapshotCards = computed(() => {
  const counts = apiSnapshot.value?.counts || {}
  return [
    { label: 'Languages', value: counts.languages ?? 0 },
    { label: 'Skills', value: counts.skills ?? 0 },
    { label: 'Subjects', value: counts.subjects ?? 0 },
    { label: 'Online Tests', value: counts.onlineTests ?? 0 },
    { label: 'Online Modes', value: counts.onlineModes ?? 0 },
    { label: 'Authorization Rows', value: counts.authorizationRows ?? 0 },
  ]
})

const refreshImportRequestKey = () => {
  importRequestKey.value = `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const closeImportModal = () => {
  if (isImporting.value) return
  isImportModalOpen.value = false
}

const setImportTab = (tab) => {
  if (isImporting.value) return
  importTab.value = tab
}

// Compute lists for import modal categories
const importChaptersList = computed(() => {
  if (!importSubjectId.value) return []
  const sub = subjects.value.find(s => s.id === parseInt(importSubjectId.value))
  return sub ? sub.chapters : []
})

const importConceptsList = computed(() => {
  if (!importChapterId.value) return []
  const chap = importChaptersList.value.find(c => c.id === parseInt(importChapterId.value))
  return chap ? chap.concepts : []
})

const checkGoogleConnection = () => {
  const token = localStorage.getItem("google_access_token")
  googleConnected.value = !!token
}

const connectGoogleDrive = async () => {
  try {
    const response = await api.get('/uploads/drive/auth-url')
    if (response.data && response.data.url) {
      window.location.href = response.data.url
    }
  } catch (err) {
    notificationStore.error("Failed to retrieve Google Auth URL.")
  }
}

const disconnectGoogleDrive = () => {
  localStorage.removeItem("google_access_token")
  localStorage.removeItem("google_refresh_token")
  googleConnected.value = false
  driveFiles.value = []
  selectedDriveFileId.value = ''
}

const fetchDriveFiles = async () => {
  driveLoading.value = true
  try {
    const response = await api.get('/uploads/drive/files')
    driveFiles.value = response.data
  } catch (err) {
    console.error(err)
    if (err.response?.status === 401) {
      disconnectGoogleDrive()
    } else {
      notificationStore.error("Failed to load Google Drive files.")
    }
  } finally {
    driveLoading.value = false
  }
}

const fetchJobs = async () => {
  jobsLoading.value = true
  try {
    const response = await api.get('/uploads/jobs')
    jobsList.value = response.data
  } catch (err) {
    console.error("Failed to load processing jobs:", err)
  } finally {
    jobsLoading.value = false
  }
}

const fetchApiSnapshot = async () => {
  apiSnapshotLoading.value = true
  apiSnapshotError.value = ''
  try {
    const response = await api.get('/question-banks/api-snapshot')
    apiSnapshot.value = response.data
  } catch (err) {
    apiSnapshotError.value = err.response?.data?.error || 'API snapshot is unavailable.'
  } finally {
    apiSnapshotLoading.value = false
  }
}

const fetchExcelTemplateInfo = async () => {
  try {
    const response = await api.get('/question-banks/template/latest/info')
    excelTemplateInfo.value = response.data
  } catch (err) {
    console.error('Failed to load Excel template info:', err)
  }
}

const resetExcelImport = () => {
  excelFile.value = null
  excelPreview.value = null
  excelPreviewToken.value = ''
  if (excelFileInput.value) {
    excelFileInput.value.value = ''
  }
}

const downloadLatestExcelTemplate = async () => {
  if (isTemplateDownloading.value) return

  try {
    isTemplateDownloading.value = true
    const response = await api.get('/question-banks/template/latest/download', {
      responseType: 'blob'
    })
    const contentType = response.headers?.['content-type'] || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const blob = new Blob([response.data], { type: contentType })
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    const dateLabel = excelTemplateInfo.value?.date || new Date().toISOString().slice(0, 10)
    link.href = downloadUrl
    link.download = `QB_Excel_Template_${dateLabel}.xlsx`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.URL.revokeObjectURL(downloadUrl)
    notificationStore.success('Latest QB Excel template downloaded.')
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to download the latest QB Excel template.')
  } finally {
    isTemplateDownloading.value = false
  }
}

const handleExcelFileChange = (e) => {
  if (isExcelPreviewing.value || isExcelCommitting.value) return
  excelFile.value = e.target.files?.[0] || null
  excelPreview.value = null
  excelPreviewToken.value = ''
}

const handleExcelPreview = async () => {
  if (isExcelPreviewing.value) return
  if (!excelFile.value) {
    notificationStore.error('Please select a completed QB Excel template.')
    return
  }

  const formData = new FormData()
  formData.append('file', excelFile.value)

  try {
    isExcelPreviewing.value = true
    errorMessage.value = ''
    successMessage.value = ''
    const response = await api.post('/question-banks/import/excel/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
    excelPreview.value = response.data
    excelPreviewToken.value = response.data?.previewToken || ''
    notificationStore.success('Excel validation preview is ready.')
  } catch (err) {
    excelPreview.value = null
    excelPreviewToken.value = ''
    notificationStore.error(err.response?.data?.error || 'Failed to preview the Excel import.')
  } finally {
    isExcelPreviewing.value = false
  }
}

const handleExcelCommit = async () => {
  if (isExcelCommitting.value || !excelPreviewToken.value) return

  try {
    isExcelCommitting.value = true
    const response = await api.post('/question-banks/import/excel/commit', {
      previewToken: excelPreviewToken.value
    })
    notificationStore.success(response.data?.message || 'Excel question bank import completed.')
    resetExcelImport()
    await Promise.all([fetchQuestions(), fetchBanks()])
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to import Excel rows.')
  } finally {
    isExcelCommitting.value = false
  }
}

const startJobsPolling = () => {
  if (pollingTimer.value) clearInterval(pollingTimer.value)
  
  fetchJobs()
  
  pollingTimer.value = setInterval(async () => {
    try {
      const response = await api.get('/uploads/jobs')
      jobsList.value = response.data
      
      const hasActive = response.data.some(j => j.status === 'PENDING' || j.status === 'PROCESSING')
      if (!hasActive) {
        clearInterval(pollingTimer.value)
        pollingTimer.value = null
        fetchQuestions()
      }
    } catch (err) {
      console.error("Polling error:", err)
    }
  }, 3000)
}

const handlePdfFileChange = (e) => {
  if (isLocalImporting.value) return
  pdfFile.value = e.target.files[0]
  refreshImportRequestKey()
}

const openImportModal = () => {
  importSubjectId.value = ''
  importChapterId.value = ''
  importConceptId.value = ''
  pdfFile.value = null
  selectedDriveFileId.value = ''
  resetExcelImport()
  isLocalImporting.value = false
  isDriveImporting.value = false
  isExcelPreviewing.value = false
  isExcelCommitting.value = false
  refreshImportRequestKey()
  checkGoogleConnection()
  fetchExcelTemplateInfo()
  
  if (googleConnected.value) {
    fetchDriveFiles()
  }
  
  fetchJobs()
  isImportModalOpen.value = true
}

const handleLocalImport = async () => {
  if (isLocalImporting.value) return
  if (!pdfFile.value) {
    notificationStore.error("Please select a PDF file.")
    return
  }
  if (!importConceptId.value) {
    notificationStore.error("Please select a target taxonomy Concept.")
    return
  }
  
  const formData = new FormData()
  formData.append('file', pdfFile.value)
  formData.append('conceptId', importConceptId.value)
  
  try {
    isLocalImporting.value = true
    errorMessage.value = ''
    successMessage.value = ''
    await api.post('/uploads/import-pdf', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        'X-Idempotency-Key': importRequestKey.value
      }
    })
    successMessage.value = "PDF uploaded successfully. Processing started in background."
    isImportModalOpen.value = false
    startJobsPolling()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || "Failed to upload and parse PDF."
  } finally {
    isLocalImporting.value = false
  }
}

const handleDriveImport = async () => {
  if (isDriveImporting.value) return
  if (!selectedDriveFileId.value) {
    notificationStore.error("Please select a file from Google Drive.")
    return
  }
  if (!importConceptId.value) {
    notificationStore.error("Please select a target taxonomy Concept.")
    return
  }
  
  try {
    isDriveImporting.value = true
    errorMessage.value = ''
    successMessage.value = ''
    await api.post('/uploads/drive/import', {
      fileId: selectedDriveFileId.value,
      conceptId: parseInt(importConceptId.value)
    }, {
      headers: {
        'X-Idempotency-Key': importRequestKey.value
      }
    })
    successMessage.value = "Google Drive document queued. Background parsing started."
    isImportModalOpen.value = false
    startJobsPolling()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || "Failed to trigger Google Drive import."
  } finally {
    isDriveImporting.value = false
  }
}

onMounted(async () => {
  await fetchSubjects()
  await fetchAuthors()
  await fetchQuestions()
  await fetchBanks()
  fetchApiSnapshot()
  checkGoogleConnection()
  
  try {
    const response = await api.get('/uploads/jobs')
    jobsList.value = response.data
    const hasActive = response.data.some(j => j.status === 'PENDING' || j.status === 'PROCESSING')
    if (hasActive) {
      startJobsPolling()
    }
  } catch (e) {}
})

onUnmounted(() => {
  if (pollingTimer.value) {
    clearInterval(pollingTimer.value)
  }
})

const fetchSubjects = async () => {
  subjectsLoading.value = true
  subjectsError.value = ''
  try {
    const response = await api.get('/subjects')
    subjects.value = response.data
  } catch (err) {
    console.error('Failed to load subjects:', err)
    subjectsError.value = err.response?.data?.error || 'Failed to load taxonomy.'
  } finally {
    subjectsLoading.value = false
  }
}

const fetchAuthors = async () => {
  try {
    const response = await api.get('/users/authors')
    authors.value = response.data
  } catch (err) {
    console.error('Failed to load authors:', err)
  }
}

const buildQuestionQueryParams = ({ page, pageSize } = {}) => {
  const params = {}
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize

    if (filterSubjectId.value) params.subjectId = filterSubjectId.value
    if (filterChapterId.value) params.chapterId = filterChapterId.value
    if (filterConceptId.value) params.conceptId = filterConceptId.value

    // Difficulty
    if (filterDifficulties.value && filterDifficulties.value.length > 0) {
      params.difficulty = filterDifficulties.value.join(',')
    } else if (filterDifficulty.value) {
      params.difficulty = filterDifficulty.value
    }

    // Status
    if (filterStatuses.value && filterStatuses.value.length > 0) {
      params.status = filterStatuses.value.join(',')
    } else if (filterStatus.value) {
      params.status = filterStatus.value
    }

    // Type
    if (filterTypes.value && filterTypes.value.length > 0) {
      params.type = filterTypes.value.join(',')
    }

    if (filterSearch.value) params.search = filterSearch.value
    if (filterAuthorId.value) params.authorId = filterAuthorId.value
    if (filterDateStart.value) params.dateStart = filterDateStart.value
    if (filterDateEnd.value) params.dateEnd = filterDateEnd.value
    if (filterAnswerSearch.value) params.answerSearch = filterAnswerSearch.value
    if (filterSourceFileName.value) params.sourceFileName = filterSourceFileName.value

  return params
}

const fetchQuestions = async (page = questionPagination.value.page) => {
  loading.value = true
  try {
    const params = buildQuestionQueryParams({
      page,
      pageSize: questionPagination.value.pageSize,
    })

    const response = await api.get('/questions', { params })
    const unpacked = unpackPaginated(response.data, {
      ...questionPagination.value,
      page,
    })
    questions.value = unpacked.rows
    questionPagination.value = unpacked.pagination
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to fetch questions.'
  } finally {
    loading.value = false
  }
}

const buildLinkQuestionQueryParams = ({ page, pageSize } = {}) => {
  const params = {}
  if (page) params.page = page
  if (pageSize) params.pageSize = pageSize
  if (linkSubjectId.value) params.subjectId = linkSubjectId.value
  return params
}

const fetchLinkQuestionPool = async () => {
  selectedLinkQuestionIds.value = []
  linkQuestionPool.value = []
  linkQuestionsError.value = ''

  if (!linkSubjectId.value) {
    linkQuestionsLoading.value = false
    return
  }

  linkQuestionsLoading.value = true

  try {
    const pageSize = 100
    let page = 1
    let totalPages = 1
    const rows = []

    do {
      const response = await api.get('/questions', {
        params: buildLinkQuestionQueryParams({ page, pageSize }),
      })
      const unpacked = unpackPaginated(response.data, createPagination(pageSize))
      rows.push(...unpacked.rows)
      totalPages = unpacked.pagination.totalPages || 1
      page += 1
    } while (page <= totalPages)

    const byId = new Map(rows.map((question) => [Number(question.id), question]))
    linkQuestionPool.value = Array.from(byId.values())
  } catch (err) {
    linkQuestionsError.value = err.response?.data?.error || 'Failed to load all questions for linking.'
    notificationStore.error(linkQuestionsError.value)
  } finally {
    linkQuestionsLoading.value = false
  }
}

const fetchBanks = async (page = bankPagination.value.page) => {
  banksLoading.value = true
  try {
    const params = {
      page,
      pageSize: bankPagination.value.pageSize,
    }
    if (bankFilterSearch.value) params.search = bankFilterSearch.value
    if (bankFilterAcademicYear.value) params.academicYear = bankFilterAcademicYear.value
    if (bankFilterSscClass.value) params.sscClass = bankFilterSscClass.value
    if (bankFilterJobRole.value) params.jobRole = bankFilterJobRole.value
    if (bankFilterSubjectCode.value) params.subjectCode = bankFilterSubjectCode.value
    if (bankFilterSubjectName.value) params.subjectName = bankFilterSubjectName.value

    const response = await api.get('/question-banks', { params })
    const unpacked = unpackPaginated(response.data, {
      ...bankPagination.value,
      page,
    })
    banks.value = unpacked.rows
    bankPagination.value = unpacked.pagination
  } catch (err) {
    console.error('Failed to fetch question banks:', err)
  } finally {
    banksLoading.value = false
  }
}

watch(filterSubjectId, () => {
  filterChapterId.value = ''
  filterConceptId.value = ''
  fetchQuestions(1)
})

watch(filterChapterId, () => {
  filterConceptId.value = ''
  fetchQuestions(1)
})

watch(
  [filterConceptId, filterDifficulty, filterStatus, filterAuthorId],
  () => {
    fetchQuestions(1)
  }
)

watch(
  [filterDifficulties, filterTypes, filterStatuses],
  () => {
    fetchQuestions(1)
  },
  { deep: true }
)

// Trigger search on debounce or direct button
const handleSearch = () => {
  fetchQuestions(1)
}

const clearFilters = () => {
  filterSearch.value = ''
  filterSourceFileName.value = ''
  filterSubjectId.value = ''
  filterChapterId.value = ''
  filterConceptId.value = ''
  filterDifficulty.value = ''
  filterStatus.value = ''
  filterDifficulties.value = []
  filterTypes.value = []
  filterStatuses.value = []
  filterAuthorId.value = ''
  filterDateStart.value = ''
  filterDateEnd.value = ''
  filterAnswerSearch.value = ''
  fetchQuestions(1)
}

const hasBankFilters = computed(() => {
  return Boolean(
    bankFilterSearch.value ||
    bankFilterAcademicYear.value ||
    bankFilterSscClass.value ||
    bankFilterJobRole.value ||
    bankFilterSubjectCode.value ||
    bankFilterSubjectName.value
  )
})

const handleBankSearch = () => {
  fetchBanks(1)
}

const clearBankFilters = () => {
  bankFilterSearch.value = ''
  bankFilterAcademicYear.value = ''
  bankFilterSscClass.value = ''
  bankFilterJobRole.value = ''
  bankFilterSubjectCode.value = ''
  bankFilterSubjectName.value = ''
  fetchBanks(1)
}

const toggleAdvancedFilters = () => {
  showAdvancedFilters.value = !showAdvancedFilters.value
}

watch(linkSubjectId, () => {
  if (!isLinkingQuestionModalOpen.value) return
  fetchLinkQuestionPool()
})

// Dynamic concept list inside question form
const formChaptersList = computed(() => {
  if (!formSubjectId.value) return []
  const sub = subjects.value.find(s => s.id === parseInt(formSubjectId.value))
  return sub ? sub.chapters : []
})

const formConceptsList = computed(() => {
  if (!formChapterId.value) return []
  const chap = formChaptersList.value.find(c => c.id === parseInt(formChapterId.value))
  return chap ? chap.concepts : []
})

watch(formSubjectId, () => {
  formChapterId.value = ''
  formConceptId.value = ''
})

watch(formChapterId, () => {
  formConceptId.value = ''
})

watch(importSubjectId, () => {
  importChapterId.value = ''
  importConceptId.value = ''
})

watch(importChapterId, () => {
  importConceptId.value = ''
})

const linkedQuestionIds = computed(() => {
  return new Set((selectedBank.value?.bankQuestions || []).map(bq => Number(bq.questionId)))
})

const linkedBankQuestions = computed(() => {
  return selectedBank.value?.bankQuestions || []
})

const isQuestionLinked = (questionId) => {
  return linkedQuestionIds.value.has(Number(questionId))
}

const cleanBankField = (value) => {
  const text = String(value || '').trim()
  return text.length > 0 ? text : null
}

const buildBankPayload = () => ({
  name: bankName.value,
  description: cleanBankField(bankDescription.value),
  isPublic: bankIsPublic.value,
  academicYear: cleanBankField(bankAcademicYear.value),
  sscClass: cleanBankField(bankSscClass.value),
  jobRole: cleanBankField(bankJobRole.value),
  subjectCode: cleanBankField(bankSubjectCode.value),
  subjectName: cleanBankField(bankSubjectName.value)
})

const formatBankMeta = (value) => {
  return cleanBankField(value) || 'Not set'
}

const unlinkedQuestions = computed(() => {
  return linkQuestionPool.value.filter(q => !isQuestionLinked(q.id))
})

const isAllUnlinkedSelected = computed(() => {
  return unlinkedQuestions.value.length > 0 &&
    selectedLinkQuestionIds.value.length === unlinkedQuestions.value.length
})

const isAllLinkedSelected = computed(() => {
  return linkedBankQuestions.value.length > 0 &&
    selectedUnlinkQuestionIds.value.length === linkedBankQuestions.value.length
})

const getMediaUrl = (path) => {
  if (!path) return ''
  const value = String(path)
  if (/^(https?:|data:|blob:)/i.test(value)) return value
  const apiRoot = (api.defaults.baseURL || '').replace(/\/api\/?$/, '')
  return `${apiRoot}${value.startsWith('/') ? value : `/${value}`}`
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

const handleQuestionImageUpload = async (event) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  mediaUploading.value = true
  try {
    questionImageUrl.value = await uploadMediaFile(file)
  } catch (err) {
    notificationStore.error(err.response?.data?.error || err.message || 'Failed to upload question image.')
  } finally {
    mediaUploading.value = false
  }
}

const handleQuestionImagePaste = async (event) => {
  const file = getPastedImageFile(event)
  if (!file) return

  event.preventDefault()
  mediaUploading.value = true
  try {
    questionImageUrl.value = await uploadMediaFile(file)
    notificationStore.success('Question image added.')
  } catch (err) {
    notificationStore.error(err.response?.data?.error || err.message || 'Failed to paste question image.')
  } finally {
    mediaUploading.value = false
  }
}

const handleAnswerImageUpload = async (event, answer) => {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return

  mediaUploading.value = true
  try {
    answer.imageUrl = await uploadMediaFile(file)
  } catch (err) {
    notificationStore.error(err.response?.data?.error || err.message || 'Failed to upload option image.')
  } finally {
    mediaUploading.value = false
  }
}

const handleAnswerImagePaste = async (event, answer) => {
  const file = getPastedImageFile(event)
  if (!file) return

  event.preventDefault()
  mediaUploading.value = true
  try {
    answer.imageUrl = await uploadMediaFile(file)
    notificationStore.success('Option image added.')
  } catch (err) {
    notificationStore.error(err.response?.data?.error || err.message || 'Failed to paste option image.')
  } finally {
    mediaUploading.value = false
  }
}

const hasAnswerContent = (answer) => {
  return Boolean(String(answer.content || '').trim() || answer.imageUrl)
}

// Dynamic answer handlers
watch(questionType, (newType) => {
  if (newType === 'MCQ') {
    answers.value = [
      { content: '', imageUrl: '', isCorrect: false, explanation: '' },
      { content: '', imageUrl: '', isCorrect: false, explanation: '' }
    ]
  } else if (newType === 'TRUE_FALSE') {
    answers.value = [
      { content: 'True', imageUrl: '', isCorrect: true, explanation: '' },
      { content: 'False', imageUrl: '', isCorrect: false, explanation: '' }
    ]
  } else {
    // Short Answer, Essay
    answers.value = []
  }
})

const addAnswerOption = () => {
  answers.value.push({ content: '', imageUrl: '', isCorrect: false, explanation: '' })
}

const removeAnswerOption = (index) => {
  if (answers.value.length > 2) {
    answers.value.splice(index, 1)
  }
}

const openCreateQuestion = () => {
  questionContent.value = ''
  questionImageUrl.value = ''
  questionType.value = 'MCQ'
  questionDifficulty.value = 'MEDIUM'
  questionStatus.value = 'DRAFT'
  formSubjectId.value = ''
  formChapterId.value = ''
  formConceptId.value = ''
  questionExplanation.value = ''
  answers.value = [
    { content: '', imageUrl: '', isCorrect: false, explanation: '' },
    { content: '', imageUrl: '', isCorrect: false, explanation: '' }
  ]
  errorMessage.value = ''
  successMessage.value = ''
  isQuestionModalOpen.value = true
}

const handleSaveQuestion = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if ((!questionContent.value.trim() && !questionImageUrl.value) || !formConceptId.value) {
    errorMessage.value = 'Question text or image and concept categorization are required.'
    return
  }

  // Basic validation
  if (questionType.value === 'MCQ') {
    const hasCorrect = answers.value.some(a => a.isCorrect)
    const hasEmpty = answers.value.some(a => !hasAnswerContent(a))
    if (hasEmpty) {
      errorMessage.value = 'Please add text or an image for all MCQ options.'
      return
    }
    if (!hasCorrect) {
      errorMessage.value = 'Please select at least one correct option for MCQ.'
      return
    }
  }

  const payload = {
    question: {
      content: questionContent.value,
      imageUrl: questionImageUrl.value,
      type: questionType.value,
      difficulty: questionDifficulty.value,
      status: questionStatus.value,
      explanation: questionExplanation.value,
      conceptId: parseInt(formConceptId.value)
    },
    answers: answers.value.map((answer) => ({
      ...answer,
      content: String(answer.content || '').trim(),
      imageUrl: answer.imageUrl || null,
    }))
  }

  try {
    await api.post('/questions', payload)
    successMessage.value = 'Question added to bank successfully.'
    isQuestionModalOpen.value = false
    await fetchQuestions()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to save question.'
  }
}

const handleDeleteQuestion = async (id) => {
  const ok = await confirmationStore.ask({
    title: 'Delete Question',
    message: 'Delete this question from system? All linked test papers will disconnect.',
    confirmText: 'Delete',
    isDanger: true
  })
  if (ok) {
    errorMessage.value = ''
    try {
      await api.delete(`/questions/${id}`)
      successMessage.value = 'Question deleted successfully.'
      await fetchQuestions()
    } catch (err) {
      errorMessage.value = err.response?.data?.error || 'Failed to delete question.'
    }
  }
}

// --- Bank Actions ---
const openCreateBank = () => {
  editingBankId.value = null
  bankName.value = ''
  bankDescription.value = ''
  bankIsPublic.value = false
  bankAcademicYear.value = ''
  bankSscClass.value = ''
  bankJobRole.value = ''
  bankSubjectCode.value = ''
  bankSubjectName.value = ''
  errorMessage.value = ''
  successMessage.value = ''
  isBankModalOpen.value = true
}

const openEditBank = (bank) => {
  editingBankId.value = bank.id
  bankName.value = bank.name || ''
  bankDescription.value = bank.description || ''
  bankIsPublic.value = Boolean(bank.isPublic)
  bankAcademicYear.value = bank.academicYear || ''
  bankSscClass.value = bank.sscClass || ''
  bankJobRole.value = bank.jobRole || ''
  bankSubjectCode.value = bank.subjectCode || ''
  bankSubjectName.value = bank.subjectName || ''
  errorMessage.value = ''
  successMessage.value = ''
  isBankModalOpen.value = true
}

const handleSaveBank = async () => {
  errorMessage.value = ''
  if (!bankName.value) {
    errorMessage.value = 'Bank name is required.'
    return
  }
  try {
    if (editingBankId.value) {
      await api.put(`/question-banks/${editingBankId.value}`, buildBankPayload())
      successMessage.value = 'Question Bank updated successfully.'
    } else {
      await api.post('/question-banks', buildBankPayload())
      successMessage.value = 'New Question Bank created successfully.'
    }
    isBankModalOpen.value = false
    editingBankId.value = null
    await fetchBanks()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to save Question Bank.'
  }
}

const openBankDetails = async (bankId) => {
  try {
    const response = await api.get(`/question-banks/${bankId}`)
    selectedBank.value = response.data
    selectedUnlinkQuestionIds.value = []
    isBankDetailsModalOpen.value = true
  } catch (err) {
    notificationStore.error('Failed to load bank details.')
  }
}

const closeBankDetails = () => {
  if (isUnlinkingQuestions.value) return
  selectedUnlinkQuestionIds.value = []
  isBankDetailsModalOpen.value = false
}

const handleDeleteBank = async (bankId) => {
  const ok = await confirmationStore.ask({
    title: 'Delete Question Bank',
    message: 'Are you sure you want to delete this Question Bank? Linked questions will NOT be deleted.',
    confirmText: 'Delete',
    isDanger: true
  })
  if (ok) {
    try {
      await api.delete(`/question-banks/${bankId}`)
      await fetchBanks()
    } catch (err) {
      notificationStore.error('Failed to delete Question Bank.')
    }
  }
}

// Link Question to Bank
const handleLinkQuestion = async (questionId) => {
  try {
    await api.post(`/question-banks/${selectedBank.value.id}/questions`, {
      questionId: parseInt(questionId)
    })
    isLinkingQuestionModalOpen.value = false
    // Refresh details
    await openBankDetails(selectedBank.value.id)
    await fetchBanks()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to link question.')
  }
}

const openLinkingQuestionModal = async () => {
  selectedLinkQuestionIds.value = []
  linkSubjectId.value = ''
  linkQuestionPool.value = []
  linkQuestionsError.value = ''
  isLinkingQuestionModalOpen.value = true
  if (subjects.value.length === 0) await fetchSubjects()
}

const closeLinkingQuestionModal = () => {
  if (isLinkingQuestions.value) return
  selectedLinkQuestionIds.value = []
  linkSubjectId.value = ''
  linkQuestionPool.value = []
  linkQuestionsError.value = ''
  isLinkingQuestionModalOpen.value = false
}

const toggleLinkQuestionSelection = (questionId) => {
  if (isQuestionLinked(questionId) || isLinkingQuestions.value) return

  const parsedId = Number(questionId)
  if (selectedLinkQuestionIds.value.includes(parsedId)) {
    selectedLinkQuestionIds.value = selectedLinkQuestionIds.value.filter(id => id !== parsedId)
  } else {
    selectedLinkQuestionIds.value = [...selectedLinkQuestionIds.value, parsedId]
  }
}

const toggleSelectAllLinkQuestions = (event) => {
  if (isLinkingQuestions.value) return
  selectedLinkQuestionIds.value = event.target.checked
    ? unlinkedQuestions.value.map(q => Number(q.id))
    : []
}

const handleLinkSelectedQuestions = async () => {
  if (!selectedBank.value || selectedLinkQuestionIds.value.length === 0 || isLinkingQuestions.value) return

  try {
    isLinkingQuestions.value = true
    const bankId = selectedBank.value.id
    const questionIds = [...selectedLinkQuestionIds.value]

    const response = await api.post(`/question-banks/${bankId}/questions`, {
      questionIds
    })

    notificationStore.success(response.data?.message || `Linked ${questionIds.length} questions to the bank.`)
    selectedLinkQuestionIds.value = []
    await openBankDetails(bankId)
    await fetchLinkQuestionPool()
    await fetchBanks()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to link selected questions.')
  } finally {
    isLinkingQuestions.value = false
  }
}

const handleUnlinkQuestion = async (questionId) => {
  const ok = await confirmationStore.ask({
    title: 'Unlink Question',
    message: 'Unlink this question from the bank?',
    confirmText: 'Unlink',
    isDanger: true
  })
  if (ok) {
    try {
      await api.delete(`/question-banks/${selectedBank.value.id}/questions/${questionId}`)
      selectedUnlinkQuestionIds.value = selectedUnlinkQuestionIds.value.filter(id => id !== Number(questionId))
      await openBankDetails(selectedBank.value.id)
      await fetchBanks()
    } catch (err) {
      notificationStore.error('Failed to unlink question.')
    }
  }
}

const toggleUnlinkQuestionSelection = (questionId) => {
  if (isUnlinkingQuestions.value) return

  const parsedId = Number(questionId)
  if (selectedUnlinkQuestionIds.value.includes(parsedId)) {
    selectedUnlinkQuestionIds.value = selectedUnlinkQuestionIds.value.filter(id => id !== parsedId)
  } else {
    selectedUnlinkQuestionIds.value = [...selectedUnlinkQuestionIds.value, parsedId]
  }
}

const toggleSelectAllUnlinkQuestions = (event) => {
  if (isUnlinkingQuestions.value) return
  selectedUnlinkQuestionIds.value = event.target.checked
    ? linkedBankQuestions.value.map(bq => Number(bq.questionId))
    : []
}

const handleUnlinkSelectedQuestions = async () => {
  if (!selectedBank.value || selectedUnlinkQuestionIds.value.length === 0 || isUnlinkingQuestions.value) return

  const count = selectedUnlinkQuestionIds.value.length
  const ok = await confirmationStore.ask({
    title: 'Bulk Unlink Questions',
    message: `Unlink ${count} selected questions from this bank? The questions will remain in the main repository.`,
    confirmText: 'Unlink Selected',
    isDanger: true
  })
  if (!ok) return

  try {
    isUnlinkingQuestions.value = true
    const bankId = selectedBank.value.id
    const questionIds = [...selectedUnlinkQuestionIds.value]

    const response = await api.post(`/question-banks/${bankId}/questions/bulk-unlink`, {
      questionIds
    })

    notificationStore.success(response.data?.message || `Unlinked ${questionIds.length} questions from the bank.`)
    selectedUnlinkQuestionIds.value = []
    await openBankDetails(bankId)
    await fetchBanks()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to unlink selected questions.')
  } finally {
    isUnlinkingQuestions.value = false
  }
}

// Helpers
const getDifficultyColor = (diff) => {
  if (diff === 'EASY') return 'color: #34d399;'
  if (diff === 'MEDIUM') return 'color: #fbbf24;'
  return 'color: #fca5a5;'
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
        <router-link to="/questions" class="nav-item active">
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
        <router-link to="/test-papers" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Test Papers
        </router-link>
        <router-link to="/assessment-builder" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h3"/></svg>
          Assessment Builder
        </router-link>
        <router-link to="/subjects" class="nav-item">
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
        <button class="btn btn-secondary btn-sm" @click="authStore.logout().then(() => router.push('/login'))" style="width: 100%;">
          Sign Out
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="main-content">
      <header class="header" style="height: auto; padding: 1.5rem 2rem; border-bottom: 1px solid var(--border-color); background-color: var(--bg-card);">
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-bottom: 1rem;">
          <h2 class="page-title">Question Repository</h2>
          <div style="display: flex; gap: 0.75rem;">
            <button class="btn btn-secondary btn-sm" @click="downloadLatestExcelTemplate" v-if="canWrite" :disabled="isTemplateDownloading" style="width: auto;">
              {{ isTemplateDownloading ? 'Preparing...' : 'Download QB Excel Template' }}
            </button>
            <button class="btn btn-secondary btn-sm" @click="openImportModal" v-if="canWrite" style="width: auto;">📁 Bulk Import</button>
            <button class="btn btn-secondary btn-sm" @click="openCreateBank" v-if="canWrite" style="width: auto;">+ Create Bank</button>
            <button class="btn btn-primary btn-sm" @click="openCreateQuestion" v-if="canWrite" style="width: auto;">+ Add Question</button>
          </div>
        </div>

        <!-- Custom Tabs -->
        <div style="display: flex; gap: 1rem; border-bottom: 1px solid var(--border-color); width: 100%;">
          <button 
            style="background: none; border: none; padding: 0.75rem 1rem; color: var(--text-secondary); cursor: pointer; font-weight: 600; transition: all 0.2s; border-bottom: 2px solid transparent;"
            :style="activeTab === 'questions' ? 'color: var(--primary); border-bottom-color: var(--primary);' : ''"
            @click="activeTab = 'questions'"
          >
            Questions Repository
          </button>
          <button 
            style="background: none; border: none; padding: 0.75rem 1rem; color: var(--text-secondary); cursor: pointer; font-weight: 600; transition: all 0.2s; border-bottom: 2px solid transparent;"
            :style="activeTab === 'banks' ? 'color: var(--primary); border-bottom-color: var(--primary);' : ''"
            @click="activeTab = 'banks'"
          >
            Question Banks ({{ banks.length }})
          </button>
        </div>
      </header>

      <div class="content-body fade-in-el">
        <!-- Messages -->
        <div v-if="errorMessage" class="alert alert-error">
          <span>{{ errorMessage }}</span>
        </div>
        <div v-if="successMessage" class="alert alert-success">
          <span>{{ successMessage }}</span>
        </div>

        <section class="section-card api-snapshot-panel">
          <div class="api-snapshot-header">
            <div>
              <p class="snapshot-kicker">Required API Snapshot</p>
              <h3>Question Bank API Readiness</h3>
            </div>
            <button class="btn btn-secondary btn-sm" type="button" :disabled="apiSnapshotLoading" @click="fetchApiSnapshot">
              {{ apiSnapshotLoading ? 'Refreshing...' : 'Refresh' }}
            </button>
          </div>
          <div v-if="apiSnapshotError" class="snapshot-error">
            {{ apiSnapshotError }}
          </div>
          <div class="api-snapshot-grid">
            <div v-for="item in apiSnapshotCards" :key="item.label" class="snapshot-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
            <div class="snapshot-card snapshot-identity">
              <span>Instance ID</span>
              <strong>{{ apiSnapshot?.instanceId || '-' }}</strong>
            </div>
            <div class="snapshot-card snapshot-identity">
              <span>User ID</span>
              <strong>{{ apiSnapshot?.userId || authStore.user?.id || '-' }}</strong>
            </div>
          </div>
          <p class="snapshot-footnote">
            Last refreshed: {{ apiSnapshot?.refreshedAt ? new Date(apiSnapshot.refreshedAt).toLocaleString() : 'Not refreshed yet' }}
          </p>
        </section>

        <!-- Tab 1: Questions -->
        <div v-if="activeTab === 'questions'">
          <!-- Filter Controls -->
          <div class="section-card" style="margin-bottom: 1.5rem;">
            <!-- Primary Filter Bar -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; align-items: flex-end;">
              <!-- Search -->
              <div>
                <label class="form-label">Search Content</label>
                <div style="display: flex; gap: 0.5rem;">
                  <input v-model="filterSearch" type="text" class="form-input" placeholder="Type keywords..." @keyup.enter="handleSearch" />
                  <button class="btn btn-secondary" style="width: auto; padding: 0 1rem;" @click="handleSearch">Go</button>
                </div>
              </div>

              <div>
                <label class="form-label">Source File Name</label>
                <input v-model="filterSourceFileName" type="search" class="form-input" placeholder="PDF, Drive, or Excel file..." @keyup.enter="handleSearch" />
              </div>

              <!-- Subject -->
              <div>
                <label class="form-label">Subject</label>
                <select v-model="filterSubjectId" :disabled="subjectsLoading" class="form-input" style="appearance: auto; background-color: var(--bg-input);">
                  <option value="">{{ subjectsLoading ? 'Loading subjects...' : 'All Subjects' }}</option>
                  <option v-for="sub in subjects" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
                </select>
                <span v-if="subjectsError" class="field-help is-error">{{ subjectsError }}</span>
                <span v-else-if="!subjectsLoading && subjects.length === 0" class="field-help">No subjects available yet.</span>
              </div>

              <!-- Chapter -->
              <div>
                <label class="form-label">Chapter</label>
                <select v-model="filterChapterId" :disabled="!filterSubjectId || chaptersList.length === 0" class="form-input" style="appearance: auto; background-color: var(--bg-input);">
                  <option value="">{{ !filterSubjectId ? 'Select subject first' : 'All Chapters' }}</option>
                  <option v-for="chap in chaptersList" :key="chap.id" :value="chap.id">{{ chap.name }}</option>
                </select>
                <span v-if="filterSubjectId && chaptersList.length === 0" class="field-help">No chapters found for this subject.</span>
              </div>

              <!-- Concept -->
              <div>
                <label class="form-label">Concept</label>
                <select v-model="filterConceptId" :disabled="!filterChapterId || conceptsList.length === 0" class="form-input" style="appearance: auto; background-color: var(--bg-input);">
                  <option value="">{{ !filterChapterId ? 'Select chapter first' : 'All Concepts' }}</option>
                  <option v-for="conc in conceptsList" :key="conc.id" :value="conc.id">{{ conc.name }}</option>
                </select>
                <span v-if="filterChapterId && conceptsList.length === 0" class="field-help">No concepts found for this chapter.</span>
              </div>

              <!-- Toggle / Action Buttons -->
              <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button class="btn btn-secondary" style="width: auto; font-size: 0.9rem;" @click="toggleAdvancedFilters">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                  {{ showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters' }}
                </button>
                <button class="btn btn-secondary" style="width: auto; font-size: 0.9rem;" @click="clearFilters" title="Reset all search criteria">
                  Clear
                </button>
              </div>
            </div>

            <!-- Advanced Filters Collapsible Panel -->
            <div v-if="showAdvancedFilters" class="fade-in-el" style="margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border-color); display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
              
              <!-- Difficulties Checklist (Multi-select) -->
              <div>
                <label class="form-label" style="font-weight: 600;">Difficulty Levels</label>
                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterDifficulties" value="EASY" class="checkbox-custom" />
                    <span style="color: #34d399; font-weight: 500;">EASY</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterDifficulties" value="MEDIUM" class="checkbox-custom" />
                    <span style="color: #fbbf24; font-weight: 500;">MEDIUM</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterDifficulties" value="HARD" class="checkbox-custom" />
                    <span style="color: #fca5a5; font-weight: 500;">HARD</span>
                  </label>
                </div>
              </div>

              <!-- Question Type Checklist (Multi-select) -->
              <div>
                <label class="form-label" style="font-weight: 600;">Question Types</label>
                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterTypes" value="MCQ" class="checkbox-custom" />
                    <span>Multiple Choice (MCQ)</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterTypes" value="TRUE_FALSE" class="checkbox-custom" />
                    <span>True / False</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterTypes" value="SHORT_ANSWER" class="checkbox-custom" />
                    <span>Short Answer</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterTypes" value="ESSAY" class="checkbox-custom" />
                    <span>Essay</span>
                  </label>
                </div>
              </div>

              <!-- Question Status Checklist (Multi-select) -->
              <div>
                <label class="form-label" style="font-weight: 600;">Verification Status</label>
                <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem;">
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterStatuses" value="DRAFT" class="checkbox-custom" />
                    <span class="badge badge-admin" style="font-size: 0.65rem;">DRAFT</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterStatuses" value="PENDING_REVIEW" class="checkbox-custom" />
                    <span class="badge badge-support" style="font-size: 0.65rem;">PENDING REVIEW</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterStatuses" value="APPROVED" class="checkbox-custom" />
                    <span class="badge badge-teacher" style="font-size: 0.65rem;">APPROVED</span>
                  </label>
                  <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; color: var(--text-secondary);">
                    <input type="checkbox" v-model="filterStatuses" value="REJECTED" class="checkbox-custom" />
                    <span class="badge" style="font-size: 0.65rem; background-color: rgba(239, 68, 68, 0.2); color: #fca5a5;">REJECTED</span>
                  </label>
                </div>
              </div>

              <!-- Creator & Answer text search -->
              <div style="display: flex; flex-direction: column; gap: 1rem;">
                <div>
                  <label class="form-label" style="font-weight: 600;">Creator (Author)</label>
                  <select v-model="filterAuthorId" class="form-input" style="appearance: auto; background-color: var(--bg-input); margin-top: 0.25rem;">
                    <option value="">All Authors</option>
                    <option v-for="user in authors" :key="user.id" :value="user.id">{{ user.name }}</option>
                  </select>
                </div>

                <div>
                  <label class="form-label" style="font-weight: 600;">Answer Choice Search</label>
                  <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem;">
                    <input v-model="filterAnswerSearch" type="text" class="form-input" placeholder="Option text contains..." @keyup.enter="handleSearch" />
                    <button class="btn btn-secondary btn-sm" style="width: auto;" @click="handleSearch">Search</button>
                  </div>
                </div>
              </div>

              <!-- Date Ranges -->
              <div>
                <label class="form-label" style="font-weight: 600;">Date Range Created</label>
                <div style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem;">
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">From:</span>
                    <input v-model="filterDateStart" type="date" class="form-input" style="color-scheme: dark; margin-top: 0.25rem;" @change="handleSearch" />
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">To:</span>
                    <input v-model="filterDateEnd" type="date" class="form-input" style="color-scheme: dark; margin-top: 0.25rem;" @change="handleSearch" />
                  </div>
                </div>
              </div>

            </div>
          </div>

          <!-- Questions List -->
          <div v-if="loading" class="spinner-container">
            <div class="spinner"></div>
            <div class="spinner-text">Retrieving questions...</div>
          </div>
          <div v-else-if="questions.length === 0" style="padding: 4rem; text-align: center; color: var(--text-secondary);" class="section-card">
            No questions match the selected filters.
          </div>
          <div v-else style="display: flex; flex-direction: column; gap: 1rem;">
            <!-- Bulk Actions Bar -->
            <div v-if="canWrite && deletableQuestions.length > 0" class="section-card" style="padding: 1rem 1.5rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; border-color: rgba(99, 102, 241, 0.15); background-color: rgba(99, 102, 241, 0.01);">
              <div style="display: flex; align-items: center; gap: 1rem;">
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; user-select: none;">
                  <input 
                    type="checkbox" 
                    :checked="isAllSelected" 
                    @change="toggleSelectAll" 
                    style="width: 18px; height: 18px; cursor: pointer; accent-color: var(--primary);"
                  />
                  <span style="font-weight: 600; font-size: 0.95rem; color: var(--text-primary);">Select All ({{ deletableQuestions.length }})</span>
                </label>
                <span v-if="selectedQuestionIds.length > 0" style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 500;">
                  {{ selectedQuestionIds.length }} Selected
                </span>
              </div>
              
              <div v-if="selectedQuestionIds.length > 0">
                <button 
                  class="btn btn-secondary btn-sm" 
                  style="width: auto; color: #fca5a5; border-color: rgba(239, 68, 68, 0.2); background-color: rgba(239, 68, 68, 0.05); padding: 0.45rem 1.25rem; font-size: 0.85rem; font-weight: 600;" 
                  @click="handleBulkDelete"
                >
                  🗑️ Delete Selected
                </button>
              </div>
            </div>

            <!-- Question Card -->
            <div v-for="q in questions" :key="q.id" class="section-card" style="padding: 1.5rem;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                  <input 
                    v-if="canDeleteQuestion(q)"
                    type="checkbox" 
                    :value="q.id" 
                    v-model="selectedQuestionIds" 
                    style="width: 16px; height: 16px; cursor: pointer; accent-color: var(--primary); margin-right: 0.25rem;" 
                  />
                  <span class="badge badge-admin" style="font-size: 0.7rem;">ID #{{ q.id }}</span>
                  <span class="badge" :style="getDifficultyColor(q.difficulty)">{{ q.difficulty }}</span>
                  <span class="badge badge-support" style="font-size: 0.7rem;">{{ q.type }}</span>
                  <span class="badge badge-teacher" v-if="q.concept" style="font-size: 0.7rem;">
                    {{ q.concept.chapter?.subject?.name }} &gt; {{ q.concept.chapter?.name }}
                  </span>
                </div>
                <div v-if="canDeleteQuestion(q)">
                  <button class="node-btn delete-btn" @click="handleDeleteQuestion(q.id)">Delete</button>
                </div>
              </div>

              <!-- Question text -->
              <p style="font-weight: 500; font-size: 1.1rem; margin-bottom: 1rem; line-height: 1.5;">{{ q.content }}</p>
              <img
                v-if="q.imageUrl"
                :src="getMediaUrl(q.imageUrl)"
                alt="Question image"
                style="display: block; max-width: 100%; max-height: 220px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 1rem; background: #fff;"
              />

              <!-- Option/Answer List -->
              <div v-if="q.answers && q.answers.length > 0" style="margin-left: 1rem; margin-bottom: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
                <div 
                  v-for="ans in q.answers" 
                  :key="ans.id"
                  style="display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 1rem; background-color: var(--bg-app); border: 1px solid var(--border-color); border-radius: var(--radius-sm);"
                  :style="ans.isCorrect ? 'border-color: rgba(16, 185, 129, 0.4); background-color: rgba(16, 185, 129, 0.03);' : ''"
                >
                  <span 
                    style="width: 8px; height: 8px; border-radius: 50%;"
                    :style="ans.isCorrect ? 'background-color: var(--success);' : 'background-color: var(--border-color);'"
                  ></span>
                  <div style="display: flex; flex-direction: column; gap: 0.35rem;">
                    <span :style="ans.isCorrect ? 'font-weight: 600; color: #a7f3d0;' : 'color: var(--text-secondary);'">
                      {{ ans.content }}
                    </span>
                    <img
                      v-if="ans.imageUrl"
                      :src="getMediaUrl(ans.imageUrl)"
                      alt="Option image"
                      style="display: block; max-width: 220px; max-height: 120px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #fff;"
                    />
                  </div>
                  <span v-if="ans.isCorrect" class="badge badge-teacher" style="font-size: 0.65rem; padding: 1px 4px;">Correct</span>
                </div>
              </div>

              <div v-if="q.explanation" style="font-size: 0.875rem; color: var(--text-muted); border-top: 1px dashed var(--border-color); padding-top: 0.75rem;">
                <strong>Explanation:</strong> {{ q.explanation }}
              </div>
              <div style="font-size: 0.78rem; color: var(--text-muted); border-top: 1px dashed var(--border-color); padding-top: 0.75rem; margin-top: 0.75rem;">
                Source: {{ q.sourceFile?.fileName || q.sourceFileName || 'Manual entry' }}
                <span v-if="q.sourceType">({{ q.sourceType }})</span>
              </div>
            </div>
          </div>

          <div v-if="!loading && questionPagination.total > 0" class="pagination-row">
            <div class="page-size-control">
              <span>{{ questionPagination.total }} question{{ questionPagination.total === 1 ? '' : 's' }}</span>
              <select v-model.number="questionPagination.pageSize" class="form-input" @change="fetchQuestions(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="questionPagination.page <= 1" @click="fetchQuestions(questionPagination.page - 1)">Previous</button>
              <span>Page {{ questionPagination.page }} of {{ questionPagination.totalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="questionPagination.page >= questionPagination.totalPages" @click="fetchQuestions(questionPagination.page + 1)">Next</button>
            </div>
          </div>
        </div>

        <!-- Tab 2: Question Banks -->
        <div v-if="activeTab === 'banks'">
          <div class="section-card" style="margin-bottom: 1.5rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; align-items: flex-end;">
              <div>
                <label class="form-label">Question Bank Name</label>
                <input v-model="bankFilterSearch" type="text" class="form-input" placeholder="Search bank name..." @keyup.enter="handleBankSearch" />
              </div>
              <div>
                <label class="form-label">Academic Year</label>
                <input v-model="bankFilterAcademicYear" type="text" class="form-input" placeholder="e.g. 2020-2021" @keyup.enter="handleBankSearch" />
              </div>
              <div>
                <label class="form-label">SSC / Class</label>
                <input v-model="bankFilterSscClass" type="text" class="form-input" placeholder="e.g. XII" @keyup.enter="handleBankSearch" />
              </div>
              <div>
                <label class="form-label">Job Role</label>
                <input v-model="bankFilterJobRole" type="text" class="form-input" placeholder="e.g. 312_PHYSICS" @keyup.enter="handleBankSearch" />
              </div>
              <div>
                <label class="form-label">Subject Code</label>
                <input v-model="bankFilterSubjectCode" type="text" class="form-input" placeholder="e.g. 312" @keyup.enter="handleBankSearch" />
              </div>
              <div>
                <label class="form-label">Subject Name</label>
                <input v-model="bankFilterSubjectName" type="text" class="form-input" placeholder="e.g. Physics" @keyup.enter="handleBankSearch" />
              </div>
              <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button class="btn btn-secondary" style="width: auto; font-size: 0.9rem;" @click="handleBankSearch">Search</button>
                <button class="btn btn-secondary" style="width: auto; font-size: 0.9rem;" @click="clearBankFilters">Clear</button>
              </div>
            </div>
          </div>

          <div v-if="banksLoading" class="spinner-container">
            <div class="spinner"></div>
            <div class="spinner-text">Retrieving question banks...</div>
          </div>
          <div v-else-if="banks.length === 0" style="padding: 4rem; text-align: center; color: var(--text-secondary);" class="section-card">
            {{ hasBankFilters ? 'No question banks match the selected metadata filters.' : 'No question banks created. Click "+ Create Bank" to set up a question binder.' }}
          </div>
          <div v-else style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
            <!-- Bank Card -->
            <div v-for="bank in banks" :key="bank.id" class="section-card" style="display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem;">
                  <span class="badge" :class="bank.isPublic ? 'badge-teacher' : 'badge-admin'">
                    {{ bank.isPublic ? 'Public' : 'Private' }}
                  </span>
                  <span style="font-size: 0.8rem; color: var(--text-muted);">
                    {{ bank._count?.bankQuestions || 0 }} Questions
                  </span>
                </div>
                <h3 style="font-size: 1.2rem; font-weight: 700; margin-bottom: 0.5rem;">{{ bank.name }}</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; line-height: 1.4; margin-bottom: 1.5rem;">
                  {{ bank.description || 'No description provided.' }}
                </p>
                <div class="bank-metadata-grid">
                  <div class="bank-meta-item">
                    <span>Academic Year</span>
                    <strong>{{ formatBankMeta(bank.academicYear) }}</strong>
                  </div>
                  <div class="bank-meta-item">
                    <span>SSC / Class</span>
                    <strong>{{ formatBankMeta(bank.sscClass) }}</strong>
                  </div>
                  <div class="bank-meta-item">
                    <span>Job Role</span>
                    <strong>{{ formatBankMeta(bank.jobRole) }}</strong>
                  </div>
                  <div class="bank-meta-item">
                    <span>Subject Code</span>
                    <strong>{{ formatBankMeta(bank.subjectCode) }}</strong>
                  </div>
                  <div class="bank-meta-item">
                    <span>Subject Name</span>
                    <strong>{{ formatBankMeta(bank.subjectName) }}</strong>
                  </div>
                </div>
              </div>

              <div style="display: flex; gap: 0.5rem; border-top: 1px solid var(--border-color); padding-top: 1rem; flex-wrap: wrap;">
                <button class="btn btn-secondary btn-sm" @click="openBankDetails(bank.id)" style="flex: 1;">View & Manage</button>
                <button class="btn btn-secondary btn-sm" @click="openEditBank(bank)" v-if="canWrite" style="width: auto;">Edit</button>
                <button class="btn btn-secondary btn-sm" @click="handleDeleteBank(bank.id)" v-if="canWrite" style="color: #fca5a5; border-color: rgba(239, 68, 68, 0.2); width: auto;">
                  Delete
                </button>
              </div>
            </div>
          </div>

          <div v-if="!banksLoading && bankPagination.total > 0" class="pagination-row">
            <div class="page-size-control">
              <span>{{ bankPagination.total }} bank{{ bankPagination.total === 1 ? '' : 's' }}</span>
              <select v-model.number="bankPagination.pageSize" class="form-input" @change="fetchBanks(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="bankPagination.page <= 1" @click="fetchBanks(bankPagination.page - 1)">Previous</button>
              <span>Page {{ bankPagination.page }} of {{ bankPagination.totalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="bankPagination.page >= bankPagination.totalPages" @click="fetchBanks(bankPagination.page + 1)">Next</button>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Create Question Modal -->
    <div v-if="isQuestionModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem; overflow-y: auto;">
      <div class="auth-card fade-in-el" style="max-width: 650px; width: 100%; padding: 2.5rem; box-shadow: var(--shadow-lg); margin-top: auto; margin-bottom: auto;">
        <div class="auth-header" style="margin-bottom: 1.5rem; text-align: left;">
          <h2 class="auth-title">Create Question</h2>
          <p class="auth-subtitle">Define content, type, options, and categorization</p>
        </div>

        <form @submit.prevent="handleSaveQuestion">
          <!-- Categorization -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
            <div>
              <label class="form-label">Subject</label>
              <select v-model="formSubjectId" :disabled="subjectsLoading" class="form-input" style="appearance: auto; background-color: var(--bg-input);" required>
                <option value="">{{ subjectsLoading ? 'Loading subjects...' : 'Select...' }}</option>
                <option v-for="sub in subjects" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
              </select>
              <span v-if="subjectsError" class="field-help is-error">{{ subjectsError }}</span>
            </div>
            <div>
              <label class="form-label">Chapter</label>
              <select v-model="formChapterId" :disabled="!formSubjectId || formChaptersList.length === 0" class="form-input" style="appearance: auto; background-color: var(--bg-input);" required>
                <option value="">{{ !formSubjectId ? 'Select subject first' : 'Select...' }}</option>
                <option v-for="chap in formChaptersList" :key="chap.id" :value="chap.id">{{ chap.name }}</option>
              </select>
              <span v-if="formSubjectId && formChaptersList.length === 0" class="field-help">No chapters found for this subject.</span>
            </div>
            <div>
              <label class="form-label">Concept</label>
              <select v-model="formConceptId" :disabled="!formChapterId || formConceptsList.length === 0" class="form-input" style="appearance: auto; background-color: var(--bg-input);" required>
                <option value="">{{ !formChapterId ? 'Select chapter first' : 'Select...' }}</option>
                <option v-for="conc in formConceptsList" :key="conc.id" :value="conc.id">{{ conc.name }}</option>
              </select>
              <span v-if="formChapterId && formConceptsList.length === 0" class="field-help">No concepts found for this chapter.</span>
            </div>
          </div>

          <!-- Content -->
          <div class="form-group">
            <label for="q-content" class="form-label">Question Text / Image</label>
            <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-input); padding: 0.65rem; display: flex; flex-direction: column; gap: 0.65rem; min-height: 132px;">
              <textarea
                id="q-content"
                v-model="questionContent"
                placeholder="Type text here, or paste an image..."
                style="width: 100%; resize: vertical; min-height: 72px; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; line-height: 1.45;"
                @paste="handleQuestionImagePaste"
              ></textarea>
              <img
                v-if="questionImageUrl"
                :src="getMediaUrl(questionImageUrl)"
                alt="Question image preview"
                style="display: block; max-width: 100%; max-height: 220px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #fff;"
              />
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                <label class="node-btn" style="margin: 0; cursor: pointer;">
                  Add Image
                  <input type="file" accept="image/*" :disabled="mediaUploading" @change="handleQuestionImageUpload" style="display: none;" />
                </label>
                <button v-if="questionImageUrl" type="button" class="node-btn delete-btn" @click="questionImageUrl = ''">Remove Image</button>
              </div>
            </div>
          </div>

          <!-- Type & Difficulty -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
            <div>
              <label class="form-label">Type</label>
              <select v-model="questionType" class="form-input" style="appearance: auto; background-color: var(--bg-input);">
                <option value="MCQ">MCQ</option>
                <option value="TRUE_FALSE">True / False</option>
                <option value="SHORT_ANSWER">Short Answer</option>
                <option value="ESSAY">Essay</option>
              </select>
            </div>
            <div>
              <label class="form-label">Difficulty</label>
              <select v-model="questionDifficulty" class="form-input" style="appearance: auto; background-color: var(--bg-input);">
                <option value="EASY">EASY</option>
                <option value="MEDIUM">MEDIUM</option>
                <option value="HARD">HARD</option>
              </select>
            </div>
            <div>
              <label class="form-label">Status</label>
              <select v-model="questionStatus" class="form-input" style="appearance: auto; background-color: var(--bg-input);">
                <option value="DRAFT">DRAFT</option>
                <option value="PENDING_REVIEW">REVIEW</option>
                <option value="APPROVED">APPROVED</option>
              </select>
            </div>
          </div>

          <!-- MCQ Answer Options Builder -->
          <div v-if="questionType === 'MCQ'" style="margin-bottom: 1.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <label class="form-label" style="margin-bottom: 0;">Answer Options</label>
              <button type="button" @click="addAnswerOption" style="background: none; border: none; color: var(--primary); font-weight: 600; cursor: pointer; font-size: 0.85rem;">+ Add Option</button>
            </div>
            
            <div style="display: flex; flex-direction: column; gap: 0.5rem; max-height: 180px; overflow-y: auto; padding-right: 0.25rem;">
              <div v-for="(ans, index) in answers" :key="index" style="display: grid; grid-template-columns: auto 1fr auto; gap: 0.65rem; align-items: flex-start; padding: 0.65rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255,255,255,0.02);">
                <input v-model="ans.isCorrect" type="checkbox" title="Mark as Correct Option" style="width: 18px; height: 18px; accent-color: var(--success); cursor: pointer; margin-top: 0.75rem;" />
                <div>
                  <div style="border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-input); padding: 0.5rem; display: flex; flex-direction: column; gap: 0.5rem;">
                    <input
                      v-model="ans.content"
                      type="text"
                      :placeholder="`Option ${index + 1} text or paste image...`"
                      style="width: 100%; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit;"
                      @paste="handleAnswerImagePaste($event, ans)"
                    />
                    <img
                      v-if="ans.imageUrl"
                      :src="getMediaUrl(ans.imageUrl)"
                      :alt="`Option ${index + 1} image preview`"
                      style="display: block; max-width: 100%; max-height: 140px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: #fff;"
                    />
                    <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                      <label class="node-btn" style="margin: 0; cursor: pointer;">
                        Add Image
                        <input type="file" accept="image/*" :disabled="mediaUploading" @change="handleAnswerImageUpload($event, ans)" style="display: none;" />
                      </label>
                      <button v-if="ans.imageUrl" type="button" class="node-btn delete-btn" @click="ans.imageUrl = ''">Remove Image</button>
                    </div>
                  </div>
                </div>
                <button type="button" @click="removeAnswerOption(index)" :disabled="answers.length <= 2" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 1.1rem; margin-top: 0.35rem;">&times;</button>
              </div>
            </div>
          </div>

          <!-- True/False Builder -->
          <div v-if="questionType === 'TRUE_FALSE'" style="margin-bottom: 1.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background-color: var(--bg-input);">
              <input type="radio" id="tf-t" name="tf-correct" :value="true" v-model="answers[0].isCorrect" @change="answers[1].isCorrect = false" />
              <label for="tf-t">True (Correct)</label>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background-color: var(--bg-input);">
              <input type="radio" id="tf-f" name="tf-correct" :value="true" v-model="answers[1].isCorrect" @change="answers[0].isCorrect = false" />
              <label for="tf-f">False (Correct)</label>
            </div>
          </div>

          <div class="form-group">
            <label for="q-exp" class="form-label">Explanatory Solution (Optional)</label>
            <textarea id="q-exp" v-model="questionExplanation" class="form-input" placeholder="Explain the correct answer steps..." style="resize: vertical; min-height: 60px;"></textarea>
          </div>

          <div style="display: flex; gap: 1rem; margin-top: 2rem;">
            <button type="button" class="btn btn-secondary" @click="isQuestionModalOpen = false">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Question</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Create Bank Modal -->
    <div v-if="isBankModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem; overflow-y: auto;">
      <div class="auth-card fade-in-el" style="max-width: 720px; width: 100%; padding: 2.5rem; box-shadow: var(--shadow-lg); max-height: 90vh; overflow-y: auto; margin-top: auto; margin-bottom: auto;">
        <div class="auth-header" style="margin-bottom: 2rem; text-align: left;">
          <h2 class="auth-title">{{ editingBankId ? 'Edit Question Bank' : 'Create Question Bank' }}</h2>
          <p class="auth-subtitle">Add bank identity, academic metadata, and publicity options</p>
        </div>

        <form @submit.prevent="handleSaveBank">
          <div class="form-group">
            <label for="b-name" class="form-label">Question Bank Name</label>
            <input id="b-name" v-model="bankName" type="text" class="form-input" placeholder="e.g. Physics Final Exam Study Guide" required />
          </div>

          <div class="form-group">
            <label for="b-desc" class="form-label">Description (Optional)</label>
            <textarea id="b-desc" v-model="bankDescription" class="form-input" placeholder="Brief details about the target subject bank..." style="resize: vertical; min-height: 80px;"></textarea>
          </div>

          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; margin-bottom: 1rem;">
            <div>
              <label for="b-year" class="form-label">Academic Year</label>
              <input id="b-year" v-model="bankAcademicYear" type="text" class="form-input" placeholder="e.g. 2020-2021" />
            </div>
            <div>
              <label for="b-class" class="form-label">SSC / Class</label>
              <input id="b-class" v-model="bankSscClass" type="text" class="form-input" placeholder="e.g. XII" />
            </div>
            <div>
              <label for="b-role" class="form-label">Job Role</label>
              <input id="b-role" v-model="bankJobRole" type="text" class="form-input" placeholder="e.g. 312_PHYSICS" />
            </div>
            <div>
              <label for="b-subject-code" class="form-label">Subject Code</label>
              <input id="b-subject-code" v-model="bankSubjectCode" type="text" class="form-input" placeholder="e.g. 312" />
            </div>
            <div style="grid-column: 1 / -1;">
              <label for="b-subject-name" class="form-label">Subject Name</label>
              <input id="b-subject-name" v-model="bankSubjectName" type="text" class="form-input" placeholder="e.g. Physics" />
            </div>
          </div>

          <div class="form-group">
            <label class="remember-me" style="margin-top: 0.5rem;">
              <input v-model="bankIsPublic" type="checkbox" class="checkbox-custom" />
              <span>Public (Allows other teachers to link questions)</span>
            </label>
          </div>

          <div style="display: flex; gap: 1rem; margin-top: 2rem;">
            <button type="button" class="btn btn-secondary" @click="isBankModalOpen = false">Cancel</button>
            <button type="submit" class="btn btn-primary">{{ editingBankId ? 'Save Changes' : 'Create Binder' }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Bank Details and Question Link Manager Modal -->
    <div v-if="isBankDetailsModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem;">
      <div class="auth-card fade-in-el" style="max-width: 700px; width: 100%; padding: 2.5rem; box-shadow: var(--shadow-lg); max-height: 90vh; display: flex; flex-direction: column;">
        <div class="auth-header" style="margin-bottom: 1.5rem; text-align: left;">
          <h2 class="auth-title">{{ selectedBank?.name }}</h2>
          <p class="auth-subtitle" style="margin-bottom: 0;">{{ selectedBank?.description || 'No description provided.' }}</p>
        </div>

        <div class="bank-metadata-grid" style="margin-top: 0; margin-bottom: 1.5rem;">
          <div class="bank-meta-item">
            <span>Academic Year</span>
            <strong>{{ formatBankMeta(selectedBank?.academicYear) }}</strong>
          </div>
          <div class="bank-meta-item">
            <span>SSC / Class</span>
            <strong>{{ formatBankMeta(selectedBank?.sscClass) }}</strong>
          </div>
          <div class="bank-meta-item">
            <span>Job Role</span>
            <strong>{{ formatBankMeta(selectedBank?.jobRole) }}</strong>
          </div>
          <div class="bank-meta-item">
            <span>Subject Code</span>
            <strong>{{ formatBankMeta(selectedBank?.subjectCode) }}</strong>
          </div>
          <div class="bank-meta-item">
            <span>Subject Name</span>
            <strong>{{ formatBankMeta(selectedBank?.subjectName) }}</strong>
          </div>
        </div>

        <!-- Question Link Operations -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
          <h4 style="font-size: 1.05rem; font-weight: 600;">Linked Questions ({{ selectedBank?.bankQuestions?.length || 0 }})</h4>
          <button class="btn btn-primary btn-sm" @click="openLinkingQuestionModal" v-if="canWrite" style="width: auto;">Link Questions</button>
        </div>

        <div v-if="canWrite && linkedBankQuestions.length > 0" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; padding: 0.75rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255, 255, 255, 0.02);">
          <label style="display: inline-flex; align-items: center; gap: 0.5rem; color: var(--text-secondary); font-size: 0.9rem; font-weight: 600;">
            <input
              type="checkbox"
              :checked="isAllLinkedSelected"
              :disabled="isUnlinkingQuestions"
              @change="toggleSelectAllUnlinkQuestions"
              style="width: 16px; height: 16px; accent-color: var(--primary);"
            />
            Select all linked
          </label>
          <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; justify-content: flex-end;">
            <span style="font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;">{{ selectedUnlinkQuestionIds.length }} selected</span>
            <button
              class="node-btn delete-btn"
              :disabled="selectedUnlinkQuestionIds.length === 0 || isUnlinkingQuestions"
              :style="selectedUnlinkQuestionIds.length === 0 || isUnlinkingQuestions ? 'opacity: 0.55; cursor: not-allowed;' : ''"
              @click="handleUnlinkSelectedQuestions"
            >
              {{ isUnlinkingQuestions ? 'Unlinking...' : `Unlink Selected (${selectedUnlinkQuestionIds.length})` }}
            </button>
          </div>
        </div>

        <!-- Questions in Bank List -->
        <div style="flex: 1; overflow-y: auto; padding-right: 0.25rem; display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem;">
          <div v-if="!selectedBank?.bankQuestions || selectedBank.bankQuestions.length === 0" style="padding: 2rem; text-align: center; color: var(--text-secondary); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
            No questions linked to this bank yet. Click "Link Questions" to associate items.
          </div>
          <div 
            v-for="bq in linkedBankQuestions" 
            :key="bq.questionId"
            :style="`padding: 1rem; border: 1px solid ${selectedUnlinkQuestionIds.includes(bq.questionId) ? 'var(--primary)' : 'var(--border-color)'}; border-radius: var(--radius-md); background: ${selectedUnlinkQuestionIds.includes(bq.questionId) ? 'rgba(99, 102, 241, 0.12)' : 'var(--bg-app)'}; display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; cursor: ${canWrite ? 'pointer' : 'default'}; transition: all 0.2s;`"
            @click="canWrite && toggleUnlinkQuestionSelection(bq.questionId)"
          >
            <div style="display: flex; align-items: flex-start; gap: 0.75rem; flex: 1; min-width: 0;">
              <input
                v-if="canWrite"
                type="checkbox"
                :checked="selectedUnlinkQuestionIds.includes(bq.questionId)"
                :disabled="isUnlinkingQuestions"
                @click.stop
                @change="toggleUnlinkQuestionSelection(bq.questionId)"
                style="width: 16px; height: 16px; accent-color: var(--primary); margin-top: 0.15rem; flex: 0 0 auto;"
              />
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
                  <span class="badge badge-admin" style="font-size: 0.65rem;">ID #{{ bq.question.id }}</span>
                  <span class="badge" style="font-size: 0.65rem; color: #34d399; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.24);">LINKED</span>
                  <span v-if="selectedUnlinkQuestionIds.includes(bq.questionId)" class="badge" style="font-size: 0.65rem; color: #c4b5fd; background: rgba(99, 102, 241, 0.16); border: 1px solid rgba(99, 102, 241, 0.28);">SELECTED</span>
                </div>
                <p style="font-size: 0.95rem; line-height: 1.4; color: var(--text-primary);">{{ bq.question.content }}</p>
                <img
                  v-if="bq.question.imageUrl"
                  :src="getMediaUrl(bq.question.imageUrl)"
                  alt="Linked question image"
                  style="display: block; max-width: 100%; max-height: 160px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-top: 0.5rem; background: #fff;"
                />
              </div>
            </div>
            <button class="node-btn delete-btn" @click.stop="handleUnlinkQuestion(bq.questionId)" v-if="canWrite">Unlink</button>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" :disabled="isUnlinkingQuestions" @click="closeBankDetails" style="width: auto; padding: 0.75rem 2rem;">Close Details</button>
        </div>
      </div>
    </div>

    <!-- Select and Link Question Modal Layer -->
    <div v-if="isLinkingQuestionModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.75); display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 2rem;">
      <div class="auth-card fade-in-el" style="max-width: 760px; width: 100%; padding: 2rem; max-height: 84vh; display: flex; flex-direction: column;">
        <div style="display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; margin-bottom: 1rem;">
          <div>
            <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.35rem;">Select Questions to Link</h3>
            <p style="font-size: 0.9rem; color: var(--text-secondary); margin: 0;">{{ selectedLinkQuestionIds.length }} selected | {{ linkQuestionPool.length }} visible | {{ selectedBank?.bankQuestions?.length || 0 }} already linked</p>
          </div>
          <label v-if="!linkQuestionsLoading && unlinkedQuestions.length > 0" style="display: inline-flex; align-items: center; gap: 0.5rem; color: var(--text-secondary); font-size: 0.9rem; font-weight: 600; white-space: nowrap;">
            <input
              type="checkbox"
              :checked="isAllUnlinkedSelected"
              :disabled="isLinkingQuestions"
              @change="toggleSelectAllLinkQuestions"
              style="width: 16px; height: 16px; accent-color: var(--primary);"
            />
            Select all available
          </label>
        </div>

        <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); background: rgba(255, 255, 255, 0.03); padding: 1rem; margin-bottom: 1rem;">
          <label class="form-label" for="link-subject">Select Subject</label>
          <select
            id="link-subject"
            v-model="linkSubjectId"
            class="form-input"
            :disabled="subjectsLoading || isLinkingQuestions"
            style="margin-bottom: 0; appearance: auto; background-color: var(--bg-input);"
          >
            <option value="">{{ subjectsLoading ? 'Loading subjects...' : 'Choose a subject first' }}</option>
            <option v-for="subject in subjects" :key="subject.id" :value="subject.id">
              {{ subject.name }}
            </option>
          </select>
        </div>
        
        <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem;">
          <div v-if="!linkSubjectId" style="padding: 2rem; text-align: center; color: var(--text-secondary); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
            Select a subject to view questions for linking.
          </div>
          <div v-else-if="linkQuestionsLoading" style="padding: 2rem; text-align: center; color: var(--text-secondary);">
            Loading all matching questions...
          </div>
          <div v-else-if="linkQuestionsError" class="alert alert-error" style="margin-bottom: 0;">
            <span>{{ linkQuestionsError }}</span>
          </div>
          <div v-else-if="linkQuestionPool.length === 0" style="padding: 2rem; text-align: center; color: var(--text-secondary);">
            No questions found under this subject.
          </div>
          <!-- Loop full matching questions list, not just the current 10-row page -->
          <div 
            v-for="q in linkQuestionPool" 
            :key="q.id"
            :style="`padding: 0.75rem 1rem; border: 1px solid ${selectedLinkQuestionIds.includes(q.id) ? 'var(--primary)' : 'var(--border-color)'}; border-radius: var(--radius-sm); cursor: ${isQuestionLinked(q.id) ? 'default' : 'pointer'}; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; gap: 1rem; background: ${selectedLinkQuestionIds.includes(q.id) ? 'rgba(99, 102, 241, 0.12)' : isQuestionLinked(q.id) ? 'rgba(16, 185, 129, 0.06)' : 'transparent'}; opacity: ${isQuestionLinked(q.id) ? '0.78' : '1'};`"
            hover-bg
            @click="toggleLinkQuestionSelection(q.id)"
          >
            <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1; min-width: 0;">
              <input
                type="checkbox"
                :checked="selectedLinkQuestionIds.includes(q.id)"
                :disabled="isQuestionLinked(q.id) || isLinkingQuestions"
                @click.stop
                @change="toggleLinkQuestionSelection(q.id)"
                style="width: 16px; height: 16px; accent-color: var(--primary); flex: 0 0 auto;"
              />
              <div style="flex: 1; min-width: 0;">
                <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; flex-wrap: wrap;">
                  <span class="badge badge-admin" style="font-size: 0.65rem;">ID #{{ q.id }}</span>
                  <span v-if="isQuestionLinked(q.id)" class="badge" style="font-size: 0.65rem; color: #34d399; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.24);">LINKED</span>
                  <span v-else-if="selectedLinkQuestionIds.includes(q.id)" class="badge" style="font-size: 0.65rem; color: #c4b5fd; background: rgba(99, 102, 241, 0.16); border: 1px solid rgba(99, 102, 241, 0.28);">SELECTED</span>
                </div>
                <p style="font-size: 0.9rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">{{ q.content }}</p>
                <img
                  v-if="q.imageUrl"
                  :src="getMediaUrl(q.imageUrl)"
                  alt="Question image preview"
                  style="display: block; max-width: 220px; max-height: 100px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); margin-top: 0.4rem; background: #fff;"
                />
              </div>
            </div>
            <button
              class="node-btn"
              :disabled="isQuestionLinked(q.id) || isLinkingQuestions"
              @click.stop="toggleLinkQuestionSelection(q.id)"
            >
              {{ isQuestionLinked(q.id) ? 'Linked' : selectedLinkQuestionIds.includes(q.id) ? 'Selected' : 'Select' }}
            </button>
          </div>
        </div>

        <div style="display: flex; gap: 1rem;">
          <button type="button" class="btn btn-secondary" :disabled="isLinkingQuestions" @click="closeLinkingQuestionModal">Done</button>
          <button type="button" class="btn btn-primary" :disabled="selectedLinkQuestionIds.length === 0 || isLinkingQuestions || linkQuestionsLoading" @click="handleLinkSelectedQuestions">
            {{ isLinkingQuestions ? 'Linking...' : `Link Selected (${selectedLinkQuestionIds.length})` }}
          </button>
        </div>
      </div>
    </div>

    <!-- Bulk PDF/Google Drive Import Modal -->
    <div v-if="isImportModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem; overflow-y: auto;">
      <div class="auth-card fade-in-el" style="max-width: 680px; width: 100%; padding: 2.5rem; box-shadow: var(--shadow-lg); margin-top: auto; margin-bottom: auto; display: flex; flex-direction: column; max-height: 90vh;">
        <div class="auth-header" style="margin-bottom: 1.5rem; text-align: left;">
          <h2 class="auth-title">Bulk Document Import</h2>
          <p class="auth-subtitle">Upload PDFs or connect Google Drive to auto-extract questions using Gemini AI</p>
        </div>

        <!-- Tab selection -->
        <div style="display: flex; gap: 1rem; border-bottom: 1px solid var(--border-color); margin-bottom: 1.5rem; width: 100%;">
          <button 
            type="button"
            style="background: none; border: none; padding: 0.5rem 1rem; color: var(--text-secondary); cursor: pointer; font-weight: 600; transition: all 0.2s; border-bottom: 2px solid transparent;"
            :style="importTab === 'upload' ? 'color: var(--primary); border-bottom-color: var(--primary);' : ''"
            :disabled="isImporting"
            @click="setImportTab('upload')"
          >
            Direct PDF Upload
          </button>
          <button 
            type="button"
            style="background: none; border: none; padding: 0.5rem 1rem; color: var(--text-secondary); cursor: pointer; font-weight: 600; transition: all 0.2s; border-bottom: 2px solid transparent;"
            :style="importTab === 'drive' ? 'color: var(--primary); border-bottom-color: var(--primary);' : ''"
            :disabled="isImporting"
            @click="setImportTab('drive')"
          >
            Google Drive Importer
          </button>
          <button 
            type="button"
            style="background: none; border: none; padding: 0.5rem 1rem; color: var(--text-secondary); cursor: pointer; font-weight: 600; transition: all 0.2s; border-bottom: 2px solid transparent;"
            :style="importTab === 'excel' ? 'color: var(--primary); border-bottom-color: var(--primary);' : ''"
            :disabled="isImporting"
            @click="setImportTab('excel')"
          >
            Excel Template Import
          </button>
          <button 
            type="button"
            style="background: none; border: none; padding: 0.5rem 1rem; color: var(--text-secondary); cursor: pointer; font-weight: 600; transition: all 0.2s; border-bottom: 2px solid transparent;"
            :style="importTab === 'jobs' ? 'color: var(--primary); border-bottom-color: var(--primary);' : ''"
            :disabled="isImporting"
            @click="setImportTab('jobs')"
          >
            Job Status Tracking ({{ jobsList.length }})
          </button>
        </div>

        <!-- Taxonomy Target Configuration (For both upload & drive import) -->
        <div v-if="importTab === 'upload' || importTab === 'drive'" style="background: rgba(255, 255, 255, 0.02); padding: 1.25rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); margin-bottom: 1.5rem;">
          <h4 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-primary);">1. Choose Target Taxonomy Concept</h4>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
            <div>
              <label class="form-label">Subject</label>
              <select v-model="importSubjectId" :disabled="isImporting || subjectsLoading" class="form-input" style="appearance: auto; background-color: var(--bg-input);" required>
                <option value="">{{ subjectsLoading ? 'Loading subjects...' : 'Select...' }}</option>
                <option v-for="sub in subjects" :key="sub.id" :value="sub.id">{{ sub.name }}</option>
              </select>
              <span v-if="subjectsError" class="field-help is-error">{{ subjectsError }}</span>
            </div>
            <div>
              <label class="form-label">Chapter</label>
              <select v-model="importChapterId" :disabled="!importSubjectId || importChaptersList.length === 0 || isImporting" class="form-input" style="appearance: auto; background-color: var(--bg-input);" required>
                <option value="">{{ !importSubjectId ? 'Select subject first' : 'Select...' }}</option>
                <option v-for="chap in importChaptersList" :key="chap.id" :value="chap.id">{{ chap.name }}</option>
              </select>
              <span v-if="importSubjectId && importChaptersList.length === 0" class="field-help">No chapters found for this subject.</span>
            </div>
            <div>
              <label class="form-label">Concept</label>
              <select v-model="importConceptId" :disabled="!importChapterId || importConceptsList.length === 0 || isImporting" class="form-input" style="appearance: auto; background-color: var(--bg-input);" required>
                <option value="">{{ !importChapterId ? 'Select chapter first' : 'Select...' }}</option>
                <option v-for="conc in importConceptsList" :key="conc.id" :value="conc.id">{{ conc.name }}</option>
              </select>
              <span v-if="importChapterId && importConceptsList.length === 0" class="field-help">No concepts found for this chapter.</span>
            </div>
          </div>
        </div>

        <!-- Tab Content 1: Local PDF Upload -->
        <div v-if="importTab === 'upload'" style="flex: 1; overflow-y: auto;">
          <h4 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-primary);">2. Select PDF Document</h4>
          <div class="form-group" style="border: 2px dashed var(--border-color); padding: 2rem; border-radius: var(--radius-md); text-align: center; background-color: rgba(255, 255, 255, 0.01);">
            <input type="file" id="pdf-file-upload" accept="application/pdf" :disabled="isLocalImporting" @change="handlePdfFileChange" style="display: none;" />
            <label for="pdf-file-upload" :style="`cursor: ${isLocalImporting ? 'not-allowed' : 'pointer'}; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;`">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span v-if="pdfFile" style="font-weight: 600; color: #a5b4fc;">{{ pdfFile.name }} ({{ (pdfFile.size/1024).toFixed(1) }} KB)</span>
              <span v-else style="color: var(--text-secondary);">Click here to select a PDF file</span>
            </label>
          </div>

          <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
            <button type="button" class="btn btn-secondary" :disabled="isLocalImporting" @click="closeImportModal">Close</button>
            <button type="button" class="btn btn-primary" :disabled="!canUploadLocalPdf" @click="handleLocalImport">
              {{ isLocalImporting ? 'Uploading...' : 'Upload & Import' }}
            </button>
          </div>
        </div>

        <!-- Tab Content 2: Google Drive Importer -->
        <div v-if="importTab === 'drive'" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column;">
          <!-- OAuth login trigger -->
          <div v-if="!googleConnected" style="text-align: center; padding: 3rem 1rem;">
            <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">You need to connect your Google Drive account to import documents directly.</p>
            <button type="button" class="btn btn-primary" style="width: auto; margin: 0 auto; display: flex; align-items: center; gap: 0.5rem;" :disabled="isImporting" @click="connectGoogleDrive">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              Connect Google Drive
            </button>
          </div>

          <!-- Connected and listing PDFs -->
          <div v-else style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <span style="font-size: 0.85rem; color: #34d399; display: flex; align-items: center; gap: 0.25rem;">
                <span style="width: 8px; height: 8px; background-color: #10b981; border-radius: 50%; display: inline-block;"></span>
                Connected to Google Drive
              </span>
              <button type="button" class="btn btn-secondary btn-sm" style="width: auto; color: #fca5a5; border-color: rgba(239, 68, 68, 0.2);" :disabled="isDriveImporting" @click="disconnectGoogleDrive">Disconnect</button>
            </div>

            <h4 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-primary);">2. Select PDF from Drive</h4>
            <div v-if="driveLoading" class="spinner-container" style="padding: 1.5rem;">
              <div class="spinner" style="width: 30px; height: 30px; border-width: 2px;"></div>
              <div class="spinner-text" style="font-size: 0.8rem;">Loading PDFs from Google Drive...</div>
            </div>
            <div v-else-if="driveFiles.length === 0" style="text-align: center; padding: 2rem; color: var(--text-secondary); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
              No PDF documents found in your Google Drive.
            </div>
            <div v-else style="flex: 1; overflow-y: auto; max-height: 200px; display: flex; flex-direction: column; gap: 0.5rem; border: 1px solid var(--border-color); padding: 0.5rem; border-radius: var(--radius-md); background-color: rgba(0, 0, 0, 0.15);">
              <div 
                v-for="file in driveFiles" 
                :key="file.id"
                style="display: flex; align-items: center; gap: 0.75rem; padding: 0.6rem 0.8rem; border-radius: var(--radius-sm); border: 1px solid transparent; cursor: pointer; transition: all 0.2s;"
                :style="selectedDriveFileId === file.id ? 'border-color: var(--primary); background-color: rgba(99, 102, 241, 0.1);' : 'background-color: var(--bg-card);'"
                @click="!isDriveImporting && (selectedDriveFileId = file.id)"
              >
                <span 
                  style="width: 14px; height: 14px; border: 2px solid var(--border-color); border-radius: 50%; display: flex; align-items: center; justify-content: center;"
                  :style="selectedDriveFileId === file.id ? 'border-color: var(--primary);' : ''"
                >
                  <span v-if="selectedDriveFileId === file.id" style="width: 6px; height: 6px; background-color: var(--primary); border-radius: 50%;"></span>
                </span>
                <div style="flex: 1; min-width: 0;">
                  <p style="font-size: 0.9rem; font-weight: 500; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: var(--text-primary);">{{ file.name }}</p>
                  <span style="font-size: 0.75rem; color: var(--text-muted);">{{ (file.size/1024).toFixed(0) }} KB</span>
                </div>
              </div>
            </div>

            <div style="display: flex; gap: 1rem; margin-top: 1.5rem;">
              <button type="button" class="btn btn-secondary" :disabled="isDriveImporting" @click="closeImportModal">Close</button>
              <button type="button" class="btn btn-primary" :disabled="!canImportDrivePdf" @click="handleDriveImport">
                {{ isDriveImporting ? 'Importing...' : 'Import Selected PDF' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Tab Content 3: Excel Template Import -->
        <div v-if="importTab === 'excel'" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem;">
          <div style="padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); background-color: rgba(99, 102, 241, 0.08); display: flex; justify-content: space-between; gap: 1rem; align-items: center;">
            <div>
              <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); margin: 0 0 0.25rem;">Latest QB Excel Template</h4>
              <p style="font-size: 0.82rem; color: var(--text-secondary); margin: 0;">
                Version {{ excelTemplateInfo?.version || 'loading...' }} · Date {{ excelTemplateInfo?.date || 'loading...' }}
              </p>
            </div>
            <button type="button" class="btn btn-primary btn-sm" style="width: auto;" :disabled="isTemplateDownloading" @click="downloadLatestExcelTemplate">
              {{ isTemplateDownloading ? 'Preparing...' : 'Download Latest Template' }}
            </button>
          </div>

          <div class="form-group" style="border: 2px dashed var(--border-color); padding: 1.5rem; border-radius: var(--radius-md); text-align: center; background-color: rgba(255, 255, 255, 0.01);">
            <input ref="excelFileInput" type="file" id="qb-excel-file-upload" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="isExcelPreviewing || isExcelCommitting" @change="handleExcelFileChange" style="display: none;" />
            <label for="qb-excel-file-upload" :style="`cursor: ${isExcelPreviewing || isExcelCommitting ? 'not-allowed' : 'pointer'}; display: flex; flex-direction: column; align-items: center; gap: 0.5rem;`">
              <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>
              <span v-if="excelFile" style="font-weight: 600; color: var(--primary);">{{ excelFile.name }} ({{ (excelFile.size/1024).toFixed(1) }} KB)</span>
              <span v-else style="color: var(--text-secondary);">Select a completed QB Excel template</span>
            </label>
          </div>

          <div style="display: flex; gap: 1rem;">
            <button type="button" class="btn btn-secondary" :disabled="isExcelPreviewing || isExcelCommitting" @click="closeImportModal">Close</button>
            <button type="button" class="btn btn-secondary" :disabled="!excelFile || isExcelPreviewing || isExcelCommitting" @click="resetExcelImport">Clear File</button>
            <button type="button" class="btn btn-primary" :disabled="!canPreviewExcel" @click="handleExcelPreview">
              {{ isExcelPreviewing ? 'Validating...' : 'Preview Validation' }}
            </button>
          </div>

          <div v-if="excelPreview" style="display: flex; flex-direction: column; gap: 0.9rem;">
            <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem;">
              <div style="padding: 0.85rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background-color: var(--bg-card);">
                <span style="display: block; color: var(--text-muted); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Rows</span>
                <strong style="font-size: 1.3rem; color: var(--text-primary);">{{ excelPreview.summary?.totalRows || 0 }}</strong>
              </div>
              <div style="padding: 0.85rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background-color: var(--bg-card);">
                <span style="display: block; color: var(--text-muted); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Creates</span>
                <strong style="font-size: 1.3rem; color: var(--text-primary);">{{ excelPreview.summary?.createRows || 0 }}</strong>
              </div>
              <div style="padding: 0.85rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background-color: var(--bg-card);">
                <span style="display: block; color: var(--text-muted); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Updates</span>
                <strong style="font-size: 1.3rem; color: var(--text-primary);">{{ excelPreview.summary?.updateRows || 0 }}</strong>
              </div>
              <div style="padding: 0.85rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background-color: var(--bg-card);">
                <span style="display: block; color: var(--text-muted); font-size: 0.72rem; font-weight: 700; text-transform: uppercase;">Errors</span>
                <strong style="font-size: 1.3rem;" :style="(excelPreview.summary?.errorRows || 0) > 0 ? 'color: #f87171;' : 'color: #34d399;'">{{ excelPreview.summary?.errorRows || 0 }}</strong>
              </div>
            </div>

            <div style="border: 1px solid var(--border-color); border-radius: var(--radius-md); overflow: hidden; background-color: var(--bg-card);">
              <div style="max-height: 260px; overflow: auto;">
                <table style="width: 100%; border-collapse: collapse; min-width: 920px;">
                  <thead>
                    <tr style="background: rgba(255, 255, 255, 0.04); color: var(--text-secondary); font-size: 0.75rem; text-transform: uppercase;">
                      <th style="padding: 0.75rem; text-align: left;">Row</th>
                      <th style="padding: 0.75rem; text-align: left;">Action</th>
                      <th style="padding: 0.75rem; text-align: left;">Bank</th>
                      <th style="padding: 0.75rem; text-align: left;">Question No.</th>
                      <th style="padding: 0.75rem; text-align: left;">Question Text</th>
                      <th style="padding: 0.75rem; text-align: left;">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in excelPreview.rows" :key="row.rowNumber" style="border-top: 1px solid var(--border-color);">
                      <td style="padding: 0.75rem; color: var(--text-muted); font-weight: 700;">{{ row.rowNumber }}</td>
                      <td style="padding: 0.75rem;">
                        <span class="badge" :class="row.action === 'update' ? 'badge-support' : 'badge-admin'">{{ row.action }}</span>
                      </td>
                      <td style="padding: 0.75rem; color: var(--text-primary);">{{ row.bankName || '-' }}</td>
                      <td style="padding: 0.75rem; color: var(--text-secondary);">{{ row.questionNo || '-' }}</td>
                      <td style="padding: 0.75rem; color: var(--text-secondary); max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ row.questionText || '-' }}</td>
                      <td style="padding: 0.75rem; color: var(--text-secondary);">
                        <span v-if="row.errors?.length" style="color: #f87171;">{{ row.errors.join(', ') }}</span>
                        <span v-else-if="row.warnings?.length" style="color: #fbbf24;">{{ row.warnings.join(', ') }}</span>
                        <span v-else style="color: #34d399;">Ready</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button type="button" class="btn btn-primary" style="width: auto;" :disabled="!canCommitExcel" @click="handleExcelCommit">
                {{ isExcelCommitting ? 'Importing...' : 'Import Valid Rows' }}
              </button>
            </div>
          </div>
        </div>

        <!-- Tab Content 4: Jobs tracking list -->
        <div v-if="importTab === 'jobs'" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; min-height: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
            <h4 style="font-size: 0.95rem; font-weight: 600; color: var(--text-primary); margin: 0;">Extraction Job Logs</h4>
            <button type="button" class="btn btn-secondary btn-sm" style="width: auto;" :disabled="isImporting" @click="fetchJobs">Refresh</button>
          </div>

          <div v-if="jobsLoading && jobsList.length === 0" class="spinner-container" style="padding: 2.5rem;">
            <div class="spinner" style="width: 32px; height: 32px; border-width: 2.5px;"></div>
            <div class="spinner-text" style="font-size: 0.85rem;">Loading extraction logs...</div>
          </div>
          <div v-else-if="jobsList.length === 0" style="text-align: center; padding: 2rem; color: var(--text-secondary); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
            No background parsing jobs registered yet.
          </div>
          <div v-else style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; padding-right: 0.25rem;">
            <div 
              v-for="job in jobsList" 
              :key="job.id"
              style="padding: 1rem; border-radius: var(--radius-md); border: 1px solid var(--border-color); background-color: var(--bg-card); display: flex; flex-direction: column; gap: 0.5rem;"
            >
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 0.5rem; align-items: center;">
                  <span class="badge badge-admin" style="font-size: 0.7rem;">Job #{{ job.id }}</span>
                  <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-primary);">{{ job.uploadFile?.fileName || 'Bulk Document Parse' }}</span>
                </div>
                <span 
                  class="badge"
                  :style="job.status === 'COMPLETED' ? 'color: #34d399; background: rgba(52, 211, 153, 0.1);' : 
                          job.status === 'FAILED' ? 'color: #fca5a5; background: rgba(252, 165, 165, 0.1);' :
                          job.status === 'PROCESSING' ? 'color: #fbbf24; background: rgba(251, 191, 36, 0.1);' :
                          'color: var(--text-muted); background: var(--bg-app);'"
                >
                  {{ job.status }}
                </span>
              </div>
              <p v-if="job.errorMessage" style="font-size: 0.85rem; color: var(--text-secondary); margin: 0; line-height: 1.4; word-break: break-word; background: rgba(0,0,0,0.2); padding: 0.5rem; border-radius: var(--radius-sm);">
                {{ job.errorMessage }}
              </p>
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted); border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 0.5rem; margin-top: 0.25rem;">
                <span>Started: {{ new Date(job.startedAt).toLocaleString() }}</span>
                <span>Ended: {{ job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : 'In Progress' }}</span>
              </div>
            </div>
          </div>

          <div style="display: flex; gap: 1rem; margin-top: 1.5rem; border-top: 1px solid var(--border-color); padding-top: 1rem;">
            <button type="button" class="btn btn-secondary" :disabled="isImporting" @click="closeImportModal" style="margin-left: auto;">Close</button>
          </div>
        </div>

      </div>
    </div>

  </div>
</template>

<style scoped>
.api-snapshot-panel {
  margin-bottom: 1.5rem;
}

.api-snapshot-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.api-snapshot-header h3 {
  margin: 0;
  color: var(--text-primary);
}

.snapshot-kicker,
.snapshot-footnote {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}

.snapshot-footnote {
  margin-top: 0.85rem;
  text-transform: none;
  font-weight: 600;
}

.api-snapshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.75rem;
}

.snapshot-card {
  min-width: 0;
  padding: 0.85rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.04);
}

.snapshot-card span {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.snapshot-card strong {
  display: block;
  color: var(--text-primary);
  font-size: 1.25rem;
  overflow-wrap: anywhere;
}

.snapshot-identity strong {
  font-size: 0.9rem;
}

.snapshot-error {
  margin-bottom: 0.85rem;
  padding: 0.75rem;
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: var(--radius-md);
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.08);
}

@media (max-width: 640px) {
  .api-snapshot-header {
    align-items: stretch;
    flex-direction: column;
  }
}

.tree-node.subject-node {
  margin-bottom: 0.5rem;
}

.node-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.4rem 1rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--primary);
  background-color: transparent;
  color: var(--primary);
  font-family: var(--font-primary);
  font-weight: 600;
  font-size: 0.825rem;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.node-btn:hover {
  background-color: var(--primary);
  color: #ffffff;
  box-shadow: 0 0 8px var(--primary-glow);
}

.node-btn.delete-btn {
  border-color: var(--error);
  color: var(--error);
  background-color: transparent;
}

.node-btn.delete-btn:hover {
  background-color: var(--error);
  color: #ffffff;
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.25);
}
</style>
