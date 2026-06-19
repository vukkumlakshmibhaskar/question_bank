<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import api from '../services/api'
import { PAGE_SIZE_OPTIONS, createPagination, unpackPaginated } from '../utils/pagination'

const router = useRouter()
const authStore = useAuthStore()
const userRole = computed(() => authStore.userRole)

const reviews = ref([])
const loading = ref(false)
const errorMessage = ref('')
const filterStatus = ref('ALL') // 'ALL', 'PENDING', 'APPROVED', 'REJECTED'
const pagination = ref(createPagination(10))

onMounted(async () => {
  await fetchReviews()
})

const fetchReviews = async (page = pagination.value.page) => {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await api.get('/reviews', {
      params: {
        page,
        pageSize: pagination.value.pageSize,
        status: filterStatus.value,
      },
    })
    const unpacked = unpackPaginated(response.data, {
      ...pagination.value,
      page,
    })
    reviews.value = unpacked.rows
    pagination.value = unpacked.pagination
  } catch (err) {
    errorMessage.value = err.response?.data?.error || 'Failed to fetch reviews list.'
  } finally {
    loading.value = false
  }
}

const filteredReviews = computed(() => {
  return reviews.value
})

const setStatusFilter = async (status) => {
  filterStatus.value = status
  await fetchReviews(1)
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
  })
}

const getStatusClass = (status) => {
  switch (status) {
    case 'APPROVED': return 'badge-approved'
    case 'REJECTED': return 'badge-rejected'
    case 'PENDING':
    default:
      return 'badge-pending'
  }
}

const getFileIcon = (mimeType) => {
  if (mimeType && mimeType.includes('pdf')) return '📄'
  return '📁'
}

