<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useNotificationStore } from '../../stores/notification'
import { useConfirmationStore } from '../../stores/confirmation'
import api from '../../services/api'

const router = useRouter()
const authStore = useAuthStore()
const notificationStore = useNotificationStore()
const confirmationStore = useConfirmationStore()

const userRole = computed(() => authStore.userRole)

const users = ref([])
const availableSubjects = ref([])
const loading = ref(false)
const subjectsLoading = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const roleOptions = ['ADMIN', 'TEACHER']

// User Modal state
const isModalOpen = ref(false)
const isEditMode = ref(false)
const selectedUserId = ref(null)

// Role Assignment Modal state
const isRolesModalOpen = ref(false)
const selectedUserRoles = ref([])

// Form fields
const name = ref('')
const email = ref('')
const password = ref('')
const startRole = ref('TEACHER')
const isActiveField = ref(true)
const selectedSubjectIds = ref([])
const editUserRoles = ref([])

const isTeacherForm = computed(() => {
  return isEditMode.value ? editUserRoles.value.includes('TEACHER') : startRole.value === 'TEACHER'
})
const selectedSubjectCount = computed(() => selectedSubjectIds.value.length)

onMounted(async () => {
  await Promise.all([fetchUsers(), fetchSubjects()])
})

const fetchUsers = async () => {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await api.get('/users')
    users.value = response.data
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to fetch users list.'
  } finally {
    loading.value = false
  }
}

const fetchSubjects = async () => {
  subjectsLoading.value = true
  try {
    const response = await api.get('/subjects')
    availableSubjects.value = response.data || []
  } catch (err) {
    notificationStore.error(err.response?.data?.error || 'Failed to load subjects.')
  } finally {
    subjectsLoading.value = false
  }
}

const normalizeSubjectIds = (subjectIds = []) =>
  subjectIds.map((id) => parseInt(id)).filter((id) => Number.isInteger(id))

const subjectSummary = (user) => {
  const subjects = user.subjects || []
  if (subjects.length === 0) return 'No subjects assigned'
  return subjects.map((subject) => subject.name).join(', ')
}

