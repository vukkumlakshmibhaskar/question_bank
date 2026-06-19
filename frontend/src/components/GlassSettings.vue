<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'

const props = defineProps({
  showTrigger: {
    type: Boolean,
    default: false,
  },
})

const STORAGE_KEY = 'glassEffectSettingsV2'
const RANGE_LIMITS = Object.freeze({
  blur: { min: 8, max: 50 },
  refraction: { min: 0.05, max: 0.4 },
  depth: { min: 1, max: 30 },
})
const DEFAULT_SETTINGS = Object.freeze({
  blur: 50,
  refraction: 0.4,
  depth: 30,
})

const isOpen = ref(false)
const settings = reactive({ ...DEFAULT_SETTINGS })

let themeObserver = null

const clamp = (value, min, max) => Math.min(Math.max(Number(value), min), max)

const formatRefraction = computed(() => Number(settings.refraction.toFixed(2)).toString())

const readStoredSettings = () => {
  if (typeof localStorage === 'undefined') return

  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    settings.blur = clamp(
      stored.blur ?? DEFAULT_SETTINGS.blur,
      RANGE_LIMITS.blur.min,
      RANGE_LIMITS.blur.max,
    )
    settings.refraction = clamp(
      stored.refraction ?? DEFAULT_SETTINGS.refraction,
      RANGE_LIMITS.refraction.min,
      RANGE_LIMITS.refraction.max,
    )
    settings.depth = clamp(
      stored.depth ?? DEFAULT_SETTINGS.depth,
      RANGE_LIMITS.depth.min,
      RANGE_LIMITS.depth.max,
    )
  } catch {
    Object.assign(settings, DEFAULT_SETTINGS)
  }
}

