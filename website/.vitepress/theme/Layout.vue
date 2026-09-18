<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import MeshCanvas from './components/MeshCanvas.vue'
import HomeScreenshot from './components/HomeScreenshot.vue'
import ImageLightbox from './components/ImageLightbox.vue'

const { frontmatter } = useData()
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-top>
      <div v-if="frontmatter.layout === 'home'" class="hero-mesh-clip">
        <div class="hero-mesh-backdrop">
          <MeshCanvas mode="owl" />
        </div>
      </div>
    </template>
    <!-- Placed here, not in index.md's Content, because VPHome always
         renders Content after the feature grid — this slot is the only way
         to show the screenshot before it (W11g). -->
    <template #home-hero-after>
      <!-- The slogans say why Jarvis exists, not what it is. This says it
           plainly, full width below the hero (the hero's own text column is
           only half as wide). -->
      <div class="home-hero-explainer">
        <p>
          <span class="lead">Alertmanager shows what is firing right now — and forgets it the moment it resolves.</span>
          Jarvis is an open-source web UI on top of
          <a href="https://prometheus.io/docs/alerting/latest/alertmanager/" target="_blank" rel="noreferrer">Prometheus Alertmanager</a>.
          It adds what Alertmanager doesn't have: the full history of every alert, including how
          often it fired, plus claims and comments so your team knows who is on it and what was
          found. All your clusters in one live view.
        </p>
      </div>
      <HomeScreenshot />
    </template>
  </DefaultTheme.Layout>
  <ImageLightbox />
</template>

<style scoped>
/* The backdrop is deliberately shifted 6% right and runs 6% past the viewport;
   without this clipping box that overhang became a horizontal page scrollbar. */
.hero-mesh-clip {
  position: absolute;
  inset: 0 0 auto 0;
  height: 620px;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.hero-mesh-backdrop {
  position: absolute;
  inset: 0 -6% 0 6%;
  height: 620px;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  mask-image: linear-gradient(to bottom, black 0%, black 45%, transparent 100%);
}
</style>
