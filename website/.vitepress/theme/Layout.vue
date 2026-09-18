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
      <div v-if="frontmatter.layout === 'home'" class="hero-mesh-backdrop">
        <MeshCanvas mode="owl" />
      </div>
    </template>
    <!-- Placed here, not in index.md's Content, because VPHome always
         renders Content after the feature grid — this slot is the only way
         to show the screenshot before it (W11g). -->
    <template #home-hero-after>
      <HomeScreenshot />
    </template>
  </DefaultTheme.Layout>
  <ImageLightbox />
</template>

<style scoped>
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