const getTheme = () => {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

const buildShadow = (theme, depth, isCompact = false) => {
  const depthRange = RANGE_LIMITS.depth.max - RANGE_LIMITS.depth.min
  const depthLevel =
    (clamp(depth, RANGE_LIMITS.depth.min, RANGE_LIMITS.depth.max) - RANGE_LIMITS.depth.min) /
    depthRange
  const lifted = isCompact ? 0.75 + depthLevel * 4.75 : 1 + depthLevel * 9

  if (theme === 'light') {
    return [
      `0 ${8 + lifted * 2}px ${18 + lifted * 5}px rgba(79, 70, 229, ${0.04 + lifted * 0.01})`,
      `0 ${3 + lifted}px ${10 + lifted * 2}px rgba(15, 23, 42, ${0.035 + lifted * 0.008})`,
      '0 1px 0 rgba(255, 255, 255, 0.86)',
    ].join(', ')
  }

  return [
    `0 ${8 + lifted * 2}px ${18 + lifted * 5}px rgba(0, 0, 0, ${0.14 + lifted * 0.025})`,
    `0 ${Math.max(1, lifted / 2)}px ${8 + lifted * 2}px rgba(15, 23, 42, ${0.12 + lifted * 0.015})`,
    '0 1px 0 rgba(255, 255, 255, 0.04)',
  ].join(', ')
}

const applyGlassSettings = () => {
  if (typeof document === 'undefined') return

  const root = document.documentElement
  root.classList.add('glass-effects-enabled')
  const blur = clamp(settings.blur, RANGE_LIMITS.blur.min, RANGE_LIMITS.blur.max)
  const refraction = clamp(
    settings.refraction,
    RANGE_LIMITS.refraction.min,
    RANGE_LIMITS.refraction.max,
  )
  const depth = clamp(settings.depth, RANGE_LIMITS.depth.min, RANGE_LIMITS.depth.max)
  const refractionLevel =
    (refraction - RANGE_LIMITS.refraction.min) /
    (RANGE_LIMITS.refraction.max - RANGE_LIMITS.refraction.min)
  const depthLevel =
    (depth - RANGE_LIMITS.depth.min) / (RANGE_LIMITS.depth.max - RANGE_LIMITS.depth.min)
  const saturation = Math.round(135 + refraction * 230)
  const softSaturation = Math.max(130, saturation - 12)
  const contrast = Math.round(102 + refraction * 20)
  const softBlur = Math.max(10, Math.round(blur * 0.76))
  const panelBlur = Math.max(34, Math.round(blur * 1.16))
  const panelSaturation = Math.max(saturation + 12, softSaturation)
  const blurFilter = `blur(${blur}px) saturate(${saturation}%) brightness(1.15) contrast(${contrast}%)`
  const softBlurFilter = `blur(${softBlur}px) saturate(${softSaturation}%) brightness(1.1) contrast(${contrast}%)`
  const theme = getTheme()

  if (theme === 'light') {
    const panelTop = 0.58 + refractionLevel * 0.2
    const panelBottom = 0.24 + refractionLevel * 0.16
    const controlTop = 0.52 + refractionLevel * 0.18
    const controlBottom = 0.22 + refractionLevel * 0.14
    root.style.setProperty(
      '--surface-glass',
      `rgba(255, 255, 255, ${0.32 + refractionLevel * 0.2})`,
    )
    root.style.setProperty(
      '--surface-glass-muted',
      `rgba(255, 255, 255, ${0.2 + refractionLevel * 0.16})`,
    )
    root.style.setProperty(
      '--surface-glass-strong',
      `rgba(255, 255, 255, ${0.48 + refractionLevel * 0.18})`,
    )
    root.style.setProperty(
      '--surface-glass-raised',
      `rgba(255, 255, 255, ${0.52 + refractionLevel * 0.2})`,
    )
    root.style.setProperty(
      '--glass-panel',
      `linear-gradient(145deg, rgba(255, 255, 255, ${panelTop}), rgba(255, 255, 255, ${panelBottom}))`,
    )
    root.style.setProperty(
      '--glass-panel-soft',
      `linear-gradient(145deg, rgba(255, 255, 255, ${0.42 + refractionLevel * 0.16}), rgba(255, 255, 255, ${0.18 + refractionLevel * 0.12}))`,
    )
    root.style.setProperty(
      '--glass-control',
      `linear-gradient(145deg, rgba(255, 255, 255, ${controlTop}), rgba(255, 255, 255, ${controlBottom}))`,
    )
    root.style.setProperty(
      '--header-surface',
      `rgba(255, 255, 255, ${0.36 + refractionLevel * 0.18})`,
    )
    root.style.setProperty(
      '--mobile-sidebar-surface',
      `rgba(255, 255, 255, ${0.5 + refractionLevel * 0.16})`,
    )
    root.style.setProperty('--bg-card', `rgba(255, 255, 255, ${0.28 + refractionLevel * 0.34})`)
    root.style.setProperty(
      '--bg-card-hover',
      `rgba(255, 255, 255, ${0.38 + refractionLevel * 0.32})`,
    )
    root.style.setProperty('--bg-input', `rgba(255, 255, 255, ${0.24 + refractionLevel * 0.24})`)
    root.style.setProperty(
      '--table-header-surface',
      `rgba(255, 255, 255, ${0.34 + refractionLevel * 0.28})`,
    )
    root.style.setProperty('--row-hover-surface', `rgba(79, 70, 229, ${0.05 + depthLevel * 0.08})`)
    root.style.setProperty('--overlay-bg', `rgba(15, 23, 42, ${0.24 + refractionLevel * 0.16})`)
    root.style.setProperty('--glass-border', `rgba(255, 255, 255, ${0.52 + depthLevel * 0.22})`)
    root.style.setProperty(
      '--glass-border-strong',
      `rgba(79, 70, 229, ${0.16 + depthLevel * 0.12})`,
    )
  } else {
    const panelTop = 0.5 + refractionLevel * 0.2
    const panelBottom = 0.28 + refractionLevel * 0.16
    const controlTop = 0.46 + refractionLevel * 0.2
    const controlBottom = 0.24 + refractionLevel * 0.15
    root.style.setProperty('--surface-glass', `rgba(18, 25, 43, ${0.44 + refractionLevel * 0.18})`)
    root.style.setProperty(
      '--surface-glass-muted',
      `rgba(18, 25, 43, ${0.3 + refractionLevel * 0.16})`,
    )
    root.style.setProperty(
      '--surface-glass-strong',
      `rgba(18, 25, 43, ${0.62 + refractionLevel * 0.16})`,
    )
    root.style.setProperty(
      '--surface-glass-raised',
      `rgba(25, 35, 58, ${0.58 + refractionLevel * 0.18})`,
    )
    root.style.setProperty(
      '--glass-panel',
      `linear-gradient(145deg, rgba(30, 41, 59, ${panelTop}), rgba(15, 23, 42, ${panelBottom}))`,
    )
    root.style.setProperty(
      '--glass-panel-soft',
      `linear-gradient(145deg, rgba(30, 41, 59, ${0.38 + refractionLevel * 0.16}), rgba(15, 23, 42, ${0.22 + refractionLevel * 0.14}))`,
    )
    root.style.setProperty(
      '--glass-control',
      `linear-gradient(145deg, rgba(30, 41, 59, ${controlTop}), rgba(15, 23, 42, ${controlBottom}))`,
    )
    root.style.setProperty('--header-surface', `rgba(18, 25, 43, ${0.48 + refractionLevel * 0.18})`)
    root.style.setProperty(
      '--mobile-sidebar-surface',
      `rgba(10, 16, 30, ${0.76 + refractionLevel * 0.16})`,
    )
    root.style.setProperty('--bg-card', `rgba(18, 25, 43, ${0.34 + refractionLevel * 0.34})`)
    root.style.setProperty('--bg-card-hover', `rgba(38, 52, 82, ${0.42 + refractionLevel * 0.28})`)
    root.style.setProperty('--bg-input', `rgba(8, 13, 26, ${0.28 + refractionLevel * 0.26})`)
    root.style.setProperty(
      '--table-header-surface',
      `rgba(15, 23, 42, ${0.32 + refractionLevel * 0.28})`,
    )
    root.style.setProperty('--row-hover-surface', `rgba(99, 102, 241, ${0.05 + depthLevel * 0.08})`)
    root.style.setProperty('--overlay-bg', `rgba(0, 0, 0, ${0.38 + refractionLevel * 0.2})`)
    root.style.setProperty('--glass-border', `rgba(255, 255, 255, ${0.15 + depthLevel * 0.1})`);
    root.style.setProperty('--glass-border-bottom', `rgba(0, 0, 0, ${0.1 + depthLevel * 0.05})`);
    root.style.setProperty(
      '--glass-border-strong',
      `rgba(226, 232, 240, ${0.16 + depthLevel * 0.14})`,
    )
  }

  root.style.setProperty('--glass-blur-value', `${blur}px`)
  root.style.setProperty('--glass-blur-soft-value', `${softBlur}px`)
  root.style.setProperty('--glass-refraction-value', `${saturation}%`)
  root.style.setProperty('--glass-refraction-soft-value', `${softSaturation}%`)
  root.style.setProperty('--glass-contrast-value', `${contrast}%`)
  root.style.setProperty('--glass-blur', blurFilter)
  root.style.setProperty('--glass-blur-soft', softBlurFilter)
  root.style.setProperty(
    '--glass-settings-panel-blur',
    `blur(${panelBlur}px) saturate(${panelSaturation}%) contrast(${contrast}%)`,
  )
  root.style.setProperty('--glass-shadow', buildShadow(theme, depth))
  root.style.setProperty('--glass-shadow-sm', buildShadow(theme, depth, true))
}

const saveSettings = () => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      blur: settings.blur,
      refraction: settings.refraction,
      depth: settings.depth,
    }),
  )
}

