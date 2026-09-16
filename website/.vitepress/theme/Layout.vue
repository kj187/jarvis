<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import MeshCanvas from './components/MeshCanvas.vue'

const { frontmatter } = useData()
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-top>
      <div v-if="frontmatter.layout === 'home'" class="hero-mesh-backdrop">
        <MeshCanvas mode="owl" />
      </div>
    </template>
  </DefaultTheme.Layout>
</template>

<style scoped>
.hero-mesh-backdrop {
  position: absolute;
  inset: 0;
  height: 620px;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
  mask-image: linear-gradient(to bottom, black 0%, black 45%, transparent 100%);
}
</style>
