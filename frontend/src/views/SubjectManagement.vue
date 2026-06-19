<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useConfirmationStore } from '../stores/confirmation'
import api from '../services/api'

const router = useRouter()
const authStore = useAuthStore()
const confirmationStore = useConfirmationStore()

const userRole = computed(() => authStore.userRole)
const userPermissions = computed(() => authStore.user?.permissions || [])
const canWrite = computed(() => userRole.value === 'ADMIN' || userPermissions.value.includes('subjects:write'))

const subjects = ref([])
const loading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

// Tree expansion state
const expandedSubjects = ref({})
const expandedChapters = ref({})

// Modal / Edit state
const isModalOpen = ref(false)
const modalType = ref('subject') // 'subject', 'chapter', 'concept'
const isEditMode = ref(false)
const activeParentId = ref(null) // Holds subjectId or chapterId for creation
const activeId = ref(null) // Holds ID of entity being edited

// Form fields
const name = ref('')
const description = ref('')

onMounted(async () => {
  await fetchSubjects()
})

const fetchSubjects = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await api.get('/subjects')
    subjects.value = response.data
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to load subject taxonomy.'
  } finally {
    loading.value = false
  }
}

// Expander toggles
const toggleSubject = (id) => {
  expandedSubjects.value[id] = !expandedSubjects.value[id]
}
const toggleChapter = (id) => {
  expandedChapters.value[id] = !expandedChapters.value[id]
}

