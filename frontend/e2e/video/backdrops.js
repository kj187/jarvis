/* global window, document */
// Animated title-card backdrops for the Jarvis videos (.agents/skills/release-video/SKILL.md).
// Injected into card pages by recorder.ts and rendered frame by frame:
// window.__draw(t) paints the backdrop for time t (seconds) — every node
// position is a pure function of t, so re-recordings are identical and frames
// can be rendered out of real time.
//   owl  — first and last slide: a neural mesh that assembles into the Jarvis owl
//   mesh — every slide in between: drifting nodes, threads where they come close
window.JarvisBackdrop = (() => {
  const TAU = Math.PI * 2
  const mulberry = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const mix = (a, b, k) => a + (b - a) * k
  // Left-to-right tint from product blue to a lighter blue; recorder.ts injects the palette (from
  // design/tokens.json) as window.__JARVIS_PALETTE before this file runs.
  const PAL = window.__JARVIS_PALETTE
  const tint = (x, w, alpha) => `rgba(${[0, 1, 2].map((i) => Math.round(mix(PAL.blue[i], PAL.blueLight[i], x / w))).join(',')},${alpha})`
  const wrap = (v, lo, hi) => { const span = hi - lo; return ((((v - lo) % span) + span) % span) + lo }
  const smoother = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * x * (x * (x * 6 - 15) + 10) }
  const SUBTLE = 0.55

  function drifting(r, w, h, count, speed) {
    return Array.from({ length: count }, () => ({ x0: r() * w, y0: r() * h, vx: (r() - 0.5) * speed, vy: (r() - 0.5) * speed, p: r() * TAU }))
  }
  const at = (n, t, w, h) => ({ x: wrap(n.x0 + n.vx * t, -20, w + 20), y: wrap(n.y0 + n.vy * t, -20, h + 20) })

  function drawMesh(ctx, nodes, t, w, h, reach, k, alphaLine, alphaDot) {
    const pts = nodes.map((n) => at(n, t, w, h))
    ctx.lineWidth = 1
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < reach) { ctx.strokeStyle = tint(a.x, w, (1 - d / reach) * alphaLine * k); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }
    }
    pts.forEach((p, i) => {
      ctx.fillStyle = tint(p.x, w, (alphaDot + 0.25 * Math.sin(t * 1.2 + nodes[i].p)) * k)
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, TAU); ctx.fill()
    })
  }

  // Edge points of the logo: where brightness or opacity changes sharply,
  // thinned on a grid so the mesh spacing stays even.
  function sampleLogo(img) {
    const S = 220, c = document.createElement('canvas'); c.width = c.height = S
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, S, S)
    const d = g.getImageData(0, 0, S, S).data
    const L = (x, y) => { const i = (y * S + x) * 4; return (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * d[i + 3] / 255 }
    const A = (x, y) => d[(y * S + x) * 4 + 3]
    const cand = []
    for (let y = 1; y < S - 1; y++) for (let x = 1; x < S - 1; x++) {
      const grad = Math.abs(L(x + 1, y) - L(x - 1, y)) + Math.abs(L(x, y + 1) - L(x, y - 1)) + (Math.abs(A(x + 1, y) - A(x - 1, y)) + Math.abs(A(x, y + 1) - A(x, y - 1))) * 0.5
      if (grad > 70) cand.push({ x: x / S, y: y / S, grad })
    }
    const r = mulberry(99), cell = 6, taken = new Set(), out = []
    cand.sort((a, b) => b.grad - a.grad)
    for (const p of cand) {
      const key = `${Math.floor((p.x * S) / cell)},${Math.floor((p.y * S) / cell)}`
      if (taken.has(key)) continue
      taken.add(key); out.push({ x: p.x + (r() - 0.5) * 0.004, y: p.y + (r() - 0.5) * 0.004 })
    }
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
    return out
  }

  function mesh(w, h) {
    const r = mulberry(7)
    const nodes = drifting(r, w, h, Math.min(120, Math.round((w * h) / 13000)), 16)
    const reach = Math.max(90, Math.min(w, h) * 0.2)
    return (ctx, t) => drawMesh(ctx, nodes, t, w, h, reach, SUBTLE, 0.3, 0.35)
  }

  function owl(w, h, logo, layout) {
    const r = mulberry(11)
    const size = layout.size
    const targets = sampleLogo(logo).slice(0, Math.round(Math.min(340, 150 + size * 0.22)))
    // Each node flies in from a scattered start with its own small delay: a
    // staggered, eased assembly instead of a springy snap.
    const nodes = targets.map((p) => ({
      tx: layout.cx + (p.x - 0.5) * size, ty: layout.cy + (p.y - 0.5) * size,
      sx: r() * w, sy: r() * h, delay: r() * 0.5, ph: r() * TAU,
    }))
    const reach = size * 0.052, edges = []
    for (let i = 0; i < nodes.length; i++) {
      let count = 0
      for (let j = i + 1; j < nodes.length && count < 4; j++) {
        const d = Math.hypot(nodes[i].tx - nodes[j].tx, nodes[i].ty - nodes[j].ty)
        if (d < reach) { edges.push([i, j, d / reach]); count++ }
      }
    }
    const free = drifting(r, w, h, 34, 14)
    const freeReach = Math.min(w, h) * 0.18
    // Formed after ~2.5 s: the opening card is only a few seconds long.
    const ASSEMBLE = 2.1
    return (ctx, t) => {
      const k = SUBTLE
      const pos = nodes.map((n) => {
        const e = smoother((t - n.delay) / ASSEMBLE)
        const wx = Math.sin(t * 0.55 + n.ph) * size * 0.005, wy = Math.cos(t * 0.47 + n.ph) * size * 0.005
        return { x: mix(n.sx, n.tx, e) + wx * e, y: mix(n.sy, n.ty, e) + wy * e, e }
      })
      const settle = smoother((t - 0.3) / ASSEMBLE)
      drawMesh(ctx, free, t, w, h, freeReach, k, 0.16, 0.3)
      ctx.lineWidth = 1
      for (const [i, j, q] of edges) {
        const a = pos[i], b = pos[j]
        ctx.strokeStyle = tint(a.x, w, (0.04 + 0.36 * settle) * (1 - q * 0.6) * k)
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
      pos.forEach((p, i) => {
        ctx.fillStyle = tint(p.x, w, (0.3 + 0.2 * Math.sin(t * 1.1 + nodes[i].ph)) * k)
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, TAU); ctx.fill()
      })
    }
  }

  /** Mounts a backdrop on `canvas` (design size w×h) and returns draw(t). */
  function mount(canvas, { kind, w, h, logo, layout }) {
    const scale = 2
    canvas.width = w * scale; canvas.height = h * scale
    const ctx = canvas.getContext('2d')
    const paint = kind === 'owl' ? owl(w, h, logo, layout) : mesh(w, h)
    return (t) => {
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.clearRect(0, 0, w, h)
      paint(ctx, t)
    }
  }

  return { mount }
})()
