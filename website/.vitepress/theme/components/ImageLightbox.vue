<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const open = ref(false)
const src = ref('')
const alt = ref('')

function close() {
  open.value = false
}

function onClick(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof HTMLImageElement)) return
  if (!target.closest('main') || target.closest('a') || target.classList.contains('no-lightbox')) return

  src.value = target.currentSrc || target.src
  alt.value = target.alt
  open.value = true
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => {
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="image-lightbox" role="dialog" aria-modal="true" :aria-label="alt || 'Image preview'" @click.self="close">
      <button class="image-lightbox-close" type="button" aria-label="Close image preview" @click="close">×</button>
      <img :src="src" :alt="alt" />
    </div>
  </Teleport>
</template>
