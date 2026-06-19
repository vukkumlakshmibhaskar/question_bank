<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import GlassSettings from './components/GlassSettings.vue'
import ThemeSwitcher from './components/ThemeSwitcher.vue'
import { useNotificationStore } from './stores/notification'
import { useConfirmationStore } from './stores/confirmation'

const notificationStore = useNotificationStore()
const confirmationStore = useConfirmationStore()
const route = useRoute()

const showShellControls = computed(() => Boolean(route.meta.requiresAuth))
const isDesktopSidebarCollapsed = ref(false)

const closeMobileSidebar = () => {
  document.body.classList.remove('sidebar-open')
}

const toggleSidebar = () => {
  if (window.innerWidth <= 768) {
    isDesktopSidebarCollapsed.value = false
    document.body.classList.toggle('sidebar-open')
  } else {
    document.body.classList.remove('sidebar-open')
    isDesktopSidebarCollapsed.value = !isDesktopSidebarCollapsed.value
  }
}

const syncSidebarModeState = () => {
  if (window.innerWidth <= 768) {
    isDesktopSidebarCollapsed.value = false
  } else {
    document.body.classList.remove('sidebar-open')
  }
  document.body.classList.remove('sidebar-collapsed')
}

onMounted(() => {
  syncSidebarModeState()
  window.addEventListener('resize', syncSidebarModeState)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncSidebarModeState)
})

watch(
  () => route.fullPath,
  () => {
    closeMobileSidebar()
    if (!showShellControls.value) {
      isDesktopSidebarCollapsed.value = false
    }
  },
)
</script>

