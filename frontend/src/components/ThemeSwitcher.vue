<script setup>
import { computed, onMounted } from 'vue'
import { useThemeStore } from '../stores/theme'

const themeStore = useThemeStore()

const themeOptions = [
  {
    id: 'system',
    label: 'System default',
    shortLabel: 'Auto',
    iconPath:
      'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5l1 2h3v2H7v-2h3l1-2H6a2 2 0 0 1-2-2V5Zm2 0v10h12V5H6Z',
  },
  {
    id: 'light',
    label: 'Light mode',
    shortLabel: 'Light',
    iconPath:
      'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.42-1.42M4.92 19.08l1.42-1.42m0-11.32L4.92 4.92m14.16 14.16-1.42-1.42M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z',
  },
  {
    id: 'dark',
    label: 'Dark mode',
    shortLabel: 'Dark',
    iconPath:
      'M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z',
  },
]

const activeIndex = computed(() => {
  const index = themeOptions.findIndex((option) => option.id === themeStore.preference)
  return index >= 0 ? index : 0
})

onMounted(() => {
  themeStore.initialize()
})
</script>

<template>
  <div
    class="theme-dock"
    :data-preference="themeStore.preference"
    :data-resolved-theme="themeStore.resolvedTheme"
    role="group"
    aria-label="Color theme"
  >
    <div class="theme-track" :style="{ '--active-index': activeIndex }">
      <span class="theme-thumb" aria-hidden="true"></span>
      <button
        v-for="option in themeOptions"
        :key="option.id"
        type="button"
        class="theme-option"
        :class="{ 'is-active': themeStore.preference === option.id }"
        :aria-label="option.label"
        :aria-pressed="themeStore.preference === option.id"
        :title="option.label"
        @click="themeStore.setPreference(option.id)"
      >
        <svg
          class="theme-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path :d="option.iconPath" />
        </svg>
        <span>{{ option.shortLabel }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.theme-dock {
  position: fixed;
  left: 1.75rem;
  bottom: 10rem;
  z-index: var(--z-shell-controls, 900);
  width: 204px;
  margin: 0;
  transition:
    opacity var(--transition-fast),
    transform var(--transition-normal),
    width var(--transition-normal);
}

.theme-track {
  --active-index: 0;
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.25rem;
  padding: 0.35rem;
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  background: var(--glass-control);
  box-shadow: var(--glass-shadow-sm), var(--glass-highlight-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  overflow: hidden;
}

.theme-track::before {
  content: '';
  position: absolute;
  inset: 1px;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.28), transparent 48%, rgba(255, 255, 255, 0.12));
  opacity: 0.65;
}

.theme-thumb {
  position: absolute;
  top: 0.35rem;
  bottom: 0.35rem;
  left: 0.35rem;
  width: calc((100% - 0.7rem) / 3);
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--primary-hover));
  box-shadow: 0 10px 22px var(--primary-glow), inset 0 1px 0 rgba(255, 255, 255, 0.34);
  transform: translateX(calc(var(--active-index) * 100%));
  transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), box-shadow var(--transition-normal);
}

.theme-option {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 38px;
  gap: 0.4rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: color var(--transition-fast), transform var(--transition-fast);
}

.theme-option:hover {
  color: var(--text-primary);
  transform: translateY(-1px);
}

.theme-option.is-active {
  color: #ffffff;
}

.theme-icon {
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
}

:global(.app-shell.is-sidebar-collapsed .theme-dock) {
  opacity: 0;
  pointer-events: none;
  transform: translateX(-16px);
}

@media (min-width: 769px) and (max-width: 1024px) {
  .theme-dock {
    left: 1rem;
    width: 168px;
  }

  .theme-option span {
    display: none;
  }
}

@media (max-width: 768px) {
  .theme-dock {
    display: none;
    left: max(
      1rem,
      calc((var(--mobile-sidebar-width, 300px) - min(248px, calc(var(--mobile-sidebar-width, 300px) - 2rem))) / 2)
    );
    top: auto;
    bottom: calc(8.75rem + env(safe-area-inset-bottom));
    width: min(248px, calc(var(--mobile-sidebar-width, 300px) - 2rem));
    margin: 0;
    opacity: 0;
    pointer-events: none;
    transform: translateX(-12px);
    z-index: var(--z-shell-controls, 900);
  }

  :global(body.sidebar-open .theme-dock) {
    display: block;
    opacity: 1;
    pointer-events: auto;
    transform: translateX(0);
  }

  .theme-track {
    box-shadow: var(--shadow-lg);
  }

  .theme-option {
    gap: 0.25rem;
    min-height: 38px;
    font-size: clamp(0.7rem, 3vw, 0.78rem);
  }
}
</style>