// --- Create Actions ---
const openCreateSubject = () => {
  modalType.value = 'subject'
  isEditMode.value = false
  activeParentId.value = null
  activeId.value = null
  name.value = ''
  description.value = ''
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

const openCreateChapter = (subjectId) => {
  modalType.value = 'chapter'
  isEditMode.value = false
  activeParentId.value = subjectId
  activeId.value = null
  name.value = ''
  description.value = ''
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

const openCreateConcept = (chapterId) => {
  modalType.value = 'concept'
  isEditMode.value = false
  activeParentId.value = chapterId
  activeId.value = null
  name.value = ''
  description.value = ''
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

// --- Edit Actions ---
const openEditSubject = (subject) => {
  modalType.value = 'subject'
  isEditMode.value = true
  activeId.value = subject.id
  name.value = subject.name
  description.value = subject.description || ''
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

const openEditChapter = (chapter) => {
  modalType.value = 'chapter'
  isEditMode.value = true
  activeId.value = chapter.id
  name.value = chapter.name
  description.value = chapter.description || ''
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

const openEditConcept = (concept) => {
  modalType.value = 'concept'
  isEditMode.value = true
  activeId.value = concept.id
  name.value = concept.name
  description.value = concept.description || ''
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

// --- Submit Save handler ---
const handleSave = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if (!name.value || name.value.trim() === '') {
    errorMessage.value = 'Name field is required.'
    return
  }

  const payload = { name: name.value, description: description.value }

  try {
    if (isEditMode.value) {
      if (modalType.value === 'subject') {
        await api.put(`/subjects/${activeId.value}`, payload)
      } else if (modalType.value === 'chapter') {
        await api.put(`/subjects/chapters/${activeId.value}`, payload)
      } else if (modalType.value === 'concept') {
        await api.put(`/subjects/concepts/${activeId.value}`, payload)
      }
      successMessage.value = `${modalType.value.charAt(0).toUpperCase() + modalType.value.slice(1)} updated successfully.`
    } else {
      if (modalType.value === 'subject') {
        const res = await api.post('/subjects', payload)
        // Automatically expand new subjects
        expandedSubjects.value[res.data.subject.id] = true
      } else if (modalType.value === 'chapter') {
        const res = await api.post(`/subjects/${activeParentId.value}/chapters`, payload)
        expandedChapters.value[res.data.chapter.id] = true
      } else if (modalType.value === 'concept') {
        await api.post(`/subjects/chapters/${activeParentId.value}/concepts`, payload)
      }
      successMessage.value = `New ${modalType.value} added successfully.`
    }

    isModalOpen.value = false
    await fetchSubjects()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to save category.'
  }
}

const handleDelete = async (type, id) => {
  const ok = await confirmationStore.ask({
    title: `Delete ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    message: `Are you sure you want to delete this ${type}? Deleting it will also remove all nested chapters, concepts, or associated question relations.`,
    confirmText: 'Delete',
    isDanger: true
  })
  if (ok) {
    errorMessage.value = ''
    successMessage.value = ''
    try {
      if (type === 'subject') {
        await api.delete(`/subjects/${id}`)
      } else if (type === 'chapter') {
        await api.delete(`/subjects/chapters/${id}`)
      } else if (type === 'concept') {
        await api.delete(`/subjects/concepts/${id}`)
      }
      successMessage.value = `${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully.`
      await fetchSubjects()
    } catch (err) {
      errorMessage.value = err.response?.data?.error || `Failed to delete ${type}.`
    }
  }
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
        <router-link to="/test-papers" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          Test Papers
        </router-link>
        <router-link to="/assessment-builder" class="nav-item" v-if="userRole === 'ADMIN' || userRole === 'TEACHER'">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h6"/><path d="M9 15h3"/></svg>
          Assessment Builder
        </router-link>
        <router-link to="/subjects" class="nav-item active">
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
      <header class="header">
        <h2 class="page-title">Subject & Category Taxonomy</h2>
        <div class="header-actions">
          <button class="btn btn-primary btn-sm" @click="openCreateSubject" v-if="canWrite">+ Add Subject</button>
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

        <div v-if="loading && subjects.length === 0" class="spinner-container">
          <div class="spinner"></div>
          <div class="spinner-text">Loading taxonomy maps...</div>
        </div>

        <div v-else-if="subjects.length === 0" style="padding: 4rem; text-align: center; color: var(--text-secondary);" class="section-card">
          No subjects registered in system yet. Click "+ Add Subject" to get started.
        </div>

        <!-- Subject Tree Wrapper -->
        <div v-else class="tree-container">
          <!-- Loop Subjects -->
          <div v-for="sub in subjects" :key="sub.id" class="tree-node subject-node">
            <div class="node-header">
              <div class="node-title-wrapper" @click="toggleSubject(sub.id)">
                <!-- Expander Icon -->
                <span class="expand-icon" :class="{ 'expanded': expandedSubjects[sub.id] }">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </span>
                <span class="node-type-label badge badge-admin" style="font-size: 0.7rem; margin-right: 0.5rem;">Subject</span>
                <span class="node-title">{{ sub.name }}</span>
                <span class="node-desc" v-if="sub.description">- {{ sub.description }}</span>
              </div>
              <div class="node-actions" v-if="canWrite">
                <button class="node-btn" @click="openCreateChapter(sub.id)" title="Add Chapter Under Subject">
                  + Add Chapter
                </button>
                <button class="node-btn edit-btn" @click="openEditSubject(sub)" title="Edit Subject">Edit</button>
                <button class="node-btn delete-btn" @click="handleDelete('subject', sub.id)" title="Delete Subject">Delete</button>
              </div>
            </div>

            <!-- Subject Chapters (Conditional Expand) -->
            <div v-if="expandedSubjects[sub.id]" class="node-children">
              <div v-if="!sub.chapters || sub.chapters.length === 0" class="empty-child-msg">
                No chapters added to this subject yet.
              </div>
              
              <!-- Loop Chapters -->
              <div v-for="chap in sub.chapters" :key="chap.id" class="tree-node chapter-node">
                <div class="node-header">
                  <div class="node-title-wrapper" @click="toggleChapter(chap.id)">
                    <span class="expand-icon" :class="{ 'expanded': expandedChapters[chap.id] }">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </span>
                    <span class="node-type-label badge badge-teacher" style="font-size: 0.7rem; margin-right: 0.5rem;">Chapter</span>
                    <span class="node-title">{{ chap.name }}</span>
                    <span class="node-desc" v-if="chap.description">- {{ chap.description }}</span>
                  </div>
                  <div class="node-actions" v-if="canWrite">
                    <button class="node-btn" @click="openCreateConcept(chap.id)" title="Add Concept Under Chapter">
                      + Add Concept
                    </button>
                    <button class="node-btn edit-btn" @click="openEditChapter(chap)" title="Edit Chapter">Edit</button>
                    <button class="node-btn delete-btn" @click="handleDelete('chapter', chap.id)" title="Delete Chapter">Delete</button>
                  </div>
                </div>

                <!-- Chapter Concepts (Conditional Expand) -->
                <div v-if="expandedChapters[chap.id]" class="node-children concept-list">
                  <div v-if="!chap.concepts || chap.concepts.length === 0" class="empty-child-msg">
                    No concepts added to this chapter yet.
                  </div>

                  <!-- Loop Concepts -->
                  <div v-for="conc in chap.concepts" :key="conc.id" class="tree-node concept-node">
                    <div class="node-header" style="border-bottom: none;">
                      <div class="node-title-wrapper">
                        <span class="node-type-label badge badge-support" style="font-size: 0.7rem; margin-right: 0.5rem;">Concept</span>
                        <span class="node-title">{{ conc.name }}</span>
                        <span class="node-desc" v-if="conc.description">- {{ conc.description }}</span>
                      </div>
                      <div class="node-actions" v-if="canWrite">
                        <button class="node-btn edit-btn" @click="openEditConcept(conc)" title="Edit Concept">Edit</button>
                        <button class="node-btn delete-btn" @click="handleDelete('concept', conc.id)" title="Delete Concept">Delete</button>
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

    <!-- Create/Edit Taxonomy Modal -->
    <div v-if="isModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem;">
      <div class="auth-card fade-in-el" style="max-width: 500px; padding: 2.5rem; box-shadow: var(--shadow-lg);">
        <div class="auth-header" style="margin-bottom: 2rem; text-align: left;">
          <h2 class="auth-title">
            {{ isEditMode ? 'Edit ' + modalType : 'Add New ' + modalType }}
          </h2>
          <p class="auth-subtitle">Configure category taxonomy configurations</p>
        </div>

        <form @submit.prevent="handleSave">
          <div class="form-group">
            <label for="name" class="form-label">Category Name</label>
            <input id="name" v-model="name" type="text" class="form-input" placeholder="e.g. Physics, Trigonometry, Optics" required />
          </div>

          <div class="form-group">
            <label for="description" class="form-label">Description (Optional)</label>
            <textarea id="description" v-model="description" class="form-input" placeholder="Describe the focus area..." style="resize: vertical; min-height: 80px;"></textarea>
          </div>

          <div style="display: flex; gap: 1rem; margin-top: 2rem;">
            <button type="button" class="btn btn-secondary" @click="isModalOpen = false">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.tree-node {
  background-color: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-fast);
}

.node-header {
  padding: 1rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.node-title-wrapper {
  display: flex;
  align-items: center;
  flex: 1;
  cursor: pointer;
  user-select: none;
}

.expand-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 0.75rem;
  color: var(--text-secondary);
  transition: transform var(--transition-fast);
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.node-title {
  font-weight: 600;
  font-size: 1.05rem;
}

.node-desc {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-left: 0.75rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 350px;
}

.node-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.node-btn {
  background-color: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
  color: #a5b4fc;
  font-weight: 500;
  font-size: 0.8rem;
  padding: 0.35rem 0.7rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.node-btn:hover {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

.node-btn.edit-btn {
  background-color: transparent;
  border-color: var(--border-color);
  color: var(--text-secondary);
}

.node-btn.edit-btn:hover {
  background-color: var(--bg-card-hover);
  color: var(--text-primary);
}

.node-btn.delete-btn {
  background-color: transparent;
  border-color: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
}

.node-btn.delete-btn:hover {
  background-color: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
}

.node-children {
  padding: 0.5rem 1.5rem 1.5rem 2.5rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  background-color: rgba(0, 0, 0, 0.05);
}

.empty-child-msg {
  color: var(--text-muted);
  font-size: 0.85rem;
  padding: 0.5rem 0;
}

/* Chapter Customizations */
.chapter-node {
  background-color: rgba(255, 255, 255, 0.01);
}

.chapter-node .node-header {
  padding: 0.75rem 1.25rem;
}

.chapter-node .node-title {
  font-size: 0.975rem;
}

.chapter-node .node-children {
  padding: 0.5rem 1.25rem 1.25rem 2rem;
}

/* Concept Customizations */
.concept-node {
  background-color: transparent;
  border: none;
  box-shadow: none;
  border-left: 2px solid var(--border-color);
  border-radius: 0;
}

.concept-node:hover {
  border-left-color: var(--primary);
}

.concept-node .node-header {
  padding: 0.4rem 1rem;
}

.concept-node .node-title {
  font-size: 0.9rem;
  font-weight: 500;
}

@media (max-width: 768px) {
  .node-header {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
    padding: 0.85rem 1rem !important;
  }
  
  .node-title-wrapper {
    width: 100%;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .node-title {
    font-size: 0.95rem !important;
  }
  
  .node-desc {
    white-space: normal;
    max-width: 100%;
    margin-left: 0 !important;
    padding-left: 2.25rem;
    margin-top: 0.25rem;
    display: block;
    width: 100%;
  }
  
  .node-actions {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-left: 2.25rem;
  }
  
  .node-btn {
    flex: 1 1 auto;
    text-align: center;
    justify-content: center;
    font-size: 0.75rem !important;
    padding: 0.4rem 0.6rem !important;
  }
  
  .node-children {
    padding: 0.5rem 0.5rem 1rem 1rem !important;
    gap: 0.5rem;
  }
  
  .chapter-node .node-children {
    padding: 0.5rem 0.5rem 1rem 0.75rem !important;
  }
  
  .concept-node .node-header {
    padding: 0.5rem 0.75rem !important;
  }
}
</style>