const resetSettings = () => {
  Object.assign(settings, DEFAULT_SETTINGS)
  saveSettings()
  applyGlassSettings()
}

const togglePanel = () => {
  isOpen.value = !isOpen.value
}

const closePanel = () => {
  isOpen.value = false
}

const handleOutsideClick = (event) => {
  if (!isOpen.value) return
  if (event.target instanceof Element && event.target.closest('.glass-settings')) return
  if (event.target instanceof Element && event.target.closest('.glass-settings-panel')) return
  closePanel()
}

const handleKeydown = (event) => {
  if (event.key === 'Escape') closePanel()
}

const rangeStyle = (value, min, max) => ({
  '--range-percent': `${((value - min) / (max - min)) * 100}%`,
})

watch(
  settings,
  () => {
    applyGlassSettings()
    saveSettings()
  },
  { deep: true },
)

watch(
  () => props.showTrigger,
  (isVisible) => {
    if (!isVisible) closePanel()
  },
)

onMounted(() => {
  readStoredSettings()
  applyGlassSettings()
  document.addEventListener('click', handleOutsideClick)
  document.addEventListener('keydown', handleKeydown)

  themeObserver = new MutationObserver(applyGlassSettings)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick)
  document.removeEventListener('keydown', handleKeydown)
  themeObserver?.disconnect()
  document.documentElement.classList.remove('glass-effects-enabled')
})
</script>

