<script setup lang="ts">
// Same asset the showcase further down used to embed inline — shown here via
// the home-hero-after slot so it renders before the feature grid (W11g:
// "show the product earlier and larger"). Content stays sourced from
// docs/assets, synced into content/assets by sync-content.mjs.
import darkSrc from '../../../content/assets/feature-card-view.png'
import lightSrc from '../../../content/assets/feature-card-view-light.png'
</script>

<template>
  <div class="home-hero-screenshot">
    <img
      :src="darkSrc"
      alt="Jarvis card view in dark theme — alerts grouped by severity into a multi-column card grid, each card showing labels, a firing sparkline and a silence button"
      class="dark-only"
    />
    <img
      :src="lightSrc"
      alt="Jarvis card view in light theme — alerts grouped by severity into a multi-column card grid, each card showing labels, a firing sparkline and a silence button"
      class="light-only"
    />
  </div>
</template>