<template>
  <div class="app-shell" :class="{ 'is-sidebar-collapsed': isDesktopSidebarCollapsed }">
    <div v-if="showShellControls" class="mobile-header">
      <button
        type="button"
        class="menu-toggle-btn"
        title="Toggle Menu"
        aria-label="Toggle menu"
        @click="toggleSidebar"
      >
        &#9776;
      </button>
      <span class="mobile-brand">QBank Platform</span>
    </div>

    <button
      v-if="showShellControls"
      type="button"
      class="menu-toggle-btn desktop-sidebar-toggle"
      title="Toggle Menu"
      aria-label="Toggle menu"
      @click="toggleSidebar"
    >
      &#9776;
    </button>

    <router-view v-slot="{ Component, route }">
      <component :is="Component" :key="route.path" />
    </router-view>

    <div v-if="showShellControls" class="sidebar-overlay" @click="closeMobileSidebar"></div>

    <ThemeSwitcher v-if="showShellControls" />
    <GlassSettings :key="route.path" :show-trigger="showShellControls" />

    <!-- Global Toast Notifications Container -->
    <div class="toast-container" aria-live="assertive">
      <transition-group name="toast-slide">
        <div
          v-for="toast in notificationStore.toasts"
          :key="toast.id"
          :class="['toast-item', `toast-${toast.type}`]"
          role="alert"
        >
          <span class="toast-icon">
            <!-- Success Icon -->
            <svg v-if="toast.type === 'success'" viewBox="0 0 20 20" fill="currentColor" class="icon-svg">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
            <!-- Error Icon -->
            <svg v-else-if="toast.type === 'error'" viewBox="0 0 20 20" fill="currentColor" class="icon-svg">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
            </svg>
            <!-- Warning Icon -->
            <svg v-else-if="toast.type === 'warning'" viewBox="0 0 20 20" fill="currentColor" class="icon-svg">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
            <!-- Info Icon -->
            <svg v-else viewBox="0 0 20 20" fill="currentColor" class="icon-svg">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
            </svg>
          </span>
          <div class="toast-message">{{ toast.message }}</div>
          <button @click="notificationStore.remove(toast.id)" class="toast-close-btn" aria-label="Close message">&times;</button>
          <div class="toast-progress" :style="{ animationDuration: (toast.duration || 4000) + 'ms' }"></div>
        </div>
      </transition-group>
    </div>

    <!-- Global Confirmation Modal -->
    <div v-if="confirmationStore.isOpen" class="confirm-modal-overlay">
      <div class="confirm-modal-box">
        <h3 class="confirm-title">{{ confirmationStore.title }}</h3>
        <p class="confirm-message">{{ confirmationStore.message }}</p>
        <div class="confirm-actions">
          <button @click="confirmationStore.cancel" class="btn-cancel">
            {{ confirmationStore.cancelText }}
          </button>
          <button
            @click="confirmationStore.confirm"
            :class="['btn-confirm', { 'btn-danger': confirmationStore.isDanger }]"
          >
            {{ confirmationStore.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style>
/* Page transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Toast Notification Styling */
.toast-container {
  position: fixed;
  top: 1.5rem;
  right: 1.5rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 380px;
  width: 100%;
  pointer-events: none;
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  padding-bottom: calc(1rem + 3px);
  border-radius: 12px;
  box-shadow: var(--glass-shadow-sm), var(--glass-highlight-strong);
  background: var(--glass-panel);
  backdrop-filter: var(--glass-blur-soft);
  -webkit-backdrop-filter: var(--glass-blur-soft);
  border: 1px solid var(--glass-border);
  color: var(--text-primary);
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 0.875rem;
  line-height: 1.25rem;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

.toast-success {
  background:
    linear-gradient(180deg, rgba(16, 185, 129, 0.18), var(--surface-glass-raised));
  border-left: 4px solid #10b981;
}
.toast-success .toast-icon { color: #10b981; }

.toast-error {
  background:
    linear-gradient(180deg, rgba(239, 68, 68, 0.16), var(--surface-glass-raised));
  border-left: 4px solid #ef4444;
}
.toast-error .toast-icon { color: #ef4444; }

.toast-warning {
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.16), var(--surface-glass-raised));
  border-left: 4px solid #f59e0b;
}
.toast-warning .toast-icon { color: #f59e0b; }

.toast-info {
  background:
    linear-gradient(180deg, rgba(59, 130, 246, 0.15), var(--surface-glass-raised));
  border-left: 4px solid #3b82f6;
}
.toast-info .toast-icon { color: #3b82f6; }

/* Toast Progress Animation Styles */
.toast-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  width: 100%;
  transform-origin: left center;
  animation-name: toast-progress-shrink;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

.toast-success .toast-progress { background-color: #10b981; }
.toast-error .toast-progress { background-color: #ef4444; }
.toast-warning .toast-progress { background-color: #f59e0b; }
.toast-info .toast-progress { background-color: #3b82f6; }

@keyframes toast-progress-shrink {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.toast-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.125rem;
}

.icon-svg {
  width: 1.25rem;
  height: 1.25rem;
}

.toast-message {
  flex-grow: 1;
  font-weight: 500;
  word-break: break-word;
}

.toast-close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.25rem;
  line-height: 1rem;
  cursor: pointer;
  padding: 0 0.25rem;
  transition: color 0.15s ease;
}

.toast-close-btn:hover {
  color: var(--text-primary);
}

/* Animations */
.toast-slide-enter-from {
  opacity: 0;
  transform: translateX(120px) scale(0.9);
}
.toast-slide-leave-to {
  opacity: 0;
  transform: translateY(-20px) scale(0.9);
}
.toast-slide-leave-active {
  position: absolute;
}

/* Global Confirm Modal Styling */
.confirm-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: var(--overlay-bg);
  backdrop-filter: var(--glass-blur-soft);
  -webkit-backdrop-filter: var(--glass-blur-soft);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-modal-box {
  background: var(--glass-panel);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-radius: 16px;
  padding: 1.5rem;
  max-width: 400px;
  width: 90%;
  box-shadow: var(--glass-shadow), var(--glass-highlight-strong);
  border: 1px solid var(--glass-border);
  font-family: Inter, system-ui, -apple-system, sans-serif;
  animation: modal-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.confirm-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.confirm-message {
  margin: 0 0 1.5rem 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.25rem;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-cancel {
  background: var(--surface-glass-muted);
  border: 1px solid var(--glass-border);
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-cancel:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.btn-confirm {
  background: #3b82f6;
  border: none;
  color: #ffffff;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-confirm:hover {
  background: #2563eb;
}

.btn-confirm.btn-danger {
  background: #ef4444;
}
.btn-confirm.btn-danger:hover {
  background: #dc2626;
}

@keyframes modal-pop {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
