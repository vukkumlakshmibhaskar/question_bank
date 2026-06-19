<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
const canManageTemplates = computed(() => userRole.value === 'ADMIN')

const testPapers = ref([])
const subjects = ref([])
const questionBanks = ref([])
const assessmentTemplates = ref([])
const bankDetails = ref({})
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const loadingBanks = ref(false)
const loadingTemplates = ref(false)
const subjectsLoading = ref(false)
const subjectsError = ref('')
const savingTemplate = ref(false)
const downloadingSetId = ref(null)
const pagination = ref(createPagination(10))

const filterSearch = ref('')
const filterClassGrade = ref('')
const filterSubjectId = ref('')
const filterStatus = ref('')

const isModalOpen = ref(false)
const isSetModalOpen = ref(false)
const isSetPreviewOpen = ref(false)
const isTemplateManagerOpen = ref(false)
const isTemplateSaveOpen = ref(false)
const isSummaryOpen = ref(false)
const isMarksOpen = ref(false)
const editingPaper = ref(null)
const editingTemplateSettings = ref(null)
const savingTemplateTarget = ref(null)
const selectedPaperForSets = ref(null)
const selectedSetForPreview = ref(null)
const assessmentSummary = ref(null)
const assessmentMarks = ref(null)
const summaryLoading = ref(false)
const marksLoading = ref(false)
const paperEditorRef = ref(null)
const setDocumentHtml = ref({})
const hydratingForm = ref(false)

const paperTitle = ref('')
const paperDescription = ref('')
const paperClassGrade = ref('')
const paperSubClass = ref('')
const paperSubjectId = ref('')
const paperChapterId = ref('')
const paperConceptId = ref('')
const paperExamNature = ref('ON_DEMAND')
const paperExamDate = ref('')
const paperCodeNo = ref('')
const paperTimingText = ref('')
const paperTotalMarks = ref('')
const paperDurationMinutes = ref('')
const paperDifficultyLevel = ref('MEDIUM')
const paperStatus = ref('DRAFT')
const paperInstructions = ref('')
const selectedTemplateId = ref('')
const previousTemplateId = ref('')
const paperDefaultGenerationMode = ref('RANDOM')
const paperDefaultSetCount = ref(2)
const paperDefaultQuestionBankIds = ref([])
const paperDefaultReplaceExistingSets = ref(true)
const paperDefaultDifficultyCounts = ref({
  EASY: 1,
  MEDIUM: 1,
  HARD: 1,
})
const paperDefaultMarksByDifficulty = ref({
  EASY: 1,
  MEDIUM: 1,
  HARD: 1,
})

const templateName = ref('')
const templateDescription = ref('')
const templateIsGlobal = ref(true)
const templateStatus = ref('ACTIVE')

const generationMode = ref('RANDOM')
const setCount = ref(2)
const selectedQuestionBankIds = ref([])
const selectedManualQuestionIds = ref([])
const replaceExistingSets = ref(true)
const difficultyCounts = ref({
  EASY: 1,
  MEDIUM: 1,
  HARD: 1,
})
const marksByDifficulty = ref({
  EASY: 1,
  MEDIUM: 1,
  HARD: 1,
})

const editorFontFamilies = ['Calibri', 'Arial', 'Times New Roman', 'Georgia']
const editorFormats = [
  { value: 'P', label: 'Normal' },
  { value: 'H1', label: 'Heading 1' },
  { value: 'H2', label: 'Heading 2' },
]

const statusOptions = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SAVED', label: 'Saved' },
  { value: 'QUESTIONS_GENERATED', label: 'Questions Generated' },
  { value: 'POSTED', label: 'Posted' },
  { value: 'ARCHIVED', label: 'Archived' },
]

const templateStatusOptions = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ARCHIVED', label: 'Archived' },
]

const examNatureOptions = [
  { value: 'ON_DEMAND', label: 'On Demand' },
  { value: 'PUBLIC_EXAMINATION', label: 'Public Examinations' },
]

const difficultyOptions = [
  { value: 'EASY', label: 'Easy' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HARD', label: 'Hard' },
]

const baseDifficultyCounts = () => ({
  EASY: 1,
  MEDIUM: 1,
  HARD: 1,
})

const baseMarksByDifficulty = () => ({
  EASY: 1,
  MEDIUM: 1,
  HARD: 1,
})

const normalizeDifficultyMap = (value, fallbackFactory) => {
  const fallback = fallbackFactory()
  return difficultyOptions.reduce((result, difficulty) => {
    const rawValue = value?.[difficulty.value]
    result[difficulty.value] = Number.isFinite(parseInt(rawValue))
      ? parseInt(rawValue)
      : fallback[difficulty.value]
    return result
  }, {})
}

const normalizeIdArray = (value) => {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((id) => parseInt(id)).filter((id) => Number.isInteger(id) && id > 0))]
}

const activeAssessmentTemplates = computed(() =>
  assessmentTemplates.value.filter((template) => template.status === 'ACTIVE'),
)

const selectedTemplateName = computed(() => {
  const template = assessmentTemplates.value.find((item) => item.id === parseInt(selectedTemplateId.value))
  return template?.name || ''
})

const formChaptersList = computed(() => {
  if (!paperSubjectId.value) return []
  const subject = subjects.value.find((item) => item.id === parseInt(paperSubjectId.value))
  return subject?.chapters || []
})

const formConceptsList = computed(() => {
  if (!paperChapterId.value) return []
  const chapter = formChaptersList.value.find((item) => item.id === parseInt(paperChapterId.value))
  return chapter?.concepts || []
})

const selectedBankQuestions = computed(() => {
  const questionMap = new Map()

  selectedQuestionBankIds.value.forEach((bankId) => {
    const detail = bankDetails.value[bankId]
    if (!detail) return

    ;(detail.bankQuestions || []).forEach((bankQuestion) => {
      const question = bankQuestion.question
      if (!question || questionMap.has(question.id)) return

      questionMap.set(question.id, {
        ...question,
        sourceBankName: detail.name,
        bankSortOrder: bankQuestion.sortOrder,
      })
    })
  })

  return Array.from(questionMap.values())
})

const availableDifficultyCounts = computed(() => {
  return selectedBankQuestions.value.reduce(
    (summary, question) => {
      const difficulty = question.difficulty || 'MEDIUM'
      summary[difficulty] += 1
      return summary
    },
    { EASY: 0, MEDIUM: 0, HARD: 0 },
  )
})

const requestedQuestionsPerSet = computed(() => {
  return difficultyOptions.reduce((sum, difficulty) => {
    return sum + (parseInt(difficultyCounts.value[difficulty.value]) || 0)
  }, 0)
})

const computedMarksPerSet = computed(() => {
  return difficultyOptions.reduce((sum, difficulty) => {
    const count = parseInt(difficultyCounts.value[difficulty.value]) || 0
    const marks = parseInt(marksByDifficulty.value[difficulty.value]) || 0
    return sum + count * marks
  }, 0)
})

const totalQuestionsNeeded = computed(() => {
  return requestedQuestionsPerSet.value * (parseInt(setCount.value) || 0)
})

const selectedManualDifficultyCounts = computed(() => {
  const selected = new Set(selectedManualQuestionIds.value.map((id) => parseInt(id)))
  return selectedBankQuestions.value.reduce(
    (summary, question) => {
      if (selected.has(question.id)) {
        summary[question.difficulty || 'MEDIUM'] += 1
      }
      return summary
    },
    { EASY: 0, MEDIUM: 0, HARD: 0 },
  )
})

const activePoolDifficultyCounts = computed(() => {
  return generationMode.value === 'MANUAL'
    ? selectedManualDifficultyCounts.value
    : availableDifficultyCounts.value
})

const canGenerateSets = computed(() => {
  if (!selectedPaperForSets.value) return false
  if (!canGenerateForPaper(selectedPaperForSets.value)) return false
  if (selectedQuestionBankIds.value.length === 0) return false
  if (requestedQuestionsPerSet.value <= 0) return false
  if (generationMode.value === 'MANUAL' && selectedManualQuestionIds.value.length === 0) return false

  return difficultyOptions.every((difficulty) => {
    const required = (parseInt(difficultyCounts.value[difficulty.value]) || 0) * (parseInt(setCount.value) || 0)
    return activePoolDifficultyCounts.value[difficulty.value] >= required
  })
})

const publishMetadataRequired = computed(() => normalizeLifecycleStatus(paperStatus.value) === 'POSTED')

watch(paperClassGrade, () => {
  if (hydratingForm.value) return
  paperSubjectId.value = ''
  paperChapterId.value = ''
  paperConceptId.value = ''
})

watch(paperSubjectId, () => {
  if (hydratingForm.value) return
  paperChapterId.value = ''
  paperConceptId.value = ''
})

watch(paperChapterId, () => {
  if (hydratingForm.value) return
  paperConceptId.value = ''
})

watch(filterClassGrade, () => {
  filterSubjectId.value = ''
})

watch(filterSubjectId, () => {
  fetchTestPapers(1)
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
    subjectsError.value = err.response?.data?.error || 'Failed to load subjects.'
    notificationStore.error(err.response?.data?.error || 'Failed to load subjects.')
  } finally {
    subjectsLoading.value = false
  }
}

const fetchQuestionBanks = async () => {
  loadingBanks.value = true
  try {
    const response = await api.get('/question-banks')
    questionBanks.value = response.data || []
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load question banks.')
  } finally {
    loadingBanks.value = false
  }
}

const fetchAssessmentTemplates = async (includeArchived = canManageTemplates.value) => {
  loadingTemplates.value = true
  try {
    const params = includeArchived ? { includeArchived: true } : {}
    const response = await api.get('/assessment-templates', { params })
    assessmentTemplates.value = response.data || []
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load assessment templates.')
  } finally {
    loadingTemplates.value = false
  }
}

const fetchBankDetail = async (bankId) => {
  if (bankDetails.value[bankId]) return

  const response = await api.get(`/question-banks/${bankId}`)
  bankDetails.value = {
    ...bankDetails.value,
    [bankId]: response.data,
  }
}

const loadSelectedBankDetails = async () => {
  try {
    await Promise.all(selectedQuestionBankIds.value.map((bankId) => fetchBankDetail(bankId)))
    const availableIds = new Set(selectedBankQuestions.value.map((question) => question.id))
    selectedManualQuestionIds.value = selectedManualQuestionIds.value.filter((id) =>
      availableIds.has(parseInt(id)),
    )
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load bank questions.')
  }
}

const fetchTestPapers = async (page = pagination.value.page) => {
  loading.value = true
  try {
    const params = {
      page,
      pageSize: pagination.value.pageSize,
    }
    if (filterSearch.value.trim()) params.search = filterSearch.value.trim()
    if (filterClassGrade.value.trim()) params.classGrade = filterClassGrade.value.trim()
    if (filterSubjectId.value) params.subjectId = filterSubjectId.value
    if (filterStatus.value) params.status = filterStatus.value

    const response = await api.get('/test-papers', { params })
    const unpacked = unpackPaginated(response.data, {
      ...pagination.value,
      page,
    })
    testPapers.value = unpacked.rows
    pagination.value = unpacked.pagination
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load test papers.')
  } finally {
    loading.value = false
  }
}

const clearFilters = async () => {
  filterSearch.value = ''
  filterClassGrade.value = ''
  filterSubjectId.value = ''
  filterStatus.value = ''
  await fetchTestPapers(1)
}

const resetForm = () => {
  editingPaper.value = null
  editingTemplateSettings.value = null
  paperTitle.value = ''
  paperDescription.value = ''
  paperClassGrade.value = ''
  paperSubClass.value = ''
  paperSubjectId.value = ''
  paperChapterId.value = ''
  paperConceptId.value = ''
  paperExamNature.value = 'ON_DEMAND'
  paperExamDate.value = ''
  paperCodeNo.value = ''
  paperTimingText.value = ''
  paperTotalMarks.value = ''
  paperDurationMinutes.value = ''
  paperDifficultyLevel.value = 'MEDIUM'
  paperStatus.value = 'DRAFT'
  paperInstructions.value = ''
  selectedTemplateId.value = ''
  previousTemplateId.value = ''
  paperDefaultGenerationMode.value = 'RANDOM'
  paperDefaultSetCount.value = 2
  paperDefaultQuestionBankIds.value = []
  paperDefaultReplaceExistingSets.value = true
  paperDefaultDifficultyCounts.value = baseDifficultyCounts()
  paperDefaultMarksByDifficulty.value = baseMarksByDifficulty()
}

const openCreatePaper = () => {
  resetForm()
  isModalOpen.value = true
}

const openEditPaper = async (paper) => {
  hydratingForm.value = true
  editingPaper.value = paper
  paperTitle.value = paper.title || ''
  paperDescription.value = paper.description || ''
  paperClassGrade.value = paper.classGrade || ''
  paperSubClass.value = paper.subClass || ''
  paperSubjectId.value = paper.subjectId ? String(paper.subjectId) : ''
  paperChapterId.value = paper.chapterId ? String(paper.chapterId) : ''
  paperConceptId.value = paper.conceptId ? String(paper.conceptId) : ''
  paperExamNature.value = paper.examNature || 'ON_DEMAND'
  paperExamDate.value = toDateInputValue(paper.examDate)
  paperCodeNo.value = paper.codeNo || ''
  paperTimingText.value = paper.timingText || ''
  paperTotalMarks.value = paper.totalMarks || ''
  paperDurationMinutes.value = paper.durationMinutes || ''
  paperDifficultyLevel.value = paper.difficultyLevel || 'MEDIUM'
  paperStatus.value = normalizeLifecycleStatus(paper.status)
  paperInstructions.value = paper.instructions || ''
  selectedTemplateId.value = paper.templateId ? String(paper.templateId) : ''
  previousTemplateId.value = selectedTemplateId.value
  paperDefaultGenerationMode.value = paper.defaultGenerationMode || 'RANDOM'
  paperDefaultSetCount.value = paper.defaultSetCount || 2
  paperDefaultQuestionBankIds.value = normalizeIdArray(paper.defaultQuestionBankIds)
  paperDefaultReplaceExistingSets.value = paper.defaultReplaceExistingSets !== false
  paperDefaultDifficultyCounts.value = normalizeDifficultyMap(
    paper.defaultDifficultyCounts,
    baseDifficultyCounts,
  )
  paperDefaultMarksByDifficulty.value = normalizeDifficultyMap(
    paper.defaultMarksByDifficulty,
    baseMarksByDifficulty,
  )
  isModalOpen.value = true
  await nextTick()
  hydratingForm.value = false
}

