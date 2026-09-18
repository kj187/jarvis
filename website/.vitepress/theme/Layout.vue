<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import MeshCanvas from './components/MeshCanvas.vue'
import HomeScreenshot from './components/HomeScreenshot.vue'
import HomeVideo from './components/HomeVideo.vue'
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
    <!-- Product scenes belong directly after the hero and before the feature
         grid; the explanatory copy lives below the product instead of making
         the text-heavy hero even longer. -->
    <template #home-hero-after>
      <HomeScreenshot />
    </template>
    <template #home-features-after>
      <HomeVideo />
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
