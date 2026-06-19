<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import api from '../../services/api'
import { PAGE_SIZE_OPTIONS, createPagination, unpackPaginated } from '../../utils/pagination'

const router = useRouter()
const authStore = useAuthStore()
const userRole = computed(() => authStore.userRole)

const logs = ref([])
const loading = ref(false)
const errorMessage = ref('')
const searchTerm = ref('')
const filterAction = ref('ALL')
const allActions = ref([])
const pagination = ref(createPagination(10))

// JSON Viewer modal
const isDetailsModalOpen = ref(false)
const selectedLog = ref(null)

onMounted(async () => {
  await fetchLogs()
})

const fetchLogs = async (page = pagination.value.page) => {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await api.get('/audit-logs', {
      params: {
        page,
        pageSize: pagination.value.pageSize,
        search: searchTerm.value.trim(),
        action: filterAction.value,
      },
    })
    const unpacked = unpackPaginated(response.data, {
      ...pagination.value,
      page,
    })
    logs.value = unpacked.rows
    pagination.value = unpacked.pagination
    allActions.value = unpacked.extra?.actions || allActions.value
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to fetch system audit logs.'
  } finally {
    loading.value = false
  }
}

// Compute available action list for filter dropdown
const uniqueActions = computed(() => {
  const actions = new Set(allActions.value.length > 0 ? allActions.value : logs.value.map(l => l.action))
  return ['ALL', ...Array.from(actions)]
})

const filteredLogs = computed(() => {
  return logs.value
})

const openDetailsModal = (log) => {
  selectedLog.value = log
  isDetailsModalOpen.value = true
}