const closeModal = () => {
  if (saving.value) return
  isModalOpen.value = false
  resetForm()
}

const saveStatusForPayload = () => {
  if (normalizeLifecycleStatus(paperStatus.value) === 'POSTED') return 'POSTED'
  return 'SAVED'
}

const buildPayload = () => ({
  title: paperTitle.value,
  description: paperDescription.value,
  templateId: selectedTemplateId.value || null,
  classGrade: paperClassGrade.value,
  subClass: paperSubClass.value,
  subjectId: paperSubjectId.value,
  chapterId: paperChapterId.value || null,
  conceptId: paperConceptId.value || null,
  examNature: paperExamNature.value,
  examDate: paperExamDate.value || null,
  codeNo: paperCodeNo.value,
  timingText: paperTimingText.value,
  totalMarks: paperTotalMarks.value,
  durationMinutes: paperDurationMinutes.value,
  difficultyLevel: paperDifficultyLevel.value,
  status: saveStatusForPayload(),
  instructions: paperInstructions.value,
  defaultGenerationMode: paperDefaultGenerationMode.value,
  defaultSetCount: paperDefaultSetCount.value,
  defaultDifficultyCounts: paperDefaultDifficultyCounts.value,
  defaultMarksByDifficulty: paperDefaultMarksByDifficulty.value,
  defaultQuestionBankIds: paperDefaultQuestionBankIds.value,
  defaultReplaceExistingSets: paperDefaultReplaceExistingSets.value,
})

const hasManualAssessmentValues = () => {
  return Boolean(
    paperTitle.value.trim() ||
      paperDescription.value.trim() ||
      paperClassGrade.value.trim() ||
      paperSubClass.value.trim() ||
      paperSubjectId.value ||
      paperChapterId.value ||
      paperConceptId.value ||
      paperExamDate.value ||
      paperCodeNo.value.trim() ||
      paperTimingText.value.trim() ||
      paperTotalMarks.value ||
      paperDurationMinutes.value ||
      paperInstructions.value.trim() ||
      paperDifficultyLevel.value !== 'MEDIUM' ||
      paperExamNature.value !== 'ON_DEMAND' ||
      paperDefaultGenerationMode.value !== 'RANDOM' ||
      paperDefaultSetCount.value !== 2 ||
      paperDefaultQuestionBankIds.value.length > 0 ||
      paperDefaultReplaceExistingSets.value !== true ||
      JSON.stringify(paperDefaultDifficultyCounts.value) !== JSON.stringify(baseDifficultyCounts()) ||
      JSON.stringify(paperDefaultMarksByDifficulty.value) !== JSON.stringify(baseMarksByDifficulty()),
  )
}

const applyTemplateToForm = (template) => {
  if (!template) return

  selectedTemplateId.value = String(template.id)
  previousTemplateId.value = selectedTemplateId.value
  paperClassGrade.value = template.classGrade || ''
  paperSubClass.value = template.subClass || ''
  paperSubjectId.value = template.subjectId ? String(template.subjectId) : ''
  paperChapterId.value = template.chapterId ? String(template.chapterId) : ''
  paperConceptId.value = template.conceptId ? String(template.conceptId) : ''
  paperExamNature.value = template.examNature || 'ON_DEMAND'
  paperTimingText.value = template.timingText || ''
  paperTotalMarks.value = template.totalMarks || ''
  paperDurationMinutes.value = template.durationMinutes || ''
  paperDifficultyLevel.value = template.difficultyLevel || 'MEDIUM'
  paperInstructions.value = template.instructions || ''
  paperDefaultGenerationMode.value = template.defaultGenerationMode || 'RANDOM'
  paperDefaultSetCount.value = template.defaultSetCount || 2
  paperDefaultQuestionBankIds.value = normalizeIdArray(template.defaultQuestionBankIds)
  paperDefaultReplaceExistingSets.value = template.defaultReplaceExistingSets !== false
  paperDefaultDifficultyCounts.value = normalizeDifficultyMap(
    template.defaultDifficultyCounts,
    baseDifficultyCounts,
  )
  paperDefaultMarksByDifficulty.value = normalizeDifficultyMap(
    template.defaultMarksByDifficulty,
    baseMarksByDifficulty,
  )
}

const handleTemplateSelection = async () => {
  if (!selectedTemplateId.value) {
    previousTemplateId.value = ''
    return
  }

  const template = assessmentTemplates.value.find((item) => item.id === parseInt(selectedTemplateId.value))
  if (!template) return

  const shouldConfirm = hasManualAssessmentValues() && selectedTemplateId.value !== previousTemplateId.value
  if (shouldConfirm) {
    const ok = await confirmationStore.ask({
      title: 'Apply Template',
      message: `Apply "${template.name}"? Current assessment settings will be replaced with this template.`,
      confirmText: 'Apply Template',
      isDanger: false,
    })

    if (!ok) {
      selectedTemplateId.value = previousTemplateId.value
      return
    }
  }

  hydratingForm.value = true
  applyTemplateToForm(template)
  await nextTick()
  hydratingForm.value = false
  notificationStore.success(`Template "${template.name}" applied.`)
}

const handleSavePaper = async () => {
  const payload = buildPayload()
  if (editingPaper.value && isPostedStatus(editingPaper.value.status)) {
    const ok = await confirmationStore.ask({
      title: 'Update Posted Assessment',
      message: `This assessment is already posted. Saving will update locked exam settings for "${editingPaper.value.title}". Continue?`,
      confirmText: 'Save Changes',
      isDanger: false,
    })

    if (!ok) return
    payload.confirmPostedChanges = true
  }

  saving.value = true
  try {
    if (editingPaper.value) {
      await api.put(`/test-papers/${editingPaper.value.id}`, payload)
      notificationStore.success('Assessment saved successfully.')
    } else {
      await api.post('/test-papers', payload)
      notificationStore.success('Assessment saved successfully.')
    }

    isModalOpen.value = false
    resetForm()
    await fetchTestPapers()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to save assessment.')
  } finally {
    saving.value = false
  }
}

const buildTemplatePayloadFromCurrentSettings = () => ({
  name: templateName.value,
  description: templateDescription.value,
  isGlobal: templateIsGlobal.value,
  status: templateStatus.value,
  classGrade: paperClassGrade.value,
  subClass: paperSubClass.value,
  subjectId: paperSubjectId.value || null,
  chapterId: paperChapterId.value || null,
  conceptId: paperConceptId.value || null,
  examNature: paperExamNature.value,
  timingText: paperTimingText.value,
  totalMarks: paperTotalMarks.value || null,
  durationMinutes: paperDurationMinutes.value || null,
  difficultyLevel: paperDifficultyLevel.value,
  instructions: paperInstructions.value,
  defaultGenerationMode: paperDefaultGenerationMode.value,
  defaultSetCount: paperDefaultSetCount.value,
  defaultDifficultyCounts: paperDefaultDifficultyCounts.value,
  defaultMarksByDifficulty: paperDefaultMarksByDifficulty.value,
  defaultQuestionBankIds: paperDefaultQuestionBankIds.value,
  defaultReplaceExistingSets: paperDefaultReplaceExistingSets.value,
})

const openSaveTemplateModal = (template = null) => {
  if (!canManageTemplates.value) return

  savingTemplateTarget.value = template
  templateName.value = template?.name || selectedTemplateName.value || paperTitle.value || ''
  templateDescription.value = template?.description || ''
  templateIsGlobal.value = template?.isGlobal !== false
  templateStatus.value = template?.status || 'ACTIVE'
  isTemplateSaveOpen.value = true
}

const closeTemplateSaveModal = (force = false) => {
  if (savingTemplate.value && !force) return
  isTemplateSaveOpen.value = false
  savingTemplateTarget.value = null
  templateName.value = ''
  templateDescription.value = ''
  templateIsGlobal.value = true
  templateStatus.value = 'ACTIVE'
}

const handleSaveTemplate = async () => {
  savingTemplate.value = true
  try {
    const payload = buildTemplatePayloadFromCurrentSettings()
    let savedTemplate

    if (savingTemplateTarget.value) {
      const response = await api.put(`/assessment-templates/${savingTemplateTarget.value.id}`, payload)
      savedTemplate = response.data.template
      notificationStore.success('Test settings template updated successfully.')
    } else {
      const response = await api.post('/assessment-templates', payload)
      savedTemplate = response.data.template
      notificationStore.success('Test settings template saved successfully.')
    }

    await fetchAssessmentTemplates(true)
    if (savedTemplate?.id) {
      selectedTemplateId.value = String(savedTemplate.id)
      previousTemplateId.value = selectedTemplateId.value
      editingTemplateSettings.value = savingTemplateTarget.value ? savedTemplate : editingTemplateSettings.value
    }
    closeTemplateSaveModal(true)
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to save assessment template.')
  } finally {
    savingTemplate.value = false
  }
}

const openTemplateManager = async () => {
  if (!canManageTemplates.value) return
  isTemplateManagerOpen.value = true
  await fetchAssessmentTemplates(true)
}

const closeTemplateManager = () => {
  isTemplateManagerOpen.value = false
}

const editTemplateSettings = async (template) => {
  closeTemplateManager()
  resetForm()
  isModalOpen.value = true
  hydratingForm.value = true
  editingTemplateSettings.value = template
  applyTemplateToForm(template)
  await nextTick()
  hydratingForm.value = false
}

const archiveTemplate = async (template) => {
  const ok = await confirmationStore.ask({
    title: 'Archive Template',
    message: `Archive "${template.name}"? It will be hidden from the create-assessment dropdown.`,
    confirmText: 'Archive',
    isDanger: false,
  })

  if (!ok) return

  try {
    await api.patch(`/assessment-templates/${template.id}/archive`)
    notificationStore.success('Template archived.')
    await fetchAssessmentTemplates(true)
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to archive template.')
  }
}

const restoreTemplate = async (template) => {
  try {
    await api.patch(`/assessment-templates/${template.id}/restore`)
    notificationStore.success('Template restored.')
    await fetchAssessmentTemplates(true)
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to restore template.')
  }
}

const handlePostAssessment = async (paper) => {
  if (!canPostPaper(paper)) {
    notificationStore.warning(postActionTitle(paper))
    return
  }

  const ok = await confirmationStore.ask({
    title: 'Post Assessment',
    message: `Post "${paper.title}"? Critical exam settings and generated question sets will be locked after posting.`,
    confirmText: 'Post Assessment',
    isDanger: false,
  })

  if (!ok) return

  try {
    await api.patch(`/test-papers/${paper.id}/status`, { status: 'POSTED' })
    notificationStore.success('Assessment posted successfully.')
    await fetchTestPapers()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to post assessment.')
  }
}

const handleDeletePaper = async (paper) => {
  const ok = await confirmationStore.ask({
    title: 'Delete Assessment',
    message: `Delete "${paper.title}" permanently? This action cannot be undone.`,
    confirmText: 'Delete',
    isDanger: true,
  })

  if (!ok) return

  try {
    await api.delete(`/test-papers/${paper.id}`)
    notificationStore.success('Assessment deleted successfully.')
    await fetchTestPapers()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to delete assessment.')
  }
}

const resetSetGenerationForm = (paper = null) => {
  generationMode.value = paper?.defaultGenerationMode || 'RANDOM'
  setCount.value = paper?.defaultSetCount || 2
  selectedQuestionBankIds.value = normalizeIdArray(paper?.defaultQuestionBankIds)
  selectedManualQuestionIds.value = []
  replaceExistingSets.value = paper?.defaultReplaceExistingSets !== false
  difficultyCounts.value = normalizeDifficultyMap(paper?.defaultDifficultyCounts, baseDifficultyCounts)
  marksByDifficulty.value = normalizeDifficultyMap(paper?.defaultMarksByDifficulty, baseMarksByDifficulty)
}

const fetchPaperDetail = async (paperId) => {
  const response = await api.get(`/test-papers/${paperId}`)
  return response.data
}

const openAssessmentSummary = async (paper) => {
  isSummaryOpen.value = true
  summaryLoading.value = true
  assessmentSummary.value = null

  try {
    const response = await api.get(`/test-papers/${paper.id}/summary`)
    assessmentSummary.value = response.data
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load assessment summary.')
    isSummaryOpen.value = false
  } finally {
    summaryLoading.value = false
  }
}

const closeAssessmentSummary = () => {
  isSummaryOpen.value = false
  assessmentSummary.value = null
}

const openAssessmentMarks = async (paper) => {
  isMarksOpen.value = true
  marksLoading.value = true
  assessmentMarks.value = null

  try {
    const response = await api.get(`/test-papers/${paper.id}/marks`)
    assessmentMarks.value = response.data
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load marks distribution.')
    isMarksOpen.value = false
  } finally {
    marksLoading.value = false
  }
}

const closeAssessmentMarks = () => {
  isMarksOpen.value = false
  assessmentMarks.value = null
}

