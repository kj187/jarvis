import { useEffect, useRef } from 'react'
import { buildMeshEdges, buildMeshNodes, nodePositionAt, sampleEdgePoints } from '@/lib/owlMesh'
import type { MeshEdge, MeshNode } from '@/lib/owlMesh'

const LOGO_SRC = '/logo.png'
const SAMPLE_SIZE = 220
const REACH_RATIO = 0.16
const LAYOUT_SIZE_RATIO = 0.82

function readMeshColors() {
  const style = getComputedStyle(document.documentElement)
  return {
    line: style.getPropertyValue('--color-muted-foreground').trim() || 'currentColor',
    node: style.getPropertyValue('--color-link').trim() || 'currentColor',
  }
}

/**
 * Centered, animated Owl mesh: the logo's edge points as a static graph,
 * each node breathing gently around its resting position — no assemble
 * animation (that's reserved for the release video). Purely decorative
 * (aria-hidden), themed from CSS variables, paused on `prefers-reduced-motion`
 * and while the tab is hidden.
 */
export function OwlMeshBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    let nodes: MeshNode[] = []
    let edges: MeshEdge[] = []
    let colors = readMeshColors()
    let rafId = 0
    let disposed = false
    const startTime = performance.now()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const layout = () => {
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

    const draw = (t: number) => {
      const { width, height } = layout()
      ctx.clearRect(0, 0, width, height)

      ctx.strokeStyle = colors.line
      ctx.globalAlpha = 0.35
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
      ctx.globalAlpha = 0.75
      for (const n of nodes) {
        const p = nodePositionAt(n, t)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const rebuildLayout = () => {
      const { width, height } = layout()
      const size = Math.min(width, height) * LAYOUT_SIZE_RATIO
      // Drift amplitude scales with the rendered size so the breathing motion
      // stays visible whether the backdrop is a small icon or a large hero.
      nodes = buildMeshNodes(sampled, { cx: width / 2, cy: height / 2, size }, { driftAmplitude: size * 0.022 })
      edges = buildMeshEdges(nodes, size * REACH_RATIO)
    }

    let sampled: ReturnType<typeof sampleEdgePoints> = []

    const tick = (now: number) => {
      if (disposed) return
      draw((now - startTime) / 1000)
      if (reducedMotion || document.hidden) return
      rafId = requestAnimationFrame(tick)
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId)
      } else if (!reducedMotion && !disposed) {
        cancelAnimationFrame(rafId)
        rafId = requestAnimationFrame(tick)
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    const resizeObserver = new ResizeObserver(() => {
      rebuildLayout()
      draw((performance.now() - startTime) / 1000)
    })
    if (canvas.parentElement) resizeObserver.observe(canvas.parentElement)

    const themeObserver = new MutationObserver(() => {
      colors = readMeshColors()
      draw((performance.now() - startTime) / 1000)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const load = async () => {
      const img = new Image()
      img.src = LOGO_SRC
      try {
        await img.decode()
      } catch {
        return
      }
      if (disposed) return
      const off = document.createElement('canvas')
      off.width = SAMPLE_SIZE
      off.height = SAMPLE_SIZE
      const offCtx = off.getContext('2d')
      if (!offCtx) return
      offCtx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      const data = offCtx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
      sampled = sampleEdgePoints(data.data, SAMPLE_SIZE, SAMPLE_SIZE)
      if (disposed) return
      rebuildLayout()
      rafId = requestAnimationFrame(tick)
    }
    load()

    return () => {
      disposed = true
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