<template>
  <Teleport v-if="showTrigger" to=".sidebar-footer" defer>
    <div class="glass-settings" :class="{ 'is-open': isOpen }" @click.stop>
      <button
        type="button"
        class="glass-settings-trigger"
        title="Glass settings"
        aria-label="Glass settings"
        :aria-expanded="isOpen"
        @click.stop="togglePanel"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
          <path
            d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21a2.1 2.1 0 0 1-4.2 0v-.06a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 0 1-2.97-2.97l.04-.04A1.8 1.8 0 0 0 3.8 15a1.8 1.8 0 0 0-1.66-1.1H2.1a2.1 2.1 0 0 1 0-4.2h.06A1.8 1.8 0 0 0 3.8 8a1.8 1.8 0 0 0-.36-1.98l-.04-.04a2.1 2.1 0 0 1 2.97-2.97l.04.04A1.8 1.8 0 0 0 8.4 3.4a1.8 1.8 0 0 0 1.1-1.66V1.7a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 0 1 2.97 2.97l-.04.04A1.8 1.8 0 0 0 19.4 8a1.8 1.8 0 0 0 1.66 1.1h.06a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15Z"
          />
        </svg>
      </button>
    </div>
  </Teleport>

  <Teleport v-if="showTrigger" to="body">
    <transition name="glass-settings-pop">
      <section
        v-if="isOpen"
        class="glass-settings-panel"
        aria-label="Glass effect settings"
        @click.stop
      >
        <div class="glass-settings-header">
          <h3>Settings</h3>
          <button type="button" class="glass-reset-button" @click="resetSettings">Reset</button>
        </div>

        <label class="glass-slider-row">
          <span>
            <strong>Blur value</strong>
            <output>{{ settings.blur }}</output>
          </span>
          <input
            v-model.number="settings.blur"
            type="range"
            :min="RANGE_LIMITS.blur.min"
            :max="RANGE_LIMITS.blur.max"
            step="1"
            :style="rangeStyle(settings.blur, RANGE_LIMITS.blur.min, RANGE_LIMITS.blur.max)"
          />
        </label>

        <label class="glass-slider-row">
          <span>
            <strong>Refraction</strong>
            <output>{{ formatRefraction }}</output>
          </span>
          <input
            v-model.number="settings.refraction"
            type="range"
            :min="RANGE_LIMITS.refraction.min"
            :max="RANGE_LIMITS.refraction.max"
            step="0.01"
            :style="
              rangeStyle(
                settings.refraction,
                RANGE_LIMITS.refraction.min,
                RANGE_LIMITS.refraction.max,
              )
            "
          />
        </label>

        <label class="glass-slider-row">
          <span>
            <strong>Depth</strong>
            <output>{{ settings.depth }}</output>
          </span>
          <input
            v-model.number="settings.depth"
            type="range"
            :min="RANGE_LIMITS.depth.min"
            :max="RANGE_LIMITS.depth.max"
            step="1"
            :style="rangeStyle(settings.depth, RANGE_LIMITS.depth.min, RANGE_LIMITS.depth.max)"
          />
        </label>
      </section>
    </transition>
  </Teleport>
</template>

<style scoped>
.glass-settings,
.glass-settings-panel {
  --glass-settings-accent: var(--primary);
}

.glass-settings {
  display: inline-flex;
  position: relative;
  z-index: var(--z-shell-controls, 900);
}

.glass-settings-trigger {
  align-items: center;
  background: var(--glass-control);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  box-shadow: var(--glass-shadow-sm), var(--glass-highlight-strong);
  color: var(--text-primary);
  cursor: pointer;
  display: inline-flex;
  height: 38px;
  justify-content: center;
  transition:
    transform var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
  width: 42px;
}

.glass-settings-trigger:hover {
  border-color: var(--glass-border-strong);
  box-shadow: var(--glass-shadow), var(--glass-highlight-strong);
  transform: translateY(-1px);
}

.glass-settings-trigger svg {
  height: 20px;
  width: 20px;
}

