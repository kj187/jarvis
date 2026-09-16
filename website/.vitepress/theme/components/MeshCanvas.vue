<script setup lang="ts">
// Canvas mesh backdrop shared by the homepage hero ("owl", the Jarvis logo's
// edge points) and section backgrounds ("neural", random drifting nodes).
// Reuses the pure, unit-tested geometry from the app itself
// (frontend/src/lib/owlMesh.ts) rather than re-implementing it here — the
// only website-specific code is the Vue wiring (canvas, resize, theme,
// reduced-motion) below.
import { onMounted, onUnmounted, ref, useTemplateRef } from 'vue'
import {
  buildMeshEdges,
  buildMeshNodes,
  mulberry32,
  nodePositionAt,
  sampleEdgePoints,
  type MeshEdge,
  type MeshNode,
} from '../../../../frontend/src/lib/owlMesh'

const props = withDefaults(defineProps<{ mode?: 'owl' | 'neural'; nodeCount?: number }>(), {
  mode: 'owl',
  nodeCount: 70,
})

const canvasRef = useTemplateRef<HTMLCanvasElement>('canvas')
const ready = ref(false)

function readColors() {
  const style = getComputedStyle(document.documentElement)
  return {
    line: style.getPropertyValue('--vp-c-text-3').trim() || '#888',
    node: style.getPropertyValue('--vp-c-brand-1').trim() || '#3b82f6',
  }
}

onMounted(() => {
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx) return

  let nodes: MeshNode[] = []
  let edges: MeshEdge[] = []
  let colors = readColors()
  let rafId = 0
  let disposed = false
  const startTime = performance.now()
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const layoutSize = () => {
    const rect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, rect.width)
    const height = Math.max(1, rect.height)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return { width, height }
  }

  const rebuild = (points: { x: number; y: number }[]) => {
    const { width, height } = layoutSize()
    const size = props.mode === 'owl' ? Math.min(width, height) * 0.86 : Math.max(width, height)
    nodes = buildMeshNodes(points, { cx: width / 2, cy: height / 2, size }, { driftAmplitude: size * 0.022 })
    edges = buildMeshEdges(nodes, size * (props.mode === 'owl' ? 0.16 : 0.12))
  }

  const draw = (t: number) => {
    const { width, height } = layoutSize()
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = colors.line
    ctx.globalAlpha = props.mode === 'owl' ? 0.4 : 0.22
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const e of edges) {
      const pa = nodePositionAt(nodes[e.a], t)
      const pb = nodePositionAt(nodes[e.b], t)
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
    }
    ctx.stroke()
    ctx.fillStyle = colors.node
    ctx.globalAlpha = props.mode === 'owl' ? 0.8 : 0.5
    for (const n of nodes) {
      const p = nodePositionAt(n, t)
      ctx.beginPath()
      ctx.arc(p.x, p.y, props.mode === 'owl' ? 1.6 : 1.3, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  const tick = (now: number) => {
    if (disposed) return
    draw((now - startTime) / 1000)
    if (reducedMotion || document.hidden) return
    rafId = requestAnimationFrame(tick)
  }

  const onVisibility = () => {
    if (document.hidden) cancelAnimationFrame(rafId)
    else if (!reducedMotion && !disposed) {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(tick)
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  const resizeObserver = new ResizeObserver(() => {
    rebuild(props.mode === 'owl' ? lastPoints : lastPoints)
    draw((performance.now() - startTime) / 1000)
  })
  if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

  const themeObserver = new MutationObserver(() => {
    colors = readColors()
    draw((performance.now() - startTime) / 1000)
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

  let lastPoints: { x: number; y: number }[] = []

  const start = () => {
    rebuild(lastPoints)
    ready.value = true // fades the canvas in via CSS (see <style> below) — the mesh's "arrival"
    rafId = requestAnimationFrame(tick)
  }

  if (props.mode === 'neural') {
    const rand = mulberry32(7)
    lastPoints = Array.from({ length: props.nodeCount }, () => ({ x: rand() * 1000, y: rand() * 1000 }))
    start()
  } else {
    const img = new Image()
    img.src = '/jarvis/logo.png'
    img
      .decode()
      .then(() => {
        if (disposed) return
        const off = document.createElement('canvas')
        off.width = 220
        off.height = 220
        const offCtx = off.getContext('2d')
        if (!offCtx) return
        offCtx.drawImage(img, 0, 0, 220, 220)
        lastPoints = sampleEdgePoints(offCtx.getImageData(0, 0, 220, 220).data, 220, 220)
        start()
      })
      .catch(() => {})
  }

  onUnmounted(() => {
    disposed = true
    cancelAnimationFrame(rafId)
    resizeObserver.disconnect()
    themeObserver.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
  })
})
</script>

<template>
  <canvas ref="canvas" class="mesh-canvas" :class="{ ready }" aria-hidden="true" />
</template>

<style scoped>
.mesh-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0;
  transform: scale(0.96);
  transition:
    opacity 1.1s ease,
    transform 1.1s ease;
}
.mesh-canvas.ready {
  opacity: 1;
  transform: scale(1);
}
@media (prefers-reduced-motion: reduce) {
  .mesh-canvas {
    transition: none;
  }
}
</style>