const openCreateModal = () => {
  isEditMode.value = false
  selectedUserId.value = null
  name.value = ''
  email.value = ''
  password.value = ''
  startRole.value = 'TEACHER'
  selectedSubjectIds.value = []
  editUserRoles.value = []
  isActiveField.value = true
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

const openEditModal = (user) => {
  isEditMode.value = true
  selectedUserId.value = user.id
  name.value = user.name
  email.value = user.email
  password.value = '' // Clear for security
  selectedSubjectIds.value = normalizeSubjectIds(user.subjectIds || [])
  editUserRoles.value = [...(user.roles || [])]
  isActiveField.value = user.isActive
  errorMessage.value = ''
  successMessage.value = ''
  isModalOpen.value = true
}

const handleSaveUser = async () => {
  errorMessage.value = ''
  successMessage.value = ''

  if (!name.value || !email.value || (!isEditMode.value && !password.value)) {
    errorMessage.value = 'Please fill out all required fields.'
    return
  }

  if (isTeacherForm.value && selectedSubjectIds.value.length === 0) {
    errorMessage.value = 'Please assign at least one subject to this teacher.'
    return
  }

  try {
    if (isEditMode.value) {
      const payload = { name: name.value, email: email.value }
      if (password.value) payload.password = password.value
      if (isTeacherForm.value) payload.subjectIds = selectedSubjectIds.value

      await api.put(`/users/${selectedUserId.value}`, payload)
      successMessage.value = 'User profile updated successfully.'
    } else {
      await api.post('/users', {
        name: name.value,
        email: email.value,
        password: password.value,
        role: startRole.value,
        subjectIds: startRole.value === 'TEACHER' ? selectedSubjectIds.value : [],
      })
      successMessage.value = 'New user account created successfully.'
    }

    isModalOpen.value = false
    await fetchUsers()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to save user.'
  }
}

const handleToggleActive = async (user) => {
  errorMessage.value = ''
  successMessage.value = ''
  const action = user.isActive ? 'disable' : 'activate'
  try {
    await api.patch(`/users/${user.id}/${action}`)
    successMessage.value = `User account ${user.isActive ? 'deactivated' : 'activated'} successfully.`
    await fetchUsers()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to update user status.'
  }
}

const handleDeleteUser = async (userId) => {
  const ok = await confirmationStore.ask({
    title: 'Delete User Account',
    message: 'Are you sure you want to delete this user account? This cannot be undone.',
    confirmText: 'Delete',
    isDanger: true
  })
  if (ok) {
    errorMessage.value = ''
    successMessage.value = ''
    try {
      await api.delete(`/users/${userId}`)
      successMessage.value = 'User account deleted successfully.'
      await fetchUsers()
    } catch (err) {
      errorMessage.value = err.response?.data?.error || 'Failed to delete user.'
    }
  }
}

// --- Role Assignment Modals & Handlers ---
const openRolesModal = (user) => {
  selectedUserId.value = user.id
  selectedUserRoles.value = [...user.roles]
  errorMessage.value = ''
  successMessage.value = ''
  isRolesModalOpen.value = true
}

const handleRoleToggle = async (roleName) => {
  const hasRole = selectedUserRoles.value.includes(roleName)
  try {
    if (hasRole) {
      // Prevent self-role removal of ADMIN role
      if (selectedUserId.value === authStore.user?.id && roleName === 'ADMIN') {
        notificationStore.error("You cannot remove the ADMIN role from yourself.")
        return
      }
      await api.delete(`/users/${selectedUserId.value}/roles/${roleName}`)
      selectedUserRoles.value = selectedUserRoles.value.filter((r) => r !== roleName)
    } else {
      await api.post(`/users/${selectedUserId.value}/roles`, { role: roleName })
      selectedUserRoles.value.push(roleName)
    }
    await fetchUsers()
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to change user role.'
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
        <router-link to="/subjects" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          Subjects & Chapters
        </router-link>
<router-link to="/admin/users" class="nav-item active">
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
            <span class="user-role badge" :class="`badge-${userRole?.toLowerCase()}`">{{ userRole || 'ADMIN' }}</span>
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
        <h2 class="page-title">User Account Manager</h2>
        <div class="header-actions">
          <button class="btn btn-primary btn-sm" @click="openCreateModal">+ Create User</button>
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

        <!-- User List Table -->
        <div class="section-card" style="padding: 0; overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); background-color: rgba(255, 255, 255, 0.02);">
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Name</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Email</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Roles</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Subjects</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Status</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Joined On</th>
                <th style="padding: 1rem 1.5rem; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading" style="border-bottom: 1px solid var(--border-color);">
                <td colspan="7" style="padding: 2rem 0;">
                  <div class="spinner-container" style="padding: 1rem;">
                    <div class="spinner" style="width: 30px; height: 30px; border-width: 2.5px;"></div>
                    <div class="spinner-text" style="font-size: 0.85rem;">Loading account profiles...</div>
                  </div>
                </td>
              </tr>
              <tr v-else-if="users.length === 0" style="border-bottom: 1px solid var(--border-color);">
                <td colspan="7" style="padding: 3rem; text-align: center; color: var(--text-secondary);">
                  No user accounts registered.
                </td>
              </tr>
              <tr v-for="user in users" :key="user.id" style="border-bottom: 1px solid var(--border-color); transition: background var(--transition-fast);" hover-bg>
                <td data-label="Name" style="padding: 1rem 1.5rem; font-weight: 500;">{{ user.name }}</td>
                <td data-label="Email" style="padding: 1rem 1.5rem; color: var(--text-secondary);">{{ user.email }}</td>
                <td data-label="Roles" style="padding: 1rem 1.5rem;">
                  <div style="display: flex; gap: 0.25rem; flex-wrap: wrap;">
                    <span v-for="r in user.roles" :key="r" class="badge" :class="`badge-${r.toLowerCase()}`">{{ r }}</span>
                  </div>
                </td>
                <td data-label="Subjects" style="padding: 1rem 1.5rem; color: var(--text-secondary); max-width: 260px;">
                  <span :title="subjectSummary(user)">{{ subjectSummary(user) }}</span>
                </td>
                <td data-label="Status" style="padding: 1rem 1.5rem;">
                  <button 
                    class="badge" 
                    :disabled="user.id === authStore.user?.id"
                    style="border: none; cursor: pointer; transition: all 0.2s;"
                    :style="user.isActive ? 'background-color: rgba(16, 185, 129, 0.15); color: #a7f3d0;' : 'background-color: rgba(100, 116, 139, 0.15); color: #cbd5e1;'"
                    @click="handleToggleActive(user)"
                    title="Click to toggle status"
                  >
                    {{ user.isActive ? 'Active' : 'Disabled' }}
                  </button>
                </td>
                <td data-label="Joined On" style="padding: 1rem 1.5rem; color: var(--text-muted); font-size: 0.9rem;">
                  {{ new Date(user.createdAt).toLocaleDateString() }}
                </td>
                <td data-label="Actions" style="padding: 1rem 1.5rem; text-align: right;">
                  <button class="btn btn-secondary btn-sm" @click="openRolesModal(user)" style="width: auto; margin-right: 0.5rem; display: inline-flex;">
                    Roles
                  </button>
                  <button class="btn btn-secondary btn-sm" @click="openEditModal(user)" style="width: auto; margin-right: 0.5rem; display: inline-flex;">
                    Edit
                  </button>
                  <button 
                    class="btn btn-secondary btn-sm" 
                    @click="handleDeleteUser(user.id)" 
                    :disabled="user.id === authStore.user?.id"
                    style="width: auto; color: #fca5a5; border-color: rgba(239, 68, 68, 0.2); display: inline-flex;"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>

    <!-- Create/Edit User Modal Backdrop -->
    <div v-if="isModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem;">
      <!-- Modal Card -->
      <div class="auth-card fade-in-el" style="max-width: 560px; padding: 2.5rem; box-shadow: var(--shadow-lg);">
        <div class="auth-header" style="margin-bottom: 2rem; text-align: left;">
          <h2 class="auth-title">{{ isEditMode ? 'Edit User Profile' : 'Create User Account' }}</h2>
          <p class="auth-subtitle">Define user details, role, and teacher subject access</p>
        </div>

        <form @submit.prevent="handleSaveUser">
          <div class="form-group">
            <label for="name" class="form-label">Full Name</label>
            <input id="name" v-model="name" type="text" class="form-input" placeholder="John Doe" required />
          </div>

          <div class="form-group">
            <label for="email" class="form-label">Email Address</label>
            <input id="email" v-model="email" type="email" class="form-input" placeholder="john@example.com" required />
          </div>

          <div class="form-group">
            <label for="password" class="form-label">
              Password <span v-if="isEditMode" style="font-size: 0.8rem; color: var(--text-muted); font-weight: normal;">(Leave empty to keep current)</span>
            </label>
            <input 
              id="password" 
              v-model="password" 
              type="password" 
              class="form-input" 
              placeholder="••••••••" 
              :required="!isEditMode" 
            />
          </div>

          <div class="form-group" v-if="!isEditMode">
            <label for="role" class="form-label">Starting Role</label>
            <select id="role" v-model="startRole" class="form-input" style="appearance: auto; background-color: var(--bg-input);">
              <option v-for="role in roleOptions" :key="role" :value="role">{{ role }}</option>
            </select>
          </div>

          <div class="form-group" v-if="isTeacherForm">
            <label for="teacher-subjects" class="form-label">Assigned Subjects</label>
            <div
              id="teacher-subjects"
              class="subject-checkbox-list"
              :aria-busy="subjectsLoading"
            >
              <div v-if="subjectsLoading" class="field-help" style="padding: 0.75rem;">
                Loading subjects...
              </div>
              <div v-else-if="availableSubjects.length === 0" class="field-help" style="padding: 0.75rem;">
                No subjects available.
              </div>
              <template v-else>
                <label
                  v-for="subject in availableSubjects"
                  :key="subject.id"
                  class="subject-checkbox-row"
                >
                  <input
                    v-model="selectedSubjectIds"
                    type="checkbox"
                    :value="subject.id"
                  />
                  <span>{{ subject.name }}</span>
                </label>
              </template>
            </div>
            <span class="field-help">
              {{ selectedSubjectCount }} subject{{ selectedSubjectCount === 1 ? '' : 's' }} selected
            </span>
          </div>

          <div style="display: flex; gap: 1rem; margin-top: 2rem;">
            <button type="button" class="btn btn-secondary" @click="isModalOpen = false">Cancel</button>
            <button type="submit" class="btn btn-primary">Save Changes</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Role Assignment Modal Backdrop -->
    <div v-if="isRolesModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.65); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem;">
      <div class="auth-card fade-in-el" style="max-width: 450px; padding: 2.5rem; box-shadow: var(--shadow-lg);">
        <div class="auth-header" style="margin-bottom: 2rem; text-align: left;">
          <h2 class="auth-title">Assign Roles</h2>
          <p class="auth-subtitle">Assign or remove access privileges for this user account</p>
        </div>

        <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 2rem;">
          <label 
            v-for="r in roleOptions" 
            :key="r"
            style="display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border: 1px solid var(--border-color); border-radius: var(--radius-md); background-color: var(--bg-card); cursor: pointer;"
          >
            <input 
              type="checkbox" 
              :checked="selectedUserRoles.includes(r)" 
              @change="handleRoleToggle(r)" 
              style="width: 18px; height: 18px; accent-color: var(--primary); cursor: pointer;"
            />
            <div style="display: flex; flex-direction: column;">
              <span style="font-weight: 600; color: var(--text-primary);">{{ r }}</span>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">
                {{ r === 'ADMIN' ? 'Full system control' : 'Manage assigned subjects and questions' }}
              </span>
            </div>
          </label>
        </div>

        <div style="display: flex; justify-content: flex-end;">
          <button type="button" class="btn btn-secondary" @click="isRolesModalOpen = false" style="width: auto; padding: 0.75rem 2rem;">Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
tr[hover-bg]:hover {
  background-color: rgba(255, 255, 255, 0.015);
}

.subject-checkbox-list {
  background-color: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  display: grid;
  gap: 0.35rem;
  max-height: 168px;
  overflow-y: auto;
  padding: 0.45rem;
}

.subject-checkbox-row {
  align-items: center;
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  cursor: pointer;
  display: flex;
  gap: 0.65rem;
  min-height: 38px;
  padding: 0.45rem 0.6rem;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.subject-checkbox-row:hover {
  background: var(--nav-active-surface);
}

.subject-checkbox-row input {
  accent-color: var(--primary);
  flex: 0 0 auto;
  height: 17px;
  width: 17px;
}

.subject-checkbox-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  table, thead, tbody, th, td, tr {
    display: block;
  }
  
  thead {
    display: none;
  }
  
  tr {
    margin-bottom: 1rem;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--surface-glass);
    padding: 0.75rem 1rem;
  }
  
  td {
    display: flex !important;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 0 !important;
    border-bottom: 1px solid var(--subtle-border);
    text-align: left !important;
  }
  
  td:last-child {
    border-bottom: none;
    padding-top: 0.75rem !important;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  
  td::before {
    content: attr(data-label);
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.85rem;
    margin-right: 1rem;
  }
  
  td[data-label="Actions"]::before {
    margin-right: auto;
  }
  
  /* Reset button margins and widths on mobile */
  td[data-label="Actions"] .btn {
    margin: 0 !important;
    flex: 1 1 calc(33.333% - 0.5rem);
    min-width: 70px;
    justify-content: center;
    padding: 0.5rem 0.75rem !important;
    font-size: 0.8rem !important;
  }
}
</style>