const openReview = (id) => {
  router.push(`/reviews/${id}`)
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
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sign Out
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <main class="main-content">
      <header class="header">
        <h2 class="page-title">Extraction Reviews</h2>
        <div class="header-actions">
          <span>Logged in as: <strong>{{ authStore.user?.email }}</strong></span>
        </div>
      </header>

      <div class="content-body fade-in-el">
        <!-- Messages -->
        <div v-if="errorMessage" class="alert alert-error" style="margin-bottom: 1.5rem;">
          <span>{{ errorMessage }}</span>
        </div>

        <!-- Filter Bar -->
        <div class="section-card" style="margin-bottom: 2rem; padding: 1.25rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
            <div style="display: flex; align-items: center; gap: 0.75rem;">
              <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: 500;">Filter by Status:</span>
              <div style="display: flex; background-color: var(--bg-app); border: 1px solid var(--border-color); padding: 2px; border-radius: var(--radius-sm);">
                <button 
                  v-for="st in ['ALL', 'PENDING', 'APPROVED', 'REJECTED']" 
                  :key="st"
                  class="btn btn-sm" 
                  style="border: none; padding: 0.4rem 1rem; font-size: 0.8rem;"
                  :class="filterStatus === st ? 'btn-primary' : 'btn-secondary'"
                  @click="setStatusFilter(st)"
                >
                  {{ st }}
                </button>
              </div>
            </div>
            
            <button class="btn btn-secondary btn-sm" @click="fetchReviews()" :disabled="loading" style="display: inline-flex; align-items: center; gap: 0.5rem; width: auto;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" :style="loading ? 'animation: spin 1s linear infinite' : ''"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh List
            </button>
          </div>
        </div>

        <!-- Table Grid -->
        <div class="section-card" style="padding: 0; overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); background-color: rgba(255, 255, 255, 0.02);">
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem; width: 60px;">ID</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Source Document</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Status</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Uploaded On</th>
                <th style="padding: 1rem 1.5rem; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Reviewed By</th>
                <th style="padding: 1rem 1.5rem; text-align: right; color: var(--text-secondary); font-weight: 600; font-size: 0.875rem;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading" style="border-bottom: 1px solid var(--border-color);">
                <td colspan="6" style="padding: 2.5rem 0;">
                  <div class="spinner-container" style="padding: 1rem;">
                    <div class="spinner" style="width: 30px; height: 30px; border-width: 2.5px;"></div>
                    <div class="spinner-text" style="font-size: 0.85rem;">Fetching document extraction logs...</div>
                  </div>
                </td>
              </tr>
              <tr v-else-if="filteredReviews.length === 0" style="border-bottom: 1px solid var(--border-color);">
                <td colspan="6" style="padding: 4rem; text-align: center; color: var(--text-secondary);">
                  <p style="font-size: 1.1rem; font-weight: 500; margin-bottom: 0.25rem;">No reviews found.</p>
                  <p style="font-size: 0.85rem; color: var(--text-muted);">Uploaded PDF materials will appear here once parsed by AI.</p>
                </td>
              </tr>
              <tr v-else v-for="review in filteredReviews" :key="review.id" style="border-bottom: 1px solid var(--border-color); transition: background var(--transition-fast);" hover-bg>
                <td data-label="ID" style="padding: 1.25rem 1.5rem; font-weight: 600; color: var(--text-muted);">#{{ review.id }}</td>
                <td data-label="Source Document" style="padding: 1.25rem 1.5rem;">
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span style="font-size: 1.2rem;">{{ getFileIcon(review.uploadFile?.mimeType) }}</span>
                    <div style="display: flex; flex-direction: column;">
                      <span style="font-weight: 500; color: var(--text-primary);">{{ review.uploadFile?.fileName }}</span>
                      <span style="font-size: 0.75rem; color: var(--text-secondary);">{{ (review.uploadFile?.fileSize / 1024).toFixed(1) }} KB</span>
                    </div>
                  </div>
                </td>
                <td data-label="Status" style="padding: 1.25rem 1.5rem;">
                  <span class="badge" :class="getStatusClass(review.status)">
                    {{ review.status }}
                  </span>
                </td>
                <td data-label="Uploaded On" style="padding: 1.25rem 1.5rem; color: var(--text-secondary); font-size: 0.85rem;">
                  {{ formatDate(review.createdAt) }}
                </td>
                <td data-label="Reviewed By" style="padding: 1.25rem 1.5rem; color: var(--text-secondary); font-size: 0.85rem;">
                  <span v-if="review.reviewedBy" :title="review.reviewedBy.email">
                    {{ review.reviewedBy.name }}
                  </span>
                  <span v-else style="color: var(--text-muted); font-style: italic;">Not Reviewed</span>
                </td>
                <td data-label="Actions" style="padding: 1.25rem 1.5rem; text-align: right;">
                  <button 
                    v-if="review.status === 'PENDING'"
                    class="btn btn-primary btn-sm" 
                    style="width: auto; padding: 0.4rem 1.2rem;"
                    @click="openReview(review.id)"
                  >
                    Moderate & Correct
                  </button>
                  <button 
                    v-else
                    class="btn btn-secondary btn-sm" 
                    style="width: auto; padding: 0.4rem 1.2rem;"
                    @click="openReview(review.id)"
                  >
                    View Details
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!loading && pagination.total > 0" class="pagination-row" style="margin: 0 1.25rem 1.25rem;">
            <div class="page-size-control">
              <span>{{ pagination.total }} review{{ pagination.total === 1 ? '' : 's' }}</span>
              <select v-model.number="pagination.pageSize" class="form-input" @change="fetchReviews(1)">
                <option v-for="size in PAGE_SIZE_OPTIONS" :key="size" :value="size">{{ size }} / page</option>
              </select>
            </div>
            <div class="pagination-controls">
              <button class="btn btn-secondary btn-sm" type="button" :disabled="pagination.page <= 1" @click="fetchReviews(pagination.page - 1)">Previous</button>
              <span>Page {{ pagination.page }} of {{ pagination.totalPages }}</span>
              <button class="btn btn-secondary btn-sm" type="button" :disabled="pagination.page >= pagination.totalPages" @click="fetchReviews(pagination.page + 1)">Next</button>
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

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

tr[hover-bg]:hover {
  background-color: rgba(255, 255, 255, 0.02);
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
  
  td[data-label="Actions"] .btn {
    margin: 0 !important;
    width: 100% !important;
    justify-content: center;
  }
}
</style>
