<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import cardDarkSrc from '../../../content/assets/feature-card-view.png'
import cardLightSrc from '../../../content/assets/feature-card-view-light.png'
import operationsDarkSrc from '../../../content/assets/screenshot.png'
import operationsLightSrc from '../../../content/assets/screenshot-light.png'
import detailDarkSrc from '../../../content/assets/tour-detail.png'
import detailLightSrc from '../../../content/assets/tour-detail-light.png'
import silencesDarkSrc from '../../../content/assets/tour-silences.png'
import silencesLightSrc from '../../../content/assets/tour-silences-light.png'

const ROTATION_INTERVAL_MS = 9000

const scenes = [
  {
    label: 'Live alerts',
    darkSrc: cardDarkSrc,
    lightSrc: cardLightSrc,
    alt: 'Jarvis alerts grouped by severity in a multi-column card view',
  },
  {
    label: 'Coordinate the response',
    darkSrc: operationsDarkSrc,
    lightSrc: operationsLightSrc,
    alt: 'Jarvis operations overview with claimed alerts, firing history and an expiring silence',
  },
  {
    label: 'Alert details',
    darkSrc: detailDarkSrc,
    lightSrc: detailLightSrc,
    alt: 'Jarvis alert detail panel with a claim, firing heatmap, labels and links',
  },
  {
    label: 'Silences',
    darkSrc: silencesDarkSrc,
    lightSrc: silencesLightSrc,
    alt: 'Jarvis silence sheet opened from an alert, with matchers pre-filled from its labels and an affected-alerts preview',
  },
  {
    // Shows both themes at once, whatever theme the site itself is in.
    label: 'Dark & light',
    darkSrc: cardDarkSrc,
    lightSrc: cardLightSrc,
    alt: 'Jarvis card view, dark theme on the left and light theme on the right',
    split: true,
  },
] as const

const activeScene = ref(0)
const isPlaying = ref(false)
// Bumped on every (re)start so the progress bar's CSS animation begins again.
const cycle = ref(0)
let rotationTimer: number | undefined
let reducedMotionQuery: MediaQueryList | undefined

function stopRotation() {
  if (rotationTimer !== undefined) window.clearInterval(rotationTimer)
  rotationTimer = undefined
  isPlaying.value = false
}

function startRotation(force = false) {
  if (!force && reducedMotionQuery?.matches) return

  stopRotation()
  isPlaying.value = true
  cycle.value++
  rotationTimer = window.setInterval(() => {
    activeScene.value = (activeScene.value + 1) % scenes.length
    cycle.value++
  }, ROTATION_INTERVAL_MS)
}

function selectScene(index: number) {
  activeScene.value = index
  if (isPlaying.value) startRotation(true)
}

function toggleRotation() {
  if (isPlaying.value) stopRotation()
  else startRotation(true)
}

function handleReducedMotionChange(event: MediaQueryListEvent) {
  if (event.matches) stopRotation()
  else startRotation()
}

onMounted(() => {
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotionQuery.addEventListener('change', handleReducedMotionChange)
  startRotation()
})

onBeforeUnmount(() => {
  stopRotation()
  reducedMotionQuery?.removeEventListener('change', handleReducedMotionChange)
})
</script>

<template>
  <section class="home-hero-screenshot" aria-label="Jarvis product tour">
    <div class="home-scene-shell">
      <div class="home-scene-stage">
        <Transition name="home-scene">
          <div
            :key="scenes[activeScene].label"
            class="home-scene-panel"
            aria-live="off"
          >
            <template v-if="'split' in scenes[activeScene]">
              <img :src="scenes[activeScene].darkSrc" :alt="scenes[activeScene].alt" class="no-lightbox" />
              <img :src="scenes[activeScene].lightSrc" alt="" class="home-scene-split-light no-lightbox" />
              <span class="home-scene-split-divider" aria-hidden="true" />
              <span class="home-scene-split-tag dark" aria-hidden="true">Dark</span>
              <span class="home-scene-split-tag light" aria-hidden="true">Light</span>
            </template>
            <template v-else>
              <img
                :src="scenes[activeScene].darkSrc"
                :alt="`${scenes[activeScene].alt} in dark theme`"
                class="dark-only"
              />
              <img
                :src="scenes[activeScene].lightSrc"
                :alt="`${scenes[activeScene].alt} in light theme`"
                class="light-only"
              />
            </template>
          </div>
        </Transition>
      </div>

      <div
        class="home-scene-controls"
        role="group"
        aria-label="Product tour controls"
        :style="{ '--tour-duration': `${ROTATION_INTERVAL_MS}ms` }"
      >
        <button
          v-for="(scene, index) in scenes"
          :key="scene.label"
          type="button"
          class="home-scene-tab"
          :class="{ active: activeScene === index }"
          :aria-label="`Show ${scene.label}`"
          :aria-current="activeScene === index ? 'true' : undefined"
          @click="selectScene(index)"
        >
          <span class="home-scene-tab-label">
            <span class="home-scene-tab-number" aria-hidden="true">0{{ index + 1 }}</span>
            {{ scene.label }}
          </span>
          <span class="home-scene-tab-track" aria-hidden="true">
            <span
              v-if="activeScene === index"
              :key="cycle"
              class="home-scene-tab-fill"
              :class="{ running: isPlaying }"
            />
          </span>
        </button>
        <button
          type="button"
          class="home-scene-toggle"
          :aria-label="isPlaying ? 'Pause product tour' : 'Play product tour'"
          @click="toggleRotation"
        >
          <span aria-hidden="true">{{ isPlaying ? 'Ⅱ' : '▶' }}</span>
        </button>
      </div>

      <div class="home-hero-explainer">
        <p>
          <span class="lead">Alertmanager shows what is firing right now — and forgets it the moment it resolves.</span>
          Jarvis is an open-source web UI on top of
          <a href="https://prometheus.io/docs/alerting/latest/alertmanager/" target="_blank" rel="noreferrer">Prometheus Alertmanager</a>.
          It adds the full history of every alert, including how often it fired, plus claims and
          comments so your team knows who is on it and what was found. All your clusters in one live view.
        </p>
      </div>
    </div>
  </section>
</template>