const openGenerateSets = async (paper) => {
  resetSetGenerationForm()
  isSetModalOpen.value = true

  try {
    selectedPaperForSets.value = await fetchPaperDetail(paper.id)
    resetSetGenerationForm(selectedPaperForSets.value)
    if (questionBanks.value.length === 0) {
      await fetchQuestionBanks()
    }
  } catch (err) {
    isSetModalOpen.value = false
    notificationStore.error(err.response?.data?.error || 'Failed to open set generator.')
  }
}

const closeSetModal = () => {
  if (generating.value) return
  if (isSetPreviewOpen.value) closeSetPreview()
  isSetModalOpen.value = false
  selectedPaperForSets.value = null
  resetSetGenerationForm()
}

const handleGenerateSets = async () => {
  if (!canGenerateSets.value) {
    if (selectedPaperForSets.value && !canGenerateForPaper(selectedPaperForSets.value)) {
      notificationStore.warning(generateActionTitle(selectedPaperForSets.value))
      return
    }
    notificationStore.warning('Adjust the question banks, counts, or manual selection before generating questions.')
    return
  }

  generating.value = true
  try {
    const response = await api.post(`/test-papers/${selectedPaperForSets.value.id}/sets/generate`, {
      mode: generationMode.value,
      setCount: setCount.value,
      questionBankIds: selectedQuestionBankIds.value,
      selectedQuestionIds: generationMode.value === 'MANUAL' ? selectedManualQuestionIds.value : [],
      difficultyCounts: difficultyCounts.value,
      marksByDifficulty: marksByDifficulty.value,
      replaceExisting: replaceExistingSets.value,
    })

    selectedPaperForSets.value = response.data.testPaper
    setDocumentHtml.value = {}
    notificationStore.success('Questions generated successfully.')
    await fetchTestPapers()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to generate question paper sets.')
  } finally {
    generating.value = false
  }
}

const handleDeleteSet = async (setItem) => {
  const ok = await confirmationStore.ask({
    title: 'Delete Question Set',
    message: `Delete Set ${setItem.label}? Its selected questions will be removed from this assessment.`,
    confirmText: 'Delete Set',
    isDanger: true,
  })

  if (!ok) return

  try {
    await api.delete(`/test-papers/${selectedPaperForSets.value.id}/sets/${setItem.id}`)
    const { [setItem.id]: _removed, ...remainingDocuments } = setDocumentHtml.value
    setDocumentHtml.value = remainingDocuments
    selectedPaperForSets.value = await fetchPaperDetail(selectedPaperForSets.value.id)
    notificationStore.success('Question paper set deleted successfully.')
    await fetchTestPapers()
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to delete question paper set.')
  }
}

const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const paragraphsFromText = (value) => {
  const text = String(value || '').trim()
  if (!text) return ''

  return text
    .split(/\n+/)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

const answerLabel = (index) => String.fromCharCode(65 + index)

const firstSetQuestion = (setItem) => {
  return (setItem.questions || []).find((link) => link.question)?.question || null
}

const previewSubjectName = (paper, setItem) => {
  const firstQuestion = firstSetQuestion(setItem)
  return (
    paper?.subject?.name ||
    firstQuestion?.concept?.chapter?.subject?.name ||
    paper?.title ||
    'Question Paper'
  )
}

const previewCodeNo = (paper, setItem) => {
  if (paper?.codeNo) return paper.codeNo

  const paperId = String(paper?.id || '').padStart(4, '0')
  const setId = String(setItem?.id || '').padStart(4, '0')
  return `${paperId}${setId}`
}

const previewTimingText = (paper) => {
  return paper?.timingText || formatMinutes(paper?.durationMinutes)
}

const examDateForPaper = (paper) => {
  return paper?.examDate ? formatDateOnly(paper.examDate) : '______________________'
}

const buildInstructionHtml = (paper) => {
  if (paper?.instructions) {
    return paragraphsFromText(paper.instructions)
  }

  return `
    <ol>
      <li>Candidate must write his/her Roll Number on the first page of the Question Paper.</li>
      <li>Please check the Question Paper to verify that the total pages and total number of questions are correct.</li>
      <li>All questions are compulsory unless mentioned otherwise.</li>
      <li>Marks for each question are shown against the question.</li>
    </ol>
  `
}

const buildQuestionHtml = (link, index) => {
  const question = link.question || {}
  const answers = question.answers || []
  const answerHtml = answers.length
    ? `
      <ol class="paper-answer-options" type="A">
        ${answers
          .map((answer, answerIndex) => `<li><span>${answerLabel(answerIndex)}.</span> ${escapeHtml(answer.content)}</li>`)
          .join('')}
      </ol>
    `
    : ''

  return `
    <li>
      <div class="paper-question-row">
        <div class="paper-question-text">${escapeHtml(question.content || `Question ${index + 1}`)}</div>
        <strong class="paper-marks">[${link.marks || 0}]</strong>
      </div>
      ${answerHtml}
    </li>
  `
}

const sectionNameForLink = (link) => {
  return (
    link.sectionName ||
    link.generationSnapshot?.sectionName ||
    link.question?.sectionName ||
    'Questions'
  )
}

const sectionOrderForLink = (link) => {
  return (
    parseInt(link.sectionOrder) ||
    parseInt(link.generationSnapshot?.sectionOrder) ||
    parseInt(link.question?.sectionOrder) ||
    999
  )
}

const displayOrderForLink = (link, fallbackIndex = 0) => {
  return (
    parseInt(link.displayOrder) ||
    parseInt(link.sectionDisplayOrder) ||
    fallbackIndex + 1
  )
}

const groupQuestionsBySection = (questions = []) => {
  const groups = new Map()

  questions.forEach((link, index) => {
    const sectionName = sectionNameForLink(link)
    const sectionOrder = sectionOrderForLink(link)
    const groupKey = `${sectionOrder}-${sectionName}`
    const group = groups.get(groupKey) || {
      sectionName,
      sectionOrder,
      questions: [],
    }

    group.questions.push({
      ...link,
      resolvedDisplayOrder: displayOrderForLink(link, index),
    })
    groups.set(groupKey, group)
  })

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      questions: group.questions.sort((left, right) =>
        (left.resolvedDisplayOrder || 0) - (right.resolvedDisplayOrder || 0)
      ),
    }))
    .sort((left, right) =>
      (left.sectionOrder || 999) - (right.sectionOrder || 999) ||
      left.sectionName.localeCompare(right.sectionName)
    )
}

const buildSectionedQuestionsHtml = (questions = []) => {
  const sectionGroups = groupQuestionsBySection(questions)

  if (sectionGroups.length === 0) {
    return '<p>No questions generated yet.</p>'
  }

  return sectionGroups
    .map((group) => {
      const startAt = group.questions[0]?.resolvedDisplayOrder || 1

      return `
        <section class="paper-question-section">
          <h4 class="paper-section-heading">${escapeHtml(group.sectionName)}</h4>
          <ol class="paper-question-list" start="${startAt}">
            ${group.questions.map((link, index) => buildQuestionHtml(link, index)).join('')}
          </ol>
        </section>
      `
    })
    .join('')
}

const buildDefaultSetDocument = (setItem) => {
  const paper = selectedPaperForSets.value || {}
  const questions = setItem.questions || []
  const subjectName = previewSubjectName(paper, setItem)
  const paperTitleText = paper.title || 'Question Paper'
  const subClassHtml = paper.subClass
    ? `<p><strong>Sub-class:</strong> ${escapeHtml(paper.subClass)}</p>`
    : ''

  return `
    <section class="question-paper-document">
      <p>This question paper consists of <strong>${questions.length || setItem.questionCount || 0} questions</strong> and <strong>____ printed pages</strong>.</p>

      <div class="paper-topline">
        <strong>Roll No. ________________</strong>
        <strong>Code No. ${previewCodeNo(paper, setItem)} SET - [ ${escapeHtml(setItem.label)} ]</strong>
      </div>

      <h2>${escapeHtml(subjectName).toUpperCase()}</h2>
      <h3>${escapeHtml(paperTitleText)}</h3>

      <div class="paper-meta-grid">
        <p><strong>Class:</strong> ${escapeHtml(paper.classGrade || '-')}</p>
        ${subClassHtml}
        <p><strong>Exam Nature:</strong> ${escapeHtml(examNatureLabel(paper.examNature))}</p>
        <p><strong>Exam Date:</strong> ${escapeHtml(examDateForPaper(paper))}</p>
        <p><strong>Timing:</strong> ${escapeHtml(previewTimingText(paper))}</p>
        <p><strong>Maximum Marks:</strong> ${escapeHtml(paper.totalMarks || setItem.totalMarks || '-')}</p>
      </div>

      <p><strong>Day and Date of Examination ${escapeHtml(examDateForPaper(paper))}</strong></p>
      <p><strong>Signature of Invigilators 1. ________________ 2. ________________</strong></p>

      <h4>General Instructions:</h4>
      <div class="paper-instructions">
        ${buildInstructionHtml(paper)}
      </div>

      ${buildSectionedQuestionsHtml(questions)}
    </section>
  `
}

const getSetDocumentHtml = (setItem) => {
  return setDocumentHtml.value[setItem.id] || buildDefaultSetDocument(setItem)
}

const persistEditorContent = () => {
  if (!selectedSetForPreview.value || !paperEditorRef.value) return

  setDocumentHtml.value = {
    ...setDocumentHtml.value,
    [selectedSetForPreview.value.id]: paperEditorRef.value.innerHTML,
  }
}

const openSetPreview = async (setItem) => {
  selectedSetForPreview.value = setItem
  if (!setDocumentHtml.value[setItem.id]) {
    setDocumentHtml.value = {
      ...setDocumentHtml.value,
      [setItem.id]: buildDefaultSetDocument(setItem),
    }
  }

  isSetPreviewOpen.value = true
  await nextTick()

  if (paperEditorRef.value) {
    paperEditorRef.value.innerHTML = getSetDocumentHtml(setItem)
    paperEditorRef.value.focus()
  }
}

const closeSetPreview = () => {
  persistEditorContent()
  isSetPreviewOpen.value = false
  selectedSetForPreview.value = null
}

const runEditorCommand = (command, value = null) => {
  if (!paperEditorRef.value) return
  paperEditorRef.value.focus()
  document.execCommand(command, false, value)
  persistEditorContent()
}

const applyEditorFormat = (event) => {
  runEditorCommand('formatBlock', event.target.value)
}

const applyEditorFont = (event) => {
  runEditorCommand('fontName', event.target.value)
}

const insertPageBreak = () => {
  runEditorCommand(
    'insertHTML',
    '<div class="editor-page-break"><span>Page Break</span></div><p><br></p>',
  )
}

const insertSimpleTable = () => {
  runEditorCommand(
    'insertHTML',
    '<table class="paper-editor-table"><tbody><tr><td>Section</td><td>Marks</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>',
  )
}

const fileNameForSet = (setItem) => {
  const paper = selectedPaperForSets.value || {}
  return `${paper.title || 'question-paper'}-set-${setItem.label || 'A'}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const buildPdfExportHtml = (setItem, bodyHtml) => {
  const paper = selectedPaperForSets.value || {}
  const title = `${paper.title || 'Question Paper'} - Set ${setItem.label}`

  return `
    <style>
      .pdf-export-page {
        background: #ffffff;
        color: #0f172a;
        font-family: Calibri, Arial, sans-serif;
        font-size: 12pt;
        line-height: 1.45;
        min-height: 10.69in;
        padding: 0;
        width: 7.57in;
      }
      .pdf-export-page h1,
      .pdf-export-page h2,
      .pdf-export-page h3,
      .pdf-export-page h4 {
        margin: 12pt 0 8pt;
      }
      .pdf-export-page h2,
      .pdf-export-page h3 {
        text-align: center;
      }
      .pdf-export-page .paper-topline,
      .pdf-export-page .paper-meta-grid {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 18pt;
        justify-content: space-between;
      }
      .pdf-export-page .paper-meta-grid {
        border-bottom: 1px solid #cbd5e1;
        border-top: 1px solid #cbd5e1;
        margin: 12pt 0;
        padding: 8pt 0;
      }
      .pdf-export-page .paper-question-section {
        margin-top: 16pt;
      }
      .pdf-export-page .paper-section-heading {
        font-size: 12pt;
        font-weight: 700;
        margin: 16pt 0 10pt;
        text-align: center;
        text-transform: uppercase;
      }
      .pdf-export-page .paper-question-list > li {
        margin-bottom: 12pt;
      }
      .pdf-export-page .paper-question-row {
        align-items: flex-start;
        display: flex;
        gap: 12pt;
        justify-content: space-between;
      }
      .pdf-export-page .paper-question-text {
        flex: 1;
      }
      .pdf-export-page .paper-marks {
        white-space: nowrap;
      }
      .pdf-export-page .paper-answer-options {
        list-style: none;
        margin-top: 6pt;
        padding-left: 14pt;
      }
      .pdf-export-page .paper-answer-options li {
        margin-bottom: 4pt;
      }
      .pdf-export-page .paper-editor-table {
        border-collapse: collapse;
        margin: 8pt 0;
        width: 100%;
      }
      .pdf-export-page .paper-editor-table td {
        border: 1px solid #64748b;
        padding: 6pt;
      }
      .pdf-export-page .editor-page-break {
        break-before: page;
        color: #64748b;
        font-size: 10pt;
        page-break-before: always;
        text-align: center;
      }
    </style>
    <div class="pdf-export-page" aria-label="${escapeHtml(title)}">
      ${bodyHtml}
    </div>
  `
}

const downloadSetDocument = async (setItem) => {
  if (!setItem || downloadingSetId.value) return

  if (selectedSetForPreview.value?.id === setItem.id) {
    persistEditorContent()
  }

  downloadingSetId.value = setItem.id

  try {
    const html2pdfModule = await import('html2pdf.js')
    const html2pdf = html2pdfModule.default || html2pdfModule
    const html = getSetDocumentHtml(setItem)
    const exportNode = document.createElement('div')

    exportNode.className = 'pdf-export-root'
    Object.assign(exportNode.style, {
      background: '#ffffff',
      left: '-10000px',
      position: 'fixed',
      top: '0',
      width: '7.57in',
      zIndex: '-1',
    })
    exportNode.innerHTML = buildPdfExportHtml(setItem, html)
    document.body.appendChild(exportNode)

    await html2pdf()
      .set({
        filename: `${fileNameForSet(setItem)}.pdf`,
        margin: [0.35, 0.35, 0.35, 0.35],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          windowWidth: 794,
        },
        jsPDF: {
          unit: 'in',
          format: 'a4',
          orientation: 'portrait',
        },
        pagebreak: {
          mode: ['css', 'legacy'],
          before: '.editor-page-break',
        },
      })
      .from(exportNode.querySelector('.pdf-export-page'))
      .save()

    notificationStore.success(`Set ${setItem.label} PDF downloaded.`)
  } catch (err) {
    notificationStore.error('Failed to download PDF. Please try again.')
  } finally {
    const existingExportNode = document.querySelector('.pdf-export-root')
    if (existingExportNode?.parentNode) {
      existingExportNode.parentNode.removeChild(existingExportNode)
    }
    downloadingSetId.value = null
  }
}

const formatMinutes = (minutes) => {
  if (!minutes) return '-'
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const remaining = minutes % 60
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`
}

