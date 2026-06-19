<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api from '../services/api'

const router = useRouter()
const authStore = useAuthStore()

const user = computed(() => authStore.user)
const userRole = computed(() => authStore.userRole)
const frameKey = ref(0)
const workflowFrameRef = ref(null)
const workflowUrl = ref('/extraction/')
const workflowStatus = ref('checking')
const workflowServices = ref([])
const workflowStatusTimer = ref(null)
const workflowCheckedAt = ref(null)
const workflowStatusPollMs = Number(
  import.meta.env.VITE_EXTRACTION_STATUS_POLL_MS ||
  30000
)

const workflowStatusLabel = computed(() => {
  if (workflowStatus.value === 'online') return 'Online'
  if (workflowStatus.value === 'offline') return 'Offline'
  return 'Checking'
})

const workflowStatusTitle = computed(() => {
  if (!workflowServices.value.length) return 'Checking extraction services'

  const serviceLines = workflowServices.value
    .map((service) => `${service.service}: ${service.online ? 'online' : 'offline'}`)
    .join('\n')
  const checkedAt = workflowCheckedAt.value
    ? `\nChecked: ${new Date(workflowCheckedAt.value).toLocaleTimeString()}`
    : ''

  return `${serviceLines}${checkedAt}`
})

const fetchWorkflowStatus = async () => {
  try {
    const response = await api.get('/extraction/status')
    workflowStatus.value = response.data?.online ? 'online' : 'offline'
    workflowServices.value = response.data?.services || []
    workflowCheckedAt.value = response.data?.checkedAt || new Date().toISOString()
  } catch {
    workflowStatus.value = 'offline'
    workflowServices.value = []
    workflowCheckedAt.value = new Date().toISOString()
  }
}

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}

const refreshWorkflow = () => {
  workflowUrl.value = getCurrentWorkflowUrl()
  frameKey.value += 1
  void fetchWorkflowStatus()
}

const getCurrentWorkflowUrl = () => {
  try {
    const frameLocation = workflowFrameRef.value?.contentWindow?.location
    if (frameLocation?.pathname?.startsWith('/extraction')) {
      return `${frameLocation.pathname}${frameLocation.search}${frameLocation.hash}`
    }
  } catch {
    // Cross-origin frame access is not expected here, but keep a stable fallback.
  }

  return workflowUrl.value || '/extraction/'
}

const openWorkflowWindow = () => {
  window.open(getCurrentWorkflowUrl(), '_blank', 'noopener,noreferrer')
}

onMounted(() => {
  void fetchWorkflowStatus()
  workflowStatusTimer.value = window.setInterval(fetchWorkflowStatus, workflowStatusPollMs)
})

onBeforeUnmount(() => {
  if (workflowStatusTimer.value) window.clearInterval(workflowStatusTimer.value)
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
        <router-link to="/extraction" class="nav-item active">
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
            {{ user?.name ? user.name.charAt(0) : 'U' }}
          </div>
          <div class="user-info">
            <span class="user-name" :title="user?.name">{{ user?.name || 'User Name' }}</span>
            <span class="user-role badge" :class="`badge-${userRole?.toLowerCase()}`">{{ userRole || 'TEACHER' }}</span>
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" @click="handleLogout">
          Sign Out
        </button>
      </div>
    </aside>

    <main class="main-content extraction-main">
      <header class="header">
        <h2 class="page-title">Extraction</h2>
        <div class="header-actions">
          <span
            class="extraction-status-pill"
            :class="`is-${workflowStatus}`"
            :title="workflowStatusTitle"
          >
            {{ workflowStatusLabel }}
          </span>
          <button class="btn btn-secondary btn-sm" type="button" @click="refreshWorkflow">
            Refresh
          </button>
          <button class="btn btn-primary btn-sm" type="button" @click="openWorkflowWindow">
            Open Full Page
          </button>
        </div>
      </header>

      <div class="content-body extraction-body">
        <iframe
          ref="workflowFrameRef"
          :key="frameKey"
          class="extraction-frame"
          :src="workflowUrl"
          title="Extraction"
        ></iframe>
      </div>
    </main>
  </div>
</template>

<style scoped>
.extraction-main {
  min-height: 100vh;
}

.extraction-body {
  display: flex;
  min-height: calc(100vh - 70px);
  padding: 0;
}

.extraction-frame {
  width: 100%;
  min-height: calc(100vh - 70px);
  border: 0;
  background: #ffffff;
}

.extraction-status-pill {
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.38);
  border-radius: 8px;
  display: inline-flex;
  font-size: 0.83rem;
  font-weight: 800;
  justify-content: center;
  line-height: 1;
  min-height: 36px;
  min-width: 84px;
  padding: 0 1rem;
}

.extraction-status-pill.is-online {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.36);
  color: #047857;
}

.extraction-status-pill.is-offline {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(248, 113, 113, 0.34);
  color: #b91c1c;
}

.extraction-status-pill.is-checking {
  background: rgba(148, 163, 184, 0.1);
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .extraction-body,
  .extraction-frame {
    min-height: calc(100dvh - var(--mobile-header-height));
  }

  .header-actions {
    gap: 0.5rem;
  }
}
</style>