.glass-settings-panel {
  background:
    radial-gradient(circle at 18% 10%, rgba(255, 255, 255, 0.26), transparent 34%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.18), transparent 42%),
    linear-gradient(35deg, rgba(79, 70, 229, 0.16), transparent 46%), var(--glass-panel);
  backdrop-filter: var(--glass-settings-panel-blur, var(--glass-blur));
  -webkit-backdrop-filter: var(--glass-settings-panel-blur, var(--glass-blur));
  border: 1px solid var(--glass-border);
  border-radius: 24px;
  bottom: 8.75rem;
  box-shadow: var(--glass-shadow), var(--glass-highlight-strong);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  gap: 1.35rem;
  left: calc(var(--sidebar-width) + 1rem);
  min-width: 320px;
  overflow: hidden;
  padding: 1.45rem 1.55rem 1.55rem;
  position: fixed;
  width: min(360px, calc(100vw - var(--sidebar-width) - 2rem));
  z-index: var(--z-shell-panels, 940);
}

.glass-settings-panel::before {
  background:
    linear-gradient(115deg, transparent 12%, rgba(255, 255, 255, 0.16) 32%, transparent 52%),
    linear-gradient(35deg, transparent 0 48%, rgba(255, 255, 255, 0.1) 54%, transparent 72%);
  content: '';
  inset: 0;
  pointer-events: none;
  position: absolute;
}

.glass-settings-header,
.glass-slider-row {
  position: relative;
  z-index: 1;
}

.glass-settings-header {
  align-items: center;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.glass-settings-header h3 {
  font-size: 1.45rem;
  font-weight: 800;
  line-height: 1;
  margin: 0;
}

.glass-reset-button {
  background: var(--glass-control);
  border: 1px solid var(--glass-border);
  border-radius: 999px;
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: 0.76rem;
  font-weight: 800;
  padding: 0.35rem 0.65rem;
}

.glass-reset-button:hover {
  border-color: var(--glass-border-strong);
  color: var(--text-primary);
}

.glass-slider-row {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.glass-slider-row span {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.glass-slider-row strong {
  font-size: 0.96rem;
  font-weight: 800;
}

.glass-slider-row output {
  color: var(--glass-settings-accent);
  font-size: 1rem;
  font-weight: 900;
}

.glass-slider-row input[type='range'] {
  appearance: none;
  background: linear-gradient(
    90deg,
    var(--glass-settings-accent) 0 var(--range-percent),
    color-mix(in srgb, var(--text-primary) 18%, transparent) var(--range-percent) 100%
  );
  border-radius: 999px;
  cursor: pointer;
  height: 8px;
  outline: none;
  width: 100%;
}

.glass-slider-row input[type='range']::-webkit-slider-thumb {
  appearance: none;
  background: #ffffff;
  border: 0;
  border-radius: 50%;
  box-shadow:
    0 8px 18px rgba(15, 23, 42, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  height: 30px;
  width: 30px;
}

.glass-slider-row input[type='range']::-moz-range-thumb {
  background: #ffffff;
  border: 0;
  border-radius: 50%;
  box-shadow:
    0 8px 18px rgba(15, 23, 42, 0.24),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  height: 30px;
  width: 30px;
}

.glass-settings-pop-enter-active,
.glass-settings-pop-leave-active {
  transition:
    opacity var(--transition-normal),
    transform var(--transition-normal);
}

.glass-settings-pop-enter-from,
.glass-settings-pop-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.96);
}

:global(.app-shell.is-sidebar-collapsed) .glass-settings-panel {
  left: calc(var(--sidebar-collapsed-width) + 1rem);
  width: min(360px, calc(100vw - var(--sidebar-collapsed-width) - 2rem));
}

@media (min-width: 769px) and (max-width: 1024px) {
  .glass-settings-panel {
    left: calc(200px + 1rem);
    width: min(340px, calc(100vw - 200px - 2rem));
  }

  :global(.app-shell.is-sidebar-collapsed) .glass-settings-panel {
    left: calc(var(--sidebar-collapsed-width) + 1rem);
    width: min(340px, calc(100vw - var(--sidebar-collapsed-width) - 2rem));
  }
}

@media (max-width: 768px) {
  .glass-settings {
    display: inline-flex;
  }

  .glass-settings-panel {
    bottom: auto;
    left: 1rem;
    min-width: 0;
    max-height: calc(100dvh - var(--mobile-header-height) - 1.5rem);
    overflow-y: auto;
    top: calc(var(--mobile-header-height) + 0.75rem);
    width: min(292px, calc(var(--mobile-sidebar-width) - 2rem));
  }
}
</style>