const formatDate = (value) => {
  if (!value) return '-'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const formatDateOnly = (value) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'

  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

const toDateInputValue = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const scopeLabel = (paper) => {
  const parts = [paper.subject?.name, paper.chapter?.name, paper.concept?.name].filter(Boolean)
  return parts.length ? parts.join(' / ') : '-'
}

const statusLabel = (status) => {
  const option = statusOptions.find((item) => item.value === normalizeLifecycleStatus(status))
  return option?.label || status
}

const difficultyLabel = (difficulty) => {
  const option = difficultyOptions.find((item) => item.value === difficulty)
  return option?.label || difficulty
}

const examNatureLabel = (examNature) => {
  const option = examNatureOptions.find((item) => item.value === examNature)
  return option?.label || 'Not set'
}

const normalizeLifecycleStatus = (status) => {
  const normalized = String(status || 'DRAFT').trim().toUpperCase()
  return normalized === 'PUBLISHED' ? 'POSTED' : normalized
}

const isPostedStatus = (status) => normalizeLifecycleStatus(status) === 'POSTED'

const canGenerateForPaper = (paper) => {
  const status = normalizeLifecycleStatus(paper?.status)
  return ['SAVED', 'QUESTIONS_GENERATED'].includes(status)
}

const canOpenSetManager = (paper) => {
  return setCountForPaper(paper) > 0 || canGenerateForPaper(paper)
}

const canPostPaper = (paper) => {
  return normalizeLifecycleStatus(paper?.status) === 'QUESTIONS_GENERATED' && setCountForPaper(paper) > 0
}

const generateActionLabel = (paper) => {
  if (setCountForPaper(paper) > 0) return isPostedStatus(paper?.status) ? 'View Sets' : 'Manage Sets'
  return 'Question Sets'
}

const generateActionTitle = (paper) => {
  const status = normalizeLifecycleStatus(paper?.status)
  if (status === 'DRAFT') return 'Save this assessment before managing question sets.'
  if (status === 'POSTED') return 'Posted assessments are locked. Existing sets can be previewed and downloaded.'
  if (status === 'ARCHIVED') return 'Archived assessments cannot manage question sets.'
  return 'Preview and download generated sets. Generate new section-wise sets from Assessment Builder.'
}

const postActionTitle = (paper) => {
  const status = normalizeLifecycleStatus(paper?.status)
  if (status === 'POSTED') return 'This assessment is already posted.'
  if (status === 'DRAFT') return 'Save this assessment before posting.'
  if (status === 'SAVED') return 'Generate questions before posting this assessment.'
  if (setCountForPaper(paper) === 0) return 'Generate at least one question set before posting.'
  return 'Post Assessment'
}

const statusClass = (status) => `status-${normalizeLifecycleStatus(status).toLowerCase()}`

const templateStatusClass = (status) =>
  String(status || '').toUpperCase() === 'ACTIVE' ? 'status-published' : 'status-archived'

const setCountForPaper = (paper) => paper._count?.sets || paper.sets?.length || 0

const questionCountForPaper = (paper) => paper._count?.testPaperQuestions || 0

const questionSnippet = (content) => {
  if (!content) return 'Untitled question'
  return content.length > 120 ? `${content.slice(0, 120)}...` : content
}

const questionScope = (question) => {
  const concept = question.concept
  const parts = [
    concept?.chapter?.subject?.name,
    concept?.chapter?.name,
    concept?.name,
  ].filter(Boolean)
  return parts.length ? parts.join(' / ') : '-'
}

const setDifficultyText = (setItem) => {
  return `Easy ${setItem.easyCount || 0}, Medium ${setItem.mediumCount || 0}, Hard ${setItem.hardCount || 0}`
}

onMounted(async () => {
  await Promise.all([fetchSubjects(), fetchQuestionBanks(), fetchTestPapers(), fetchAssessmentTemplates()])
})

watch(selectedQuestionBankIds, loadSelectedBankDetails, { deep: true })
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <rect x="3" y="3" width="7" height="9" />
            <rect x="14" y="3" width="7" height="5" />
            <rect x="14" y="12" width="7" height="9" />
            <rect x="3" y="16" width="7" height="5" />
          </svg>
          Dashboard
        </router-link>
        <router-link to="/questions" class="nav-item">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          Question Bank
        </router-link>
        <router-link to="/manage-questions" class="nav-item">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
            <path d="M8 11h6" />
          </svg>
          Manage Questions
        </router-link>
        <router-link to="/manage-multi-questions" class="nav-item">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <rect x="4" y="4" width="16" height="5" rx="1" />
            <rect x="4" y="11" width="16" height="9" rx="1" />
            <path d="M8 14h8M8 17h5" />
          </svg>
          Manage Multi Questions
        </router-link>
        <router-link to="/extraction" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/></svg>
          Extraction
        </router-link>
        <router-link
          to="/evaluator-bulk-upload"
          class="nav-item"
          v-if="userRole === 'ADMIN'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M19 8v6" />
            <path d="M22 11h-6" />
          </svg>
          Evaluator Bulk Upload
        </router-link>
        <router-link
          to="/test-papers"
          class="nav-item active"
          v-if="userRole === 'ADMIN' || userRole === 'TEACHER'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Test Papers
        </router-link>
        <router-link to="/assessment-builder" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h3"/></svg>
          Assessment Builder
        </router-link>
        <router-link
          to="/subjects"
          class="nav-item"
          v-if="userRole === 'ADMIN' || userRole === 'TEACHER'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          Subjects & Chapters
        </router-link>
<router-link to="/admin/users" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          User Manager
        </router-link>
<router-link
          to="/reviews"
          class="nav-item"
          v-if="userRole === 'ADMIN' || userRole === 'TEACHER'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Extraction Reviews
        </router-link>
<router-link
          to="/admin/audit-logs"
          class="nav-item"
          v-if="userRole === 'ADMIN'"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="margin-right: 8px"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          Audit Logs
        </router-link>
        <router-link to="/telescope" class="nav-item" v-if="userRole === 'ADMIN'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="12" cy="12" r="3"/><path d="M3 12h6"/><path d="M15 12h6"/><path d="M12 3v6"/><path d="M12 15v6"/></svg>
          Telescope
        </router-link>
</nav>

      <div class="sidebar-footer" v-if="authStore.user">
        <div class="user-profile">
          <div class="user-avatar">
            {{ authStore.user?.name ? authStore.user.name.charAt(0) : 'U' }}
          </div>
          <div class="user-info">
            <span class="user-name" :title="authStore.user?.name">{{
              authStore.user?.name || 'User Name'
            }}</span>
            <span class="user-role badge" :class="`badge-${userRole?.toLowerCase()}`">{{
              userRole || 'TEACHER'
            }}</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" @click="handleLogout" style="width: 100%">
          Sign Out
        </button>
      </div>
    </aside>

    <main class="main-content">
      <header class="header">
        <div>
          <p class="page-kicker">Assessment Module</p>
          <h2 class="page-title">Assessment & Test Papers</h2>
        </div>
        <div class="header-actions">
          <button
            v-if="canManageTemplates"
            class="btn btn-secondary btn-sm"
            type="button"
            style="width: auto"
            @click="openTemplateManager"
          >
            Manage Templates
          </button>
          <button
            v-if="canWrite"
            class="btn btn-primary btn-sm"
            type="button"
            style="width: auto"
            @click="openCreatePaper"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Assessment
          </button>
        </div>
      </header>

      <div class="content-body fade-in-el">
        <section class="section-card filters-card">
          <div class="filters-grid">
            <div class="form-group">
              <label class="form-label" for="paper-search">Search</label>
              <input
                id="paper-search"
                v-model="filterSearch"
                class="form-control"
                type="search"
                placeholder="Title, description, instructions..."
                @keyup.enter="fetchTestPapers(1)"
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="paper-class-filter">Class / Grade</label>
              <input
                id="paper-class-filter"
                v-model="filterClassGrade"
                class="form-control"
                type="text"
                placeholder="Example: Class 10"
                @keyup.enter="fetchTestPapers(1)"
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="paper-subject-filter">Subject</label>
              <select id="paper-subject-filter" v-model="filterSubjectId" class="form-control" :disabled="!filterClassGrade.trim() || subjectsLoading">
                <option value="">
                  {{ !filterClassGrade.trim() ? 'Enter class first' : subjectsLoading ? 'Loading subjects...' : 'All Subjects' }}
                </option>
                <option v-for="subject in subjects" :key="subject.id" :value="subject.id">
                  {{ subject.name }}
                </option>
              </select>
              <span v-if="subjectsError" class="field-help is-error">{{ subjectsError }}</span>
            </div>
            <div class="form-group">
              <label class="form-label" for="paper-status-filter">Status</label>
              <select id="paper-status-filter" v-model="filterStatus" class="form-control" @change="fetchTestPapers(1)">
                <option value="">All Statuses</option>
                <option v-for="status in statusOptions" :key="status.value" :value="status.value">
                  {{ status.label }}
                </option>
              </select>
            </div>
          </div>
          <div class="filter-actions">
            <button class="btn btn-primary btn-sm" type="button" @click="fetchTestPapers(1)">
              Search
            </button>
            <button class="btn btn-secondary btn-sm" type="button" @click="clearFilters">
              Clear
            </button>
          </div>
        </section>

        <section class="section-card table-card">
          <div class="table-heading">
            <div>
              <h3>Assessments</h3>
              <p>{{ pagination.total }} record{{ pagination.total === 1 ? '' : 's' }} found</p>
            </div>
            <button class="btn btn-secondary btn-sm" type="button" @click="fetchTestPapers()">
              Refresh
            </button>
          </div>

          <div v-if="loading" class="spinner-container">
            <div class="spinner"></div>
            <p class="spinner-text">Loading assessments...</p>
          </div>

          <div v-else-if="testPapers.length === 0" class="empty-state">
            <h3>No assessments found</h3>
            <p>Create your first assessment or adjust the filters to find existing papers.</p>
            <button v-if="canWrite" class="btn btn-primary btn-sm" type="button" @click="openCreatePaper">
              Create Assessment
            </button>
          </div>

          <div v-else class="table-scroll">
            <table class="paper-table">
              <thead>
                <tr>
                  <th>Assessment</th>
                  <th>Summary</th>
                  <th>Marks</th>
                  <th>Class</th>
                  <th>Exam</th>
                  <th>Scope</th>
                  <th>Marks / Duration</th>
                  <th>Sets</th>
                  <th>Status</th>
                  <th>Created By</th>
                  <th>Updated</th>
                  <th v-if="canWrite">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="paper in testPapers" :key="paper.id">
                  <td data-label="Assessment">
                    <div class="assessment-title">{{ paper.title }}</div>
                    <div class="assessment-meta">
                      {{ difficultyLabel(paper.difficultyLevel) }}
                      <span v-if="paper._count">- {{ questionCountForPaper(paper) }} questions</span>
                    </div>
                  </td>
                  <td data-label="Summary">
                    <div class="metric-stack">
                      <button class="btn btn-secondary btn-sm table-action-button" type="button" @click="openAssessmentSummary(paper)">
                        Summary
                      </button>
                      <span>{{ setCountForPaper(paper) }} set{{ setCountForPaper(paper) === 1 ? '' : 's' }} · {{ statusLabel(paper.status) }}</span>
                    </div>
                  </td>
                  <td data-label="Marks">
                    <div class="metric-stack">
                      <button class="btn btn-secondary btn-sm table-action-button" type="button" @click="openAssessmentMarks(paper)">
                        Marks
                      </button>
                      <span>{{ paper.totalMarks }} total · {{ questionCountForPaper(paper) }} questions</span>
                    </div>
                  </td>
                  <td data-label="Class">
                    <div class="metric-stack">
                      <strong>{{ paper.classGrade }}</strong>
                      <span v-if="paper.subClass">{{ paper.subClass }}</span>
                    </div>
                  </td>
                  <td data-label="Exam">
                    <div class="exam-meta-stack">
                      <strong>{{ examNatureLabel(paper.examNature) }}</strong>
                      <span v-if="paper.examDate">{{ formatDateOnly(paper.examDate) }}</span>
                      <span v-if="paper.codeNo">Code: {{ paper.codeNo }}</span>
                      <span v-if="paper.timingText">{{ paper.timingText }}</span>
                      <span v-if="!paper.examDate && !paper.codeNo && !paper.timingText">Metadata pending</span>
                    </div>
                  </td>
                  <td data-label="Scope">
                    <span class="scope-text">{{ scopeLabel(paper) }}</span>
                  </td>
                  <td data-label="Marks / Duration">
                    <div class="metric-stack">
                      <strong>{{ paper.totalMarks }} marks</strong>
                      <span>{{ formatMinutes(paper.durationMinutes) }}</span>
                    </div>
                  </td>
                  <td data-label="Sets">
                    <div class="metric-stack">
                      <strong>{{ setCountForPaper(paper) }} set{{ setCountForPaper(paper) === 1 ? '' : 's' }}</strong>
                      <span>Duplicate-free generation</span>
                    </div>
                  </td>
                  <td data-label="Status">
                    <span class="status-pill" :class="statusClass(paper.status)">
                      {{ statusLabel(paper.status) }}
                    </span>
                  </td>
                  <td data-label="Created By">
                    <div class="metric-stack">
                      <strong>{{ paper.createdBy?.name || 'User' }}</strong>
                      <span>{{ paper.createdBy?.email || '-' }}</span>
                    </div>
                  </td>
                  <td data-label="Updated">{{ formatDate(paper.updatedAt) }}</td>
                  <td v-if="canWrite" data-label="Actions">
                    <div class="paper-actions">
                      <button class="btn btn-secondary btn-sm" type="button" @click="openEditPaper(paper)">
                        Edit
                      </button>
                      <button
                        class="btn btn-primary btn-sm"
                        type="button"
                        :disabled="!canOpenSetManager(paper)"
                        :title="generateActionTitle(paper)"
                        @click="openGenerateSets(paper)"
                      >
                        {{ generateActionLabel(paper) }}
                      </button>
                      <button
                        class="btn btn-secondary btn-sm"
                        type="button"
                        :disabled="!canPostPaper(paper)"
                        :title="postActionTitle(paper)"
                        @click="handlePostAssessment(paper)"
                      >
                        {{ isPostedStatus(paper.status) ? 'Posted' : 'Post Assessment' }}
                      </button>
                      <button class="btn btn-danger btn-sm" type="button" @click="handleDeletePaper(paper)">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="!loading && pagination.total > 0" class="pagination-row">
            <div class="page-size-control">
              <span>{{ pagination.total }} assessment{{ pagination.total === 1 ? '' : 's' }}</span>
              <select v-model.number="pagination.pageSize" class="form-control" @change="fetchTestPapers(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="pagination.page <= 1" @click="fetchTestPapers(pagination.page - 1)">Previous</button>
              <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="pagination.page >= pagination.totalPages" @click="fetchTestPapers(pagination.page + 1)">Next</button>
            </div>
          </div>
        </section>
      </div>

      <div v-if="isSummaryOpen" class="modal-overlay" @click.self="closeAssessmentSummary">
        <div class="modal-box drilldown-modal">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Assessment Summary</p>
              <h3>{{ assessmentSummary?.title || 'Loading summary...' }}</h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close summary" @click="closeAssessmentSummary">
              &times;
            </button>
          </div>
          <div class="modal-content">
            <div v-if="summaryLoading" class="spinner-container">
              <div class="spinner"></div>
              <p class="spinner-text">Loading summary...</p>
            </div>
            <div v-else-if="assessmentSummary" class="drilldown-content">
              <section class="drilldown-section">
                <h4>Metadata</h4>
                <div class="drilldown-grid">
                  <div><span>Class</span><strong>{{ assessmentSummary.metadata.classGrade || '-' }}</strong></div>
                  <div><span>Sub-Class</span><strong>{{ assessmentSummary.metadata.subClass || '-' }}</strong></div>
                  <div><span>Subject</span><strong>{{ assessmentSummary.metadata.subject || '-' }}</strong></div>
                  <div><span>Exam Nature</span><strong>{{ examNatureLabel(assessmentSummary.metadata.examNature) }}</strong></div>
                  <div><span>Exam Date</span><strong>{{ formatDateOnly(assessmentSummary.metadata.examDate) }}</strong></div>
                  <div><span>Code No.</span><strong>{{ assessmentSummary.metadata.codeNo || '-' }}</strong></div>
                  <div><span>Timing</span><strong>{{ assessmentSummary.metadata.timingText || '-' }}</strong></div>
                  <div><span>Status</span><strong>{{ statusLabel(assessmentSummary.status.current) }}</strong></div>
                </div>
              </section>

              <section class="drilldown-section">
                <h4>Linked Banks</h4>
                <div v-if="assessmentSummary.linkedBanks.length === 0" class="muted-box">No linked banks recorded for this assessment.</div>
                <div v-else class="compact-list">
                  <div v-for="bank in assessmentSummary.linkedBanks" :key="bank.id" class="compact-row">
                    <strong>{{ bank.name }}</strong>
                    <span>{{ bank.subjectName || '-' }} · {{ bank.jobRole || '-' }} · {{ bank._count?.bankQuestions || 0 }} questions</span>
                  </div>
                </div>
              </section>

              <section class="drilldown-section">
                <h4>Generated Sets</h4>
                <div v-if="assessmentSummary.generatedSets.length === 0" class="muted-box">No question sets generated yet.</div>
                <div v-else class="compact-list">
                  <div v-for="setItem in assessmentSummary.generatedSets" :key="setItem.id" class="compact-row">
                    <strong>Set {{ setItem.label }} · {{ setItem.totalMarks }} marks</strong>
                    <span>{{ setItem.questionCount }} questions · Easy {{ setItem.easyCount }} · Medium {{ setItem.mediumCount }} · Hard {{ setItem.hardCount }}</span>
                  </div>
                </div>
              </section>

              <section class="drilldown-section">
                <h4>Status History</h4>
                <div v-if="assessmentSummary.statusHistory.length === 0" class="muted-box">No status history available.</div>
                <div v-else class="compact-list">
                  <div v-for="log in assessmentSummary.statusHistory" :key="log.id" class="compact-row">
                    <strong>{{ log.action }}</strong>
                    <span>{{ log.user?.name || 'System' }} · {{ formatDate(log.createdAt) }}</span>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isMarksOpen" class="modal-overlay" @click.self="closeAssessmentMarks">
        <div class="modal-box drilldown-modal">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Marks View</p>
              <h3>{{ assessmentMarks?.title || 'Loading marks...' }}</h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close marks view" @click="closeAssessmentMarks">
              &times;
            </button>
          </div>
          <div class="modal-content">
            <div v-if="marksLoading" class="spinner-container">
              <div class="spinner"></div>
              <p class="spinner-text">Loading marks distribution...</p>
            </div>
            <div v-else-if="assessmentMarks" class="drilldown-content">
              <div class="marks-summary-strip">
                <div><span>Total Marks</span><strong>{{ assessmentMarks.totalMarks }}</strong></div>
                <div><span>Questions</span><strong>{{ assessmentMarks.questionCount }}</strong></div>
              </div>

              <section
                v-for="section in [
                  { title: 'By Difficulty', rows: assessmentMarks.distributions.byDifficulty },
                  { title: 'By Question Type', rows: assessmentMarks.distributions.byQuestionType },
                  { title: 'By Section', rows: assessmentMarks.distributions.bySection },
                ]"
                :key="section.title"
                class="drilldown-section"
              >
                <h4>{{ section.title }}</h4>
                <div v-if="section.rows.length === 0" class="muted-box">No marks available yet.</div>
                <div v-else class="marks-distribution">
                  <div v-for="row in section.rows" :key="`${section.title}-${row.label}`" class="marks-row">
                    <span>{{ row.label }}</span>
                    <strong>{{ row.marks }} marks</strong>
                    <em>{{ row.questionCount }} question{{ row.questionCount === 1 ? '' : 's' }}</em>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      <div v-if="isModalOpen" class="modal-overlay" @click.self="closeModal">
        <form class="modal-box" @submit.prevent="handleSavePaper">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Assessment Details</p>
              <h3>{{ editingPaper ? 'Edit Assessment' : 'Create Assessment' }}</h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close modal" @click="closeModal">
              &times;
            </button>
          </div>

          <div class="modal-content">
            <div v-if="canManageTemplates" class="template-picker-panel">
              <div class="form-group">
                <label class="form-label" for="assessment-template">Template</label>
                <select
                  id="assessment-template"
                  v-model="selectedTemplateId"
                  class="form-control"
                  :disabled="loadingTemplates"
                  @change="handleTemplateSelection"
                >
                  <option value="">Start without template</option>
                  <option
                    v-for="template in activeAssessmentTemplates"
                    :key="template.id"
                    :value="template.id"
                  >
                    {{ template.name }}
                  </option>
                </select>
              </div>
              <div class="template-picker-actions">
                <button class="btn btn-secondary btn-sm" type="button" @click="fetchAssessmentTemplates(true)">
                  Refresh
                </button>
                <button class="btn btn-primary btn-sm" type="button" @click="openSaveTemplateModal()">
                  Save Test Settings As Template
                </button>
              </div>
            </div>

            <div v-if="isPostedStatus(paperStatus)" class="lifecycle-lock-banner">
              <strong>Posted assessment</strong>
              <span>Saving changes will ask for confirmation because posted settings are locked.</span>
            </div>

            <div v-if="editingTemplateSettings" class="template-edit-banner">
              <div>
                <strong>Editing template settings</strong>
                <span>{{ editingTemplateSettings.name }}</span>
              </div>
              <button class="btn btn-primary btn-sm" type="button" @click="openSaveTemplateModal(editingTemplateSettings)">
                Update Template
              </button>
            </div>

            <div class="form-grid">
              <div class="form-group form-span-2">
                <label class="form-label" for="paper-title">Title</label>
                <input
                  id="paper-title"
                  v-model="paperTitle"
                  class="form-control"
                  type="text"
                  required
                  placeholder="Quarterly Mathematics Assessment"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-class">Class / Grade</label>
                <input
                  id="paper-class"
                  v-model="paperClassGrade"
                  class="form-control"
                  type="text"
                  required
                  placeholder="Class 10"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-sub-class">Sub-class</label>
                <input
                  id="paper-sub-class"
                  v-model="paperSubClass"
                  class="form-control"
                  type="text"
                  placeholder="A / B / Science"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-subject">Subject</label>
                <select id="paper-subject" v-model="paperSubjectId" class="form-control" :disabled="!paperClassGrade.trim() || subjectsLoading" required>
                  <option value="">
                    {{ !paperClassGrade.trim() ? 'Enter class first' : subjectsLoading ? 'Loading subjects...' : 'Select Subject' }}
                  </option>
                  <option v-for="subject in subjects" :key="subject.id" :value="subject.id">
                    {{ subject.name }}
                  </option>
                </select>
                <span v-if="subjectsError" class="field-help is-error">{{ subjectsError }}</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-chapter">Chapter</label>
                <select
                  id="paper-chapter"
                  v-model="paperChapterId"
                  class="form-control"
                  :disabled="!paperSubjectId || formChaptersList.length === 0"
                >
                  <option value="">{{ !paperSubjectId ? 'Select subject first' : 'All Chapters' }}</option>
                  <option v-for="chapter in formChaptersList" :key="chapter.id" :value="chapter.id">
                    {{ chapter.name }}
                  </option>
                </select>
                <span v-if="paperSubjectId && formChaptersList.length === 0" class="field-help">No chapters found for this subject.</span>
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-concept">Concept</label>
                <select
                  id="paper-concept"
                  v-model="paperConceptId"
                  class="form-control"
                  :disabled="!paperChapterId || formConceptsList.length === 0"
                >
                  <option value="">{{ !paperChapterId ? 'Select chapter first' : 'All Concepts' }}</option>
                  <option v-for="concept in formConceptsList" :key="concept.id" :value="concept.id">
                    {{ concept.name }}
                  </option>
                </select>
                <span v-if="paperChapterId && formConceptsList.length === 0" class="field-help">No concepts found for this chapter.</span>
              </div>

              <div class="form-group form-span-2">
                <label class="form-label" for="paper-exam-nature">
                  Exam Nature
                  <span class="label-hint">Required before post</span>
                </label>
                <div id="paper-exam-nature" class="exam-nature-toggle" role="group" aria-label="Exam nature">
                  <button
                    v-for="option in examNatureOptions"
                    :key="option.value"
                    type="button"
                    :class="{ active: paperExamNature === option.value }"
                    @click="paperExamNature = option.value"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-exam-date">
                  Exam Date
                  <span class="label-hint">Required before post</span>
                </label>
                <input
                  id="paper-exam-date"
                  v-model="paperExamDate"
                  class="form-control"
                  type="date"
                  :required="publishMetadataRequired"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-code-no">
                  Code No.
                  <span class="label-hint">Required before post</span>
                </label>
                <input
                  id="paper-code-no"
                  v-model="paperCodeNo"
                  class="form-control"
                  type="text"
                  :required="publishMetadataRequired"
                  placeholder="31216062026"
                />
              </div>

              <div class="form-group form-span-2">
                <label class="form-label" for="paper-timing">
                  Timing
                  <span class="label-hint">Required before post</span>
                </label>
                <input
                  id="paper-timing"
                  v-model="paperTimingText"
                  class="form-control"
                  type="text"
                  :required="publishMetadataRequired"
                  placeholder="10:00 AM to 01:00 PM"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-marks">Total Marks</label>
                <input
                  id="paper-marks"
                  v-model="paperTotalMarks"
                  class="form-control"
                  type="number"
                  min="1"
                  required
                  placeholder="100"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-duration">Duration Minutes</label>
                <input
                  id="paper-duration"
                  v-model="paperDurationMinutes"
                  class="form-control"
                  type="number"
                  min="1"
                  required
                  placeholder="180"
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="paper-difficulty">Difficulty</label>
                <select id="paper-difficulty" v-model="paperDifficultyLevel" class="form-control">
                  <option v-for="difficulty in difficultyOptions" :key="difficulty.value" :value="difficulty.value">
                    {{ difficulty.label }}
                  </option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Lifecycle Status</label>
                <div class="lifecycle-status-box">
                  <span class="status-pill" :class="statusClass(paperStatus)">
                    {{ statusLabel(paperStatus) }}
                  </span>
                </div>
              </div>

              <div class="form-group form-span-2">
                <label class="form-label" for="paper-description">Description</label>
                <textarea
                  id="paper-description"
                  v-model="paperDescription"
                  class="form-control textarea-control"
                  placeholder="Short internal description for this assessment"
                ></textarea>
              </div>

              <div class="form-group form-span-2">
                <label class="form-label" for="paper-instructions">Instructions</label>
                <textarea
                  id="paper-instructions"
                  v-model="paperInstructions"
                  class="form-control textarea-control textarea-large"
                  placeholder="Candidate instructions, marking rules, allowed materials..."
                ></textarea>
              </div>

              <div class="form-group form-span-2 template-defaults-panel">
                <div class="section-mini-header">
                  <h5>Default Paper Generation Settings</h5>
                  <span>{{ paperDefaultQuestionBankIds.length }} bank{{ paperDefaultQuestionBankIds.length === 1 ? '' : 's' }} selected</span>
                </div>

                <div class="segmented-control" role="group" aria-label="Default generation mode">
                  <button
                    type="button"
                    :class="{ active: paperDefaultGenerationMode === 'RANDOM' }"
                    @click="paperDefaultGenerationMode = 'RANDOM'"
                  >
                    Random
                  </button>
                  <button
                    type="button"
                    :class="{ active: paperDefaultGenerationMode === 'MANUAL' }"
                    @click="paperDefaultGenerationMode = 'MANUAL'"
                  >
                    Manual
                  </button>
                </div>

                <div class="compact-grid">
                  <div class="form-group">
                    <label class="form-label" for="paper-default-set-count">Default Sets</label>
                    <input
                      id="paper-default-set-count"
                      v-model.number="paperDefaultSetCount"
                      class="form-control"
                      type="number"
                      min="1"
                      max="20"
                    />
                  </div>
                  <label class="inline-check">
                    <input v-model="paperDefaultReplaceExistingSets" type="checkbox" />
                    <span>Replace existing sets by default</span>
                  </label>
                </div>

                <div class="template-defaults-grid">
                  <div>
                    <div class="section-mini-header compact-header">
                      <h5>Question Banks</h5>
                      <span>Optional</span>
                    </div>
                    <div v-if="questionBanks.length === 0" class="mini-empty">No question banks are available.</div>
                    <div v-else class="bank-list template-bank-list">
                      <label v-for="bank in questionBanks" :key="bank.id" class="bank-option">
                        <input v-model="paperDefaultQuestionBankIds" type="checkbox" :value="bank.id" />
                        <span>
                          <strong>{{ bank.name }}</strong>
                          <small>{{ bank._count?.bankQuestions || 0 }} questions</small>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <div class="section-mini-header compact-header">
                      <h5>Difficulty Mix & Marks</h5>
                      <span>Per set</span>
                    </div>
                    <div class="difficulty-grid">
                      <div class="difficulty-row template-difficulty-row heading-row">
                        <span>Difficulty</span>
                        <span>Count</span>
                        <span>Marks</span>
                      </div>
                      <div
                        v-for="difficulty in difficultyOptions"
                        :key="difficulty.value"
                        class="difficulty-row template-difficulty-row"
                      >
                        <span>{{ difficulty.label }}</span>
                        <input
                          v-model.number="paperDefaultDifficultyCounts[difficulty.value]"
                          class="form-control"
                          type="number"
                          min="0"
                        />
                        <input
                          v-model.number="paperDefaultMarksByDifficulty[difficulty.value]"
                          class="form-control"
                          type="number"
                          min="1"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" type="button" @click="closeModal">Cancel</button>
            <button class="btn btn-primary btn-sm" type="submit" :disabled="saving">
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
          </div>
        </form>
      </div>

      <div v-if="isTemplateManagerOpen" class="modal-overlay" @click.self="closeTemplateManager">
        <div class="modal-box template-manager-modal">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Assessment Templates</p>
              <h3>Manage Templates</h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close template manager" @click="closeTemplateManager">
              &times;
            </button>
          </div>

          <div class="modal-content template-manager-content">
            <div v-if="loadingTemplates" class="spinner-container">
              <div class="spinner"></div>
              <p class="spinner-text">Loading templates...</p>
            </div>

            <div v-else-if="assessmentTemplates.length === 0" class="empty-state compact-empty">
              <h3>No templates saved</h3>
              <p>Create an assessment setup, then save it as a reusable template.</p>
            </div>

            <div v-else class="template-card-list">
              <article v-for="template in assessmentTemplates" :key="template.id" class="template-card">
                <div class="template-card-main">
                  <div>
                    <h4>{{ template.name }}</h4>
                    <p>{{ template.description || 'No description provided.' }}</p>
                  </div>
                  <div class="template-card-badges">
                    <span class="status-pill" :class="templateStatusClass(template.status)">
                      {{ template.status }}
                    </span>
                    <span class="scope-pill">{{ template.isGlobal ? 'Global' : 'Private' }}</span>
                  </div>
                </div>

                <div class="template-summary-grid">
                  <span>{{ template.totalMarks || '-' }} marks</span>
                  <span>{{ template.durationMinutes ? formatMinutes(template.durationMinutes) : '-' }}</span>
                  <span>{{ template.defaultGenerationMode || 'RANDOM' }}</span>
                  <span>{{ template.defaultSetCount || 2 }} set{{ (template.defaultSetCount || 2) === 1 ? '' : 's' }}</span>
                </div>

                <div class="template-card-actions">
                  <button class="btn btn-secondary btn-sm" type="button" @click="editTemplateSettings(template)">
                    Edit Settings
                  </button>
                  <button
                    v-if="template.status !== 'ARCHIVED'"
                    class="btn btn-secondary btn-sm"
                    type="button"
                    @click="archiveTemplate(template)"
                  >
                    Archive
                  </button>
                  <button
                    v-else
                    class="btn btn-primary btn-sm"
                    type="button"
                    @click="restoreTemplate(template)"
                  >
                    Restore
                  </button>
                </div>
              </article>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" type="button" @click="closeTemplateManager">Close</button>
          </div>
        </div>
      </div>

      <div v-if="isTemplateSaveOpen" class="modal-overlay template-save-overlay" @click.self="closeTemplateSaveModal()">
        <form class="modal-box template-save-modal" @submit.prevent="handleSaveTemplate">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Reusable Assessment Setup</p>
              <h3>{{ savingTemplateTarget ? 'Update Template' : 'Save Test Settings As Template' }}</h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close template save" @click="closeTemplateSaveModal()">
              &times;
            </button>
          </div>

          <div class="modal-content">
            <div class="form-grid">
              <div class="form-group form-span-2">
                <label class="form-label" for="template-name">Template Name</label>
                <input
                  id="template-name"
                  v-model="templateName"
                  class="form-control"
                  type="text"
                  required
                  placeholder="SSC Public Exam - Physics 100 marks"
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="template-status">Status</label>
                <select id="template-status" v-model="templateStatus" class="form-control">
                  <option v-for="status in templateStatusOptions" :key="status.value" :value="status.value">
                    {{ status.label }}
                  </option>
                </select>
              </div>
              <label class="inline-check template-visibility-check">
                <input v-model="templateIsGlobal" type="checkbox" />
                <span>Available to other assessment creators</span>
              </label>
              <div class="form-group form-span-2">
                <label class="form-label" for="template-description">Description</label>
                <textarea
                  id="template-description"
                  v-model="templateDescription"
                  class="form-control textarea-control"
                  placeholder="When this template should be used"
                ></textarea>
              </div>
            </div>

            <div class="template-save-summary">
              <div>
                <span>Marks</span>
                <strong>{{ paperTotalMarks || '-' }}</strong>
              </div>
              <div>
                <span>Timing</span>
                <strong>{{ paperTimingText || formatMinutes(paperDurationMinutes) }}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>{{ paperDefaultGenerationMode }}</strong>
              </div>
              <div>
                <span>Question Banks</span>
                <strong>{{ paperDefaultQuestionBankIds.length }}</strong>
              </div>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" type="button" @click="closeTemplateSaveModal()">Cancel</button>
            <button class="btn btn-primary btn-sm" type="submit" :disabled="savingTemplate">
              {{ savingTemplate ? 'Saving...' : savingTemplateTarget ? 'Update Template' : 'Save Test Settings As Template' }}
            </button>
          </div>
        </form>
      </div>

      <div v-if="isSetModalOpen" class="modal-overlay" @click.self="closeSetModal">
        <div class="modal-box sets-modal">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Generated Question Sets</p>
              <h3>{{ selectedPaperForSets?.title || 'Question Sets' }}</h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close modal" @click="closeSetModal">
              &times;
            </button>
          </div>

          <div v-if="!selectedPaperForSets" class="modal-content">
            <div class="spinner-container">
              <div class="spinner"></div>
              <p class="spinner-text">Preparing set generator...</p>
            </div>
          </div>

          <div v-else class="modal-content sets-content">
            <div class="set-summary-strip">
              <div>
                <span>Assessment Marks</span>
                <strong>{{ selectedPaperForSets.totalMarks }}</strong>
              </div>
              <div>
                <span>Duration</span>
                <strong>{{ formatMinutes(selectedPaperForSets.durationMinutes) }}</strong>
              </div>
              <div>
                <span>Exam Date</span>
                <strong>{{ formatDateOnly(selectedPaperForSets.examDate) }}</strong>
              </div>
              <div>
                <span>Code No.</span>
                <strong>{{ selectedPaperForSets.codeNo || 'Pending' }}</strong>
              </div>
              <div>
                <span>Generated Sets</span>
                <strong>{{ selectedPaperForSets.sets?.length || 0 }}</strong>
              </div>
            </div>

            <div class="generated-sets-only">
              <section v-if="false" class="generator-panel">
                <div class="panel-heading">
                  <h4>Generation Setup</h4>
                  <p>Random mode uses all selected banks. Manual mode uses only checked questions.</p>
                  <p v-if="selectedPaperForSets && !canGenerateForPaper(selectedPaperForSets)" class="panel-warning">
                    {{ generateActionTitle(selectedPaperForSets) }}
                  </p>
                </div>

                <div class="segmented-control" role="group" aria-label="Generation mode">
                  <button
                    type="button"
                    :class="{ active: generationMode === 'RANDOM' }"
                    @click="generationMode = 'RANDOM'"
                  >
                    Random
                  </button>
                  <button
                    type="button"
                    :class="{ active: generationMode === 'MANUAL' }"
                    @click="generationMode = 'MANUAL'"
                  >
                    Manual
                  </button>
                </div>

                <div class="compact-grid">
                  <div class="form-group">
                    <label class="form-label" for="set-count">Number of Sets</label>
                    <input
                      id="set-count"
                      v-model.number="setCount"
                      class="form-control"
                      type="number"
                      min="1"
                      max="20"
                    />
                  </div>
                  <label class="inline-check">
                    <input v-model="replaceExistingSets" type="checkbox" />
                    <span>Replace existing sets</span>
                  </label>
                </div>

                <div class="generator-section">
                  <div class="section-mini-header">
                    <h5>Question Banks</h5>
                    <span>{{ selectedQuestionBankIds.length }} selected</span>
                  </div>

                  <div v-if="loadingBanks" class="mini-loading">Loading banks...</div>
                  <div v-else-if="questionBanks.length === 0" class="mini-empty">
                    No question banks are available.
                  </div>
                  <div v-else class="bank-list">
                    <label v-for="bank in questionBanks" :key="bank.id" class="bank-option">
                      <input v-model="selectedQuestionBankIds" type="checkbox" :value="bank.id" />
                      <span>
                        <strong>{{ bank.name }}</strong>
                        <small>{{ bank._count?.bankQuestions || 0 }} questions</small>
                      </span>
                    </label>
                  </div>
                </div>

                <div class="generator-section">
                  <div class="section-mini-header">
                    <h5>Difficulty Balance & Marks</h5>
                    <span>{{ requestedQuestionsPerSet }} questions per set</span>
                  </div>

                  <div class="difficulty-grid">
                    <div class="difficulty-row heading-row">
                      <span>Difficulty</span>
                      <span>Count</span>
                      <span>Marks</span>
                      <span>Available</span>
                    </div>
                    <div
                      v-for="difficulty in difficultyOptions"
                      :key="difficulty.value"
                      class="difficulty-row"
                    >
                      <span>{{ difficulty.label }}</span>
                      <input
                        v-model.number="difficultyCounts[difficulty.value]"
                        class="form-control"
                        type="number"
                        min="0"
                      />
                      <input
                        v-model.number="marksByDifficulty[difficulty.value]"
                        class="form-control"
                        type="number"
                        min="1"
                      />
                      <span
                        :class="[
                          'availability-pill',
                          {
                            weak:
                              activePoolDifficultyCounts[difficulty.value] <
                              (difficultyCounts[difficulty.value] || 0) * (setCount || 0),
                          },
                        ]"
                      >
                        {{ activePoolDifficultyCounts[difficulty.value] }} /
                        {{ (difficultyCounts[difficulty.value] || 0) * (setCount || 0) }}
                      </span>
                    </div>
                  </div>
                </div>

                <div v-if="generationMode === 'MANUAL'" class="generator-section">
                  <div class="section-mini-header">
                    <h5>Manual Question Pool</h5>
                    <span>{{ selectedManualQuestionIds.length }} selected</span>
                  </div>

                  <div v-if="selectedQuestionBankIds.length === 0" class="mini-empty">
                    Select one or more question banks first.
                  </div>
                  <div v-else-if="selectedBankQuestions.length === 0" class="mini-empty">
                    No questions found in the selected banks.
                  </div>
                  <div v-else class="manual-question-list">
                    <label
                      v-for="question in selectedBankQuestions"
                      :key="question.id"
                      class="manual-question"
                    >
                      <input v-model="selectedManualQuestionIds" type="checkbox" :value="question.id" />
                      <span>
                        <strong>{{ difficultyLabel(question.difficulty) }}</strong>
                        {{ questionSnippet(question.content) }}
                        <small>{{ question.sourceBankName }} - {{ questionScope(question) }}</small>
                      </span>
                    </label>
                  </div>
                </div>
              </section>

              <section class="generator-panel generated-sets-panel">
                <div class="panel-heading">
                  <h4>Generated Sets</h4>
                  <p>Preview, edit, download, or remove sets generated from Assessment Builder.</p>
                </div>

                <div v-if="!selectedPaperForSets.sets?.length" class="mini-empty sets-empty">
                  <strong>No sets generated yet.</strong>
                  <span>Use Assessment Builder to validate the section blueprint and generate sets.</span>
                  <router-link class="btn btn-primary btn-sm" to="/assessment-builder" @click="closeSetModal">
                    Open Assessment Builder
                  </router-link>
                </div>

                <div v-else class="generated-set-list">
                  <article v-for="setItem in selectedPaperForSets.sets" :key="setItem.id" class="set-card">
                    <div class="set-card-header">
                      <div>
                        <h5>Set {{ setItem.label }}</h5>
                        <p>{{ setItem.questionCount }} questions, {{ setItem.totalMarks }} marks</p>
                      </div>
                      <div class="set-card-actions">
                        <button class="btn btn-secondary btn-sm" type="button" @click="openSetPreview(setItem)">
                          Preview / Edit
                        </button>
                        <button
                          class="btn btn-primary btn-sm"
                          type="button"
                          :disabled="downloadingSetId === setItem.id"
                          @click="downloadSetDocument(setItem)"
                        >
                          {{ downloadingSetId === setItem.id ? 'Downloading...' : 'Download PDF' }}
                        </button>
                        <button
                          v-if="!isPostedStatus(selectedPaperForSets?.status)"
                          class="btn btn-danger btn-sm"
                          type="button"
                          @click="handleDeleteSet(setItem)"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div class="set-badges">
                      <span class="status-pill status-draft">{{ setItem.generationMode }}</span>
                      <span>{{ setDifficultyText(setItem) }}</span>
                    </div>
                    <ol class="set-question-list">
                      <li v-for="link in setItem.questions" :key="link.id">
                        <span>{{ link.displayOrder }}.</span>
                        <div>
                          <strong>{{ link.marks }} mark{{ link.marks === 1 ? '' : 's' }}</strong>
                          {{ questionSnippet(link.question?.content) }}
                          <small>{{ difficultyLabel(link.question?.difficulty) }}</small>
                        </div>
                      </li>
                    </ol>
                  </article>
                </div>
              </section>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" type="button" @click="closeSetModal">
              Close
            </button>
          </div>
        </div>
      </div>

      <div v-if="isSetPreviewOpen" class="modal-overlay editor-overlay" @click.self="closeSetPreview">
        <div class="modal-box editor-modal">
          <div class="modal-header">
            <div>
              <p class="page-kicker">Editable Question Paper Preview</p>
              <h3>
                Set {{ selectedSetForPreview?.label }} -
                {{ selectedPaperForSets?.title || 'Question Paper' }}
              </h3>
            </div>
            <button type="button" class="icon-button" aria-label="Close preview" @click="closeSetPreview">
              &times;
            </button>
          </div>

          <div class="editor-toolbar" aria-label="Question paper editor toolbar">
            <div class="toolbar-group">
              <button type="button" class="toolbar-button strong-button" title="Bold" @click="runEditorCommand('bold')">
                B
              </button>
              <button type="button" class="toolbar-button italic-button" title="Italic" @click="runEditorCommand('italic')">
                I
              </button>
              <button type="button" class="toolbar-button underline-button" title="Underline" @click="runEditorCommand('underline')">
                U
              </button>
              <button type="button" class="toolbar-button strike-button" title="Strike" @click="runEditorCommand('strikeThrough')">
                S
              </button>
            </div>

            <div class="toolbar-group">
              <button type="button" class="toolbar-button" title="Numbered list" @click="runEditorCommand('insertOrderedList')">
                1.
              </button>
              <button type="button" class="toolbar-button" title="Bullet list" @click="runEditorCommand('insertUnorderedList')">
                &bull;
              </button>
              <button type="button" class="toolbar-button" title="Decrease indent" @click="runEditorCommand('outdent')">
                &lt;
              </button>
              <button type="button" class="toolbar-button" title="Increase indent" @click="runEditorCommand('indent')">
                &gt;
              </button>
            </div>

            <div class="toolbar-group">
              <button type="button" class="toolbar-button" title="Align left" @click="runEditorCommand('justifyLeft')">
                L
              </button>
              <button type="button" class="toolbar-button" title="Align center" @click="runEditorCommand('justifyCenter')">
                C
              </button>
              <button type="button" class="toolbar-button" title="Align right" @click="runEditorCommand('justifyRight')">
                R
              </button>
            </div>

            <div class="toolbar-group">
              <select class="toolbar-select" aria-label="Text format" @change="applyEditorFormat">
                <option v-for="format in editorFormats" :key="format.value" :value="format.value">
                  {{ format.label }}
                </option>
              </select>
              <select class="toolbar-select" aria-label="Font family" @change="applyEditorFont">
                <option v-for="font in editorFontFamilies" :key="font" :value="font">
                  {{ font }}
                </option>
              </select>
            </div>

            <div class="toolbar-group">
              <button type="button" class="toolbar-button" title="Superscript" @click="runEditorCommand('superscript')">
                x2
              </button>
              <button type="button" class="toolbar-button" title="Subscript" @click="runEditorCommand('subscript')">
                x2
              </button>
              <button type="button" class="toolbar-button" title="Insert table" @click="insertSimpleTable">
                Table
              </button>
              <button type="button" class="toolbar-button page-break-button" title="Insert page break" @click="insertPageBreak">
                Page Break
              </button>
              <button type="button" class="toolbar-button" title="Clear formatting" @click="runEditorCommand('removeFormat')">
                Tx
              </button>
            </div>
          </div>

          <div class="editor-body">
            <div
              ref="paperEditorRef"
              class="paper-editor"
              contenteditable="true"
              spellcheck="true"
              @input="persistEditorContent"
            ></div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-secondary btn-sm" type="button" @click="closeSetPreview">
              Close Preview
            </button>
            <button
              class="btn btn-primary btn-sm"
              type="button"
              :disabled="!selectedSetForPreview || downloadingSetId === selectedSetForPreview?.id"
              @click="downloadSetDocument(selectedSetForPreview)"
            >
              {{
                downloadingSetId === selectedSetForPreview?.id
                  ? 'Downloading PDF...'
                  : `Download Set ${selectedSetForPreview?.label} PDF`
              }}
            </button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.table-action-button {
  width: auto;
  min-width: 88px;
}