const formatDate = (dateString) => {
  if (!dateString) return 'N/A'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

const getActionBadgeClass = (action) => {
  if (action.includes('UPLOAD')) return 'badge-upload'
  if (action.includes('APPROVE')) return 'badge-approve'
  if (action.includes('REJECT')) return 'badge-reject'
  if (action.includes('EDIT')) return 'badge-edit'
  return 'badge-default'
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
<router-link to="/reviews" class="nav-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Extraction Reviews
        </router-link>
<router-link to="/admin/audit-logs" class="nav-item active" v-if="userRole === 'ADMIN'">
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
      <header class="header">
        <h2 class="page-title">System Audit Trails</h2>
        <div class="header-actions">
          <span>Logged in as: <strong>{{ authStore.user?.email }}</strong></span>
        </div>
      </header>

      <div class="content-body fade-in-el">
        <!-- Error Alerts -->
        <div v-if="errorMessage" class="alert alert-error" style="margin-bottom: 1.5rem;">
          <span>{{ errorMessage }}</span>
        </div>

        <!-- Filter controls -->
        <div class="section-card" style="margin-bottom: 2rem; padding: 1.25rem;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem;">
            <div>
              <label class="form-label">Search User or Entity</label>
              <input v-model="searchTerm" class="form-input" placeholder="Search by name, email, action..." style="margin-bottom: 0;" @keyup.enter="fetchLogs(1)" />
            </div>

            <div>
              <label class="form-label">Filter by Action</label>
              <select v-model="filterAction" class="form-input" style="margin-bottom: 0; appearance: auto; background-color: var(--bg-input);" @change="fetchLogs(1)">
                <option v-for="act in uniqueActions" :key="act" :value="act">{{ act }}</option>
              </select>
            </div>

            <div style="display: flex; align-items: flex-end;">
              <button class="btn btn-secondary btn-sm" @click="fetchLogs()" :disabled="loading" style="display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; width: auto; padding: 0.75rem 1.5rem;">
                Refresh Trails
              </button>
            </div>
          </div>
        </div>

        <!-- Audit log Table -->
        <div class="section-card" style="padding: 0; overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); background-color: rgba(255, 255, 255, 0.02);">
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Timestamp</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Performed By</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Action</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Entity Affected</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem; text-align: right;">Diff Changes</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading" style="border-bottom: 1px solid var(--border-color);">
                <td colspan="5" style="padding: 2.5rem 0;">
                  <div class="spinner-container" style="padding: 1rem;">
                    <div class="spinner" style="width: 30px; height: 30px; border-width: 2.5px;"></div>
                    <div class="spinner-text" style="font-size: 0.85rem;">Loading audit database trails...</div>
                  </div>
                </td>
              </tr>
              <tr v-else-if="filteredLogs.length === 0" style="border-bottom: 1px solid var(--border-color);">
                <td colspan="5" style="padding: 4rem; text-align: center; color: var(--text-secondary);">
                  No audit trail matches found.
                </td>
              </tr>
              <tr v-else v-for="log in filteredLogs" :key="log.id" style="border-bottom: 1px solid var(--border-color); transition: background var(--transition-fast);" hover-bg>
                <td style="padding: 1rem 1.5rem; font-size: 0.85rem; color: var(--text-secondary);">
                  {{ formatDate(log.createdAt) }}
                </td>
                <td style="padding: 1rem 1.5rem;">
                  <div v-if="log.user" style="display: flex; flex-direction: column;">
                    <span style="font-weight: 500;">{{ log.user.name }}</span>
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">{{ log.user.email }}</span>
                  </div>
                  <span v-else style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">System Cron / Hook</span>
                </td>
                <td style="padding: 1rem 1.5rem;">
                  <span class="badge" :class="getActionBadgeClass(log.action)">
                    {{ log.action }}
                  </span>
                </td>
                <td style="padding: 1rem 1.5rem; font-size: 0.9rem;">
                  <span style="font-weight: 500; color: var(--text-primary);">{{ log.entityType }}</span>
                  <span style="color: var(--text-muted); font-size: 0.8rem; margin-left: 0.25rem;">#{{ log.entityId }}</span>
                </td>
                <td style="padding: 1rem 1.5rem; text-align: right;">
                  <button 
                    v-if="log.oldValue || log.newValue"
                    class="btn btn-secondary btn-sm" 
                    style="width: auto; padding: 0.25rem 0.75rem; font-size: 0.8rem;"
                    @click="openDetailsModal(log)"
                  >
                    Compare Changes
                  </button>
                  <span v-else style="font-size: 0.8rem; color: var(--text-muted); font-style: italic;">No value payload</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!loading && pagination.total > 0" class="pagination-row" style="margin: 0 1.25rem 1.25rem;">
            <div class="page-size-control">
              <span>{{ pagination.total }} trail{{ pagination.total === 1 ? '' : 's' }}</span>
              <select v-model.number="pagination.pageSize" class="form-input" @change="fetchLogs(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="pagination.page <= 1" @click="fetchLogs(pagination.page - 1)">Previous</button>
              <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="pagination.page >= pagination.totalPages" @click="fetchLogs(pagination.page + 1)">Next</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Changes Inspector Modal -->
  <div v-if="isDetailsModalOpen" style="position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.75); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 2rem;">
    <div class="auth-card fade-in-el" style="max-width: 800px; width: 100%; padding: 2.5rem; box-shadow: var(--shadow-lg); max-height: 85vh; display: flex; flex-direction: column;">
      <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem;">Audit Trail Comparison</h3>
      <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 1.5rem;">
        Action: <strong>{{ selectedLog?.action }}</strong> on {{ selectedLog?.entityType }} #{{ selectedLog?.entityId }} by {{ selectedLog?.user?.email || 'System' }}
      </p>

      <div style="flex: 1; overflow-y: auto; display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 2rem;">
        <div>
          <span class="detail-label" style="margin-bottom: 0.5rem; color: var(--error);">Old Value (Pre-State)</span>
          <pre style="background-color: var(--bg-app); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-sm); font-size: 0.8rem; color: var(--text-secondary); overflow-x: auto; max-height: 350px; line-height: 1.4; white-space: pre-wrap;">{{ selectedLog?.oldValue ? JSON.stringify(selectedLog.oldValue, null, 2) : 'NULL' }}</pre>
        </div>

        <div>
          <span class="detail-label" style="margin-bottom: 0.5rem; color: var(--success);">New Value (Post-State)</span>
          <pre style="background-color: var(--bg-app); border: 1px solid var(--border-color); padding: 1rem; border-radius: var(--radius-sm); font-size: 0.8rem; color: var(--text-primary); overflow-x: auto; max-height: 350px; line-height: 1.4; white-space: pre-wrap;">{{ selectedLog?.newValue ? JSON.stringify(selectedLog.newValue, null, 2) : 'NULL' }}</pre>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button class="btn btn-secondary" style="width: auto; padding: 0.75rem 2rem;" @click="isDetailsModalOpen = false">Close Inspector</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.badge-upload {
  background-color: rgba(99, 102, 241, 0.12);
  color: #a5b4fc;
  border: 1px solid rgba(99, 102, 241, 0.25);
  border-radius: 9999px;
}
.badge-approve {
  background-color: rgba(16, 185, 129, 0.12);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 9999px;
}
.badge-reject {
  background-color: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 9999px;
}
.badge-edit {
  background-color: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 9999px;
}
.badge-default {
  background-color: rgba(148, 163, 184, 0.12);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.25);
  border-radius: 9999px;
}

tr[hover-bg] {
  transition: background-color var(--transition-fast);
}

tr[hover-bg]:hover {
  background-color: rgba(255, 255, 255, 0.035) !important;
}

.detail-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

pre {
  background-color: var(--bg-app) !important;
  border: 1px solid var(--subtle-border) !important;
  font-family: 'Fira Code', 'Courier New', Courier, monospace;
  box-shadow: inset 0 2px 8px 0 rgba(0, 0, 0, 0.3);
}
</style>
