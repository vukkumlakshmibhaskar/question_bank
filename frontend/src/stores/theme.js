import { defineStore } from 'pinia'

const STORAGE_KEY = 'themePreference'
const THEME_PREFERENCES = ['system', 'dark', 'light']

let mediaQuery = null
let mediaListenerAttached = false
let themeTransitionTimer = null

const normalizePreference = (preference) => {
  return THEME_PREFERENCES.includes(preference) ? preference : 'system'
}

const getSystemTheme = () => {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const resolveTheme = (preference) => {
  return preference === 'system' ? getSystemTheme() : preference
}

const prefersReducedMotion = () => {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const setThemeAttributes = (root, preference, resolvedTheme) => {
  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = preference
  root.style.colorScheme = resolvedTheme
}

const cleanupThemeTransition = (root) => {
  root.classList.remove('theme-switching')
  delete root.dataset.previousTheme
  delete root.dataset.themeTransitionMode
}

const startThemeTransition = (root, previousTheme, updateTheme) => {
  const hasViewTransition = typeof document.startViewTransition === 'function'

  root.classList.remove('theme-switching')
  window.clearTimeout(themeTransitionTimer)
  void root.offsetWidth
  root.dataset.previousTheme = previousTheme
  root.dataset.themeTransitionMode = hasViewTransition ? 'view' : 'css'
  root.classList.add('theme-switching')

  if (hasViewTransition) {
    const transition = document.startViewTransition(updateTheme)
    transition.finished.finally(() => {
      cleanupThemeTransition(root)
    })
    return
  }

  updateTheme()
  themeTransitionTimer = window.setTimeout(() => {
    cleanupThemeTransition(root)
  }, 520)
}

export const getStoredThemePreference = () => {
  if (typeof localStorage === 'undefined') return 'system'
  return normalizePreference(localStorage.getItem(STORAGE_KEY))
}

export const applyThemePreference = (preference = 'system') => {
  const normalizedPreference = normalizePreference(preference)
  const resolvedTheme = resolveTheme(normalizedPreference)

  if (typeof document !== 'undefined') {
    const root = document.documentElement
    const previousTheme = root.dataset.theme
    const updateTheme = () => setThemeAttributes(root, normalizedPreference, resolvedTheme)

    if (previousTheme && previousTheme !== resolvedTheme && !prefersReducedMotion()) {
      startThemeTransition(root, previousTheme, updateTheme)
    } else {
      updateTheme()
    }
  }

  return { preference: normalizedPreference, resolvedTheme }
}

export const applyInitialThemePreference = () => {
  return applyThemePreference(getStoredThemePreference())
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    preference: getStoredThemePreference(),
    resolvedTheme: 'dark',
  }),

  getters: {
    isSystem: (state) => state.preference === 'system',
  },

  actions: {
    initialize() {
      const appliedTheme = applyThemePreference(this.preference)
      this.resolvedTheme = appliedTheme.resolvedTheme
      this.bindSystemThemeListener()
    },

    setPreference(preference) {
      const normalizedPreference = normalizePreference(preference)
      this.preference = normalizedPreference
      localStorage.setItem(STORAGE_KEY, normalizedPreference)

      const appliedTheme = applyThemePreference(normalizedPreference)
      this.resolvedTheme = appliedTheme.resolvedTheme
    },

    bindSystemThemeListener() {
      if (typeof window === 'undefined' || mediaListenerAttached) return

      mediaQuery = window.matchMedia('(prefers-color-scheme: light)')
      const handleSystemThemeChange = () => {
        if (this.preference !== 'system') return

        const appliedTheme = applyThemePreference('system')
        this.resolvedTheme = appliedTheme.resolvedTheme
      }

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener('change', handleSystemThemeChange)
      } else {
        mediaQuery.addListener(handleSystemThemeChange)
      }

      mediaListenerAttached = true
    },
  },
})