.drilldown-modal {
  max-width: 900px;
}

.drilldown-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.drilldown-section {
  padding: 1rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: rgba(255, 255, 255, 0.03);
}

.drilldown-section h4 {
  margin: 0 0 0.8rem;
  color: var(--text-primary);
}

.drilldown-grid,
.marks-summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
}

.drilldown-grid div,
.marks-summary-strip div {
  min-width: 0;
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.drilldown-grid span,
.marks-summary-strip span {
  display: block;
  margin-bottom: 0.25rem;
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.drilldown-grid strong,
.marks-summary-strip strong {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.compact-list,
.marks-distribution {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.compact-row,
.marks-row,
.muted-box {
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.compact-row strong,
.compact-row span,
.marks-row span,
.marks-row strong,
.marks-row em {
  display: block;
}

.compact-row span,
.marks-row em,
.muted-box {
  color: var(--text-secondary);
  font-style: normal;
}

.marks-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 0.75rem;
  align-items: center;
}

.marks-row span {
  min-width: 0;
  color: var(--text-primary);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.marks-row strong {
  color: var(--primary);
}

@media (max-width: 700px) {
  .marks-row {
    grid-template-columns: 1fr;
  }
}

.page-kicker {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  line-height: 1.2;
  margin-bottom: 0.25rem;
  text-transform: uppercase;
}

.filters-card {
  margin-bottom: 1.5rem;
}

.filters-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(220px, 1.5fr) repeat(3, minmax(160px, 1fr));
}

.filters-card .form-group {
  margin-bottom: 0;
}

.filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1rem;
}

.table-card {
  padding: 0;
  overflow: hidden;
}

.table-heading {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
}

.table-heading h3 {
  font-size: 1rem;
  margin: 0;
}

.table-heading p {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-top: 0.2rem;
}

.table-scroll {
  overflow-x: auto;
}

.paper-table {
  border-collapse: collapse;
  min-width: 1420px;
  width: 100%;
}

.paper-table th,
.paper-table td {
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 1rem 1.25rem;
  text-align: left;
  vertical-align: top;
}

.paper-table th {
  color: var(--text-muted);
  font-size: 0.76rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.paper-table tr:last-child td {
  border-bottom: 0;
}

.assessment-title {
  color: var(--text-primary);
  font-weight: 700;
  max-width: 260px;
  overflow-wrap: anywhere;
}

.assessment-meta {
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-top: 0.25rem;
}

.scope-text {
  display: inline-block;
  max-width: 240px;
  overflow-wrap: anywhere;
}

.metric-stack {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.metric-stack strong {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.metric-stack span {
  color: var(--text-muted);
  font-size: 0.82rem;
  overflow-wrap: anywhere;
}

.exam-meta-stack {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 150px;
}

.exam-meta-stack strong {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.exam-meta-stack span {
  color: var(--text-muted);
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.status-pill {
  border-radius: 999px;
  display: inline-flex;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  padding: 0.35rem 0.65rem;
  text-transform: uppercase;
  white-space: nowrap;
}

.status-draft {
  background: rgba(148, 163, 184, 0.16);
  color: #cbd5e1;
}

.status-saved {
  background: rgba(99, 102, 241, 0.16);
  color: #a5b4fc;
}

.status-questions_generated {
  background: rgba(14, 165, 233, 0.16);
  color: #7dd3fc;
}

.status-posted,
.status-published {
  background: rgba(16, 185, 129, 0.16);
  color: #34d399;
}

.status-archived {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}

.paper-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 260px;
}

.lifecycle-status-box {
  align-items: center;
  background: rgba(148, 163, 184, 0.08);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  display: flex;
  min-height: 46px;
  padding: 0.5rem 0.75rem;
}

.lifecycle-lock-banner {
  align-items: center;
  background: rgba(99, 102, 241, 0.14);
  border: 1px solid rgba(129, 140, 248, 0.32);
  border-radius: 12px;
  color: var(--text-primary);
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding: 0.85rem 1rem;
}

.lifecycle-lock-banner span,
.panel-warning {
  color: var(--text-secondary);
}

.panel-warning {
  margin-top: 0.35rem;
}

.btn-danger {
  background-color: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.28);
  color: #fca5a5;
}

.btn-danger:hover {
  background-color: rgba(239, 68, 68, 0.22);
  color: #fecaca;
}

.empty-state {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 4rem 1.5rem;
  text-align: center;
}

.empty-state h3 {
  color: var(--text-primary);
  font-size: 1.2rem;
}

.empty-state p {
  max-width: 460px;
}

.compact-empty {
  padding: 2rem 1rem;
}

.modal-overlay {
  align-items: center;
  background: var(--overlay-bg);
  backdrop-filter: var(--glass-blur-soft);
  -webkit-backdrop-filter: var(--glass-blur-soft);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  position: fixed;
  z-index: 10020;
}

.modal-box {
  background: var(--glass-panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--glass-shadow), var(--glass-highlight-strong);
  display: flex;
  flex-direction: column;
  max-height: min(92vh, 860px);
  max-width: 860px;
  overflow: hidden;
  width: min(100%, 860px);
}

.sets-modal {
  max-width: 1180px;
  width: min(100%, 1180px);
}

.editor-modal {
  max-height: min(94vh, 940px);
  max-width: 1120px;
  width: min(100%, 1120px);
}

.template-manager-modal {
  max-width: 920px;
  width: min(100%, 920px);
}

.template-save-modal {
  max-width: 720px;
  width: min(100%, 720px);
}

.template-save-overlay {
  z-index: 10050;
}

.editor-overlay {
  z-index: 10040;
}

.modal-header,
.modal-actions {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.25rem 1.5rem;
}

.modal-header {
  border-bottom: 1px solid var(--subtle-border);
}

.modal-header h3 {
  font-size: 1.15rem;
  margin: 0;
}

.modal-actions {
  border-top: 1px solid var(--subtle-border);
  justify-content: flex-end;
}

.modal-content {
  overflow-y: auto;
  padding: 1.5rem;
}

.form-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.form-grid .form-group {
  margin-bottom: 0;
}

.form-span-2 {
  grid-column: span 2;
}

.template-picker-panel,
.template-edit-banner,
.template-defaults-panel {
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  margin-bottom: 1rem;
  padding: 1rem;
}

.template-picker-panel {
  align-items: end;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.template-picker-panel .form-group {
  margin-bottom: 0;
}

.template-picker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: flex-end;
}

.template-edit-banner {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.template-edit-banner div {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.template-edit-banner strong {
  color: var(--text-primary);
}

.template-edit-banner span {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.template-defaults-panel {
  margin-bottom: 0;
}

.template-defaults-panel .segmented-control {
  margin-bottom: 1rem;
}

.template-defaults-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  margin-top: 1rem;
}

.compact-header {
  margin-bottom: 0.55rem;
}

.template-bank-list {
  max-height: 210px;
}

.template-difficulty-row {
  grid-template-columns: 1fr 86px 86px;
}

.template-manager-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.template-card-list {
  display: grid;
  gap: 0.85rem;
}

.template-card {
  background: rgba(15, 23, 42, 0.12);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem;
}

.template-card-main,
.template-card-actions,
.template-card-badges {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
}

.template-card-main {
  justify-content: space-between;
}

.template-card h4 {
  color: var(--text-primary);
  font-size: 1rem;
  margin: 0;
}

.template-card p {
  color: var(--text-muted);
  font-size: 0.84rem;
  margin-top: 0.25rem;
}

.template-card-badges,
.template-card-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.scope-pill {
  background: rgba(99, 102, 241, 0.14);
  border: 1px solid rgba(99, 102, 241, 0.22);
  border-radius: 999px;
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 800;
  padding: 0.35rem 0.65rem;
}

.template-summary-grid,
.template-save-summary {
  display: grid;
  gap: 0.6rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 0.85rem;
}

.template-summary-grid span,
.template-save-summary > div {
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid var(--subtle-border);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.82rem;
  font-weight: 700;
  padding: 0.55rem 0.65rem;
}

.template-save-summary span {
  color: var(--text-muted);
  display: block;
  font-size: 0.72rem;
  margin-bottom: 0.15rem;
  text-transform: uppercase;
}

.template-save-summary strong {
  color: var(--text-primary);
  display: block;
  overflow-wrap: anywhere;
}

.template-card-actions {
  margin-top: 0.85rem;
}

.template-visibility-check {
  align-self: end;
  margin-bottom: 0;
}

.form-label .label-hint {
  color: var(--text-muted);
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0;
  margin-left: 0.35rem;
  text-transform: none;
}

.exam-nature-toggle {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: grid;
  gap: 0.35rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 0.35rem;
}

.exam-nature-toggle button {
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-weight: 800;
  min-height: 42px;
  padding: 0.65rem 0.75rem;
  transition: all var(--transition-fast);
}

.exam-nature-toggle button.active {
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  box-shadow: 0 12px 28px rgba(99, 102, 241, 0.24);
  color: #ffffff;
}

.exam-nature-toggle button:not(.active):hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.textarea-control {
  min-height: 92px;
  resize: vertical;
}

.textarea-large {
  min-height: 130px;
}

.icon-button {
  align-items: center;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  font-size: 1.4rem;
  height: 36px;
  justify-content: center;
  line-height: 1;
  transition: all var(--transition-fast);
  width: 36px;
}

.icon-button:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.sets-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.set-summary-strip {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}

.set-summary-strip > div {
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 0.85rem 1rem;
}

.set-summary-strip span {
  color: var(--text-muted);
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.set-summary-strip strong {
  color: var(--text-primary);
  display: block;
  font-size: 1rem;
  margin-top: 0.25rem;
}

.generator-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
}

.generated-sets-only {
  display: grid;
  gap: 1rem;
}

.generator-panel {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem;
}

.generated-sets-panel {
  min-height: 360px;
}

.panel-heading {
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
}

.panel-heading h4,
.section-mini-header h5,
.set-card h5 {
  color: var(--text-primary);
  font-size: 0.95rem;
  margin: 0;
}

.panel-heading p {
  color: var(--text-muted);
  font-size: 0.82rem;
  margin-top: 0.25rem;
}

.segmented-control {
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: grid;
  gap: 0.35rem;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 1rem;
  padding: 0.35rem;
}

.segmented-control button {
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0.65rem;
}

.segmented-control button.active {
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  color: #ffffff;
}

.compact-grid {
  align-items: end;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(0, 1fr) minmax(180px, 0.9fr);
}

.compact-grid .form-group {
  margin-bottom: 0;
}

.inline-check {
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  gap: 0.65rem;
  min-height: 45px;
  padding: 0.75rem 0.85rem;
}

.inline-check input,
.bank-option input,
.manual-question input {
  accent-color: var(--primary);
}

.generator-section {
  margin-top: 1rem;
}

.section-mini-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.65rem;
}

.section-mini-header span {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.mini-loading,
.mini-empty {
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  padding: 1rem;
  text-align: center;
}

.sets-empty {
  display: grid;
  gap: 0.75rem;
  justify-items: center;
}

.sets-empty strong {
  color: var(--text-primary);
}

.bank-list,
.manual-question-list,
.generated-set-list {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.bank-list,
.manual-question-list {
  max-height: 280px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.bank-option,
.manual-question {
  align-items: flex-start;
  background: rgba(15, 23, 42, 0.12);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  gap: 0.75rem;
  padding: 0.85rem;
}

.bank-option span,
.manual-question span {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.bank-option strong,
.manual-question strong {
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.bank-option small,
.manual-question small,
.set-question-list small {
  color: var(--text-muted);
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.difficulty-grid {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.difficulty-row {
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  display: grid;
  gap: 0.65rem;
  grid-template-columns: 1fr 86px 86px 104px;
  padding: 0.65rem;
}

.difficulty-row:last-child {
  border-bottom: 0;
}

.heading-row {
  background: rgba(99, 102, 241, 0.08);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.difficulty-row .form-control {
  padding: 0.55rem 0.65rem;
}

.availability-pill {
  border-radius: 999px;
  color: var(--success);
  font-size: 0.78rem;
  font-weight: 800;
  text-align: center;
}

.availability-pill.weak {
  color: var(--error);
}

.sets-empty {
  min-height: 180px;
}

.set-card {
  background: rgba(15, 23, 42, 0.12);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: 1rem;
}

.set-card-header {
  align-items: flex-start;
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.set-card-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
}

.set-card-header p {
  color: var(--text-muted);
  font-size: 0.82rem;
  margin-top: 0.2rem;
}

.set-badges {
  align-items: center;
  color: var(--text-secondary);
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-bottom: 0.75rem;
}

.set-question-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  list-style: none;
  max-height: 280px;
  overflow-y: auto;
  padding-right: 0.25rem;
}

.set-question-list li {
  align-items: flex-start;
  border-top: 1px solid var(--border-color);
  color: var(--text-secondary);
  display: grid;
  gap: 0.6rem;
  grid-template-columns: 28px minmax(0, 1fr);
  padding-top: 0.55rem;
}

.set-question-list li > span {
  color: var(--text-muted);
  font-weight: 800;
}

.set-question-list div {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  overflow-wrap: anywhere;
}

.set-question-list strong {
  color: var(--text-primary);
  font-size: 0.82rem;
}

.editor-toolbar {
  align-items: center;
  background: var(--bg-input);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
}

.toolbar-group {
  align-items: center;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-right: 0.5rem;
}

.toolbar-group:last-child {
  border-right: 0;
}

.toolbar-button,
.toolbar-select {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.82rem;
  min-height: 34px;
}

.toolbar-button {
  cursor: pointer;
  min-width: 36px;
  padding: 0.35rem 0.55rem;
}

.toolbar-button:hover {
  background: var(--bg-card-hover);
  border-color: rgba(99, 102, 241, 0.35);
}

.toolbar-select {
  min-width: 120px;
  padding: 0.35rem 0.55rem;
}

.strong-button {
  font-weight: 800;
}

.italic-button {
  font-style: italic;
}

.underline-button {
  text-decoration: underline;
}

.strike-button {
  text-decoration: line-through;
}

.page-break-button {
  min-width: 96px;
}

.editor-body {
  background: rgba(15, 23, 42, 0.35);
  overflow: auto;
  padding: 1.5rem;
}

.paper-editor {
  background: #ffffff;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.24);
  color: #0f172a;
  font-family: Calibri, Arial, sans-serif;
  font-size: 1rem;
  line-height: 1.55;
  margin: 0 auto;
  min-height: 980px;
  outline: none;
  padding: 3rem 2.75rem;
  width: min(100%, 794px);
}

.paper-editor :deep(h2),
.paper-editor :deep(h3) {
  text-align: center;
}

.paper-editor :deep(h2) {
  font-size: 1.15rem;
  margin: 2rem 0 0.35rem;
}

.paper-editor :deep(h3) {
  font-size: 1rem;
  margin: 0 0 1.75rem;
}

.paper-editor :deep(h4) {
  font-size: 1rem;
  margin: 1.5rem 0 0.65rem;
}

.paper-editor :deep(.paper-topline),
.paper-editor :deep(.paper-meta-grid) {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
}

.paper-editor :deep(.paper-meta-grid) {
  border-bottom: 1px solid #cbd5e1;
  border-top: 1px solid #cbd5e1;
  margin: 1rem 0;
  padding: 0.65rem 0;
}

.paper-editor :deep(.paper-question-section) {
  margin-top: 1.35rem;
}

.paper-editor :deep(.paper-section-heading) {
  font-size: 1rem;
  font-weight: 800;
  margin: 1.35rem 0 0.85rem;
  text-align: center;
  text-transform: uppercase;
}

.paper-editor :deep(.paper-question-list) {
  padding-left: 1.3rem;
}

.paper-editor :deep(.paper-question-list > li) {
  margin-bottom: 1rem;
  padding-left: 0.25rem;
}

.paper-editor :deep(.paper-question-row) {
  align-items: flex-start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.paper-editor :deep(.paper-question-text) {
  flex: 1;
}

.paper-editor :deep(.paper-marks) {
  white-space: nowrap;
}

.paper-editor :deep(.paper-answer-options) {
  list-style: none;
  margin: 0.5rem 0 0;
  padding-left: 1rem;
}

.paper-editor :deep(.paper-answer-options li) {
  margin-bottom: 0.25rem;
}

.paper-editor :deep(.paper-editor-table) {
  border-collapse: collapse;
  margin: 0.75rem 0;
  width: 100%;
}

.paper-editor :deep(.paper-editor-table td) {
  border: 1px solid #64748b;
  padding: 0.5rem;
}

.paper-editor :deep(.editor-page-break) {
  align-items: center;
  border-bottom: 1px dashed #94a3b8;
  border-top: 1px dashed #94a3b8;
  color: #64748b;
  display: flex;
  font-size: 0.8rem;
  font-weight: 700;
  justify-content: center;
  margin: 1rem 0;
  padding: 0.35rem;
  page-break-before: always;
  text-transform: uppercase;
}

@media (max-width: 1100px) {
  .filters-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .generator-grid,
  .set-summary-strip,
  .template-defaults-grid,
  .template-summary-grid,
  .template-save-summary {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 768px) {
  .filters-grid,
  .form-grid,
  .generator-grid,
  .set-summary-strip,
  .template-picker-panel,
  .template-defaults-grid,
  .template-summary-grid,
  .template-save-summary,
  .compact-grid {
    grid-template-columns: 1fr;
  }

  .form-span-2 {
    grid-column: span 1;
  }

  .filter-actions,
  .modal-actions,
  .table-heading,
  .template-edit-banner,
  .template-card-main {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-actions .btn,
  .modal-actions .btn,
  .template-picker-actions .btn,
  .template-edit-banner .btn,
  .table-heading .btn {
    width: 100% !important;
  }

  .template-picker-actions,
  .template-card-actions,
  .template-card-badges {
    justify-content: stretch;
  }

  .table-scroll {
    overflow-x: visible;
  }

  .editor-body {
    padding: 0.75rem;
  }

  .paper-editor {
    min-height: 760px;
    padding: 1.5rem 1.1rem;
  }

  .set-card-header,
  .set-card-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .set-card-actions .btn {
    width: 100% !important;
  }

  .paper-table {
    min-width: 0;
  }

  .paper-table thead {
    display: none;
  }

  .paper-table,
  .paper-table tbody,
  .paper-table tr,
  .paper-table td {
    display: block;
    width: 100%;
  }

  .paper-table tbody {
    display: grid;
    gap: 1rem;
    padding: 1rem;
  }

  .paper-table tr {
    background: rgba(15, 23, 42, 0.18);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .paper-table td {
    border-bottom: 1px solid var(--border-color);
    display: grid;
    gap: 0.65rem;
    grid-template-columns: minmax(96px, 34%) minmax(0, 1fr);
    padding: 0.85rem 1rem;
  }

  .paper-table td::before {
    color: var(--text-muted);
    content: attr(data-label);
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .paper-table td:last-child {
    border-bottom: 0;
  }

  .assessment-title,
  .scope-text {
    max-width: 100%;
  }

  .paper-actions {
    min-width: 0;
  }

  .paper-actions .btn {
    flex: 1 1 110px;
  }

  .modal-box {
    border-radius: var(--radius-md);
    max-height: calc(100dvh - 1.5rem);
  }

  .difficulty-row {
    grid-template-columns: 1fr 72px 72px;
  }

  .difficulty-row span:last-child {
    grid-column: 1 / -1;
  }

  .set-card-header {
    align-items: stretch;
    flex-direction: column;
  }

  .set-card-header .btn {
    width: 100% !important;
  }
}

@media (max-width: 420px) {
  .paper-table td {
    grid-template-columns: 1fr;
  }

  .paper-actions .btn {
    flex-basis: 100%;
    width: 100%;
  }
}
</style>
