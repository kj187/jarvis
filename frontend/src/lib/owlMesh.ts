/**
 * Pure geometry for the "owl mesh" empty-state backdrop: samples edge points
 * from a bitmap, lays them out as nodes with a small per-node drift, and
 * builds the static neighbourhood graph between them. No DOM/canvas access
 * here — `OwlMeshBackdrop.tsx` owns rasterizing the logo and painting.
 */

export interface MeshPoint {
  x: number
  y: number
}

export interface MeshNode extends MeshPoint {
  /** Per-node drift phase (radians) so nodes don't move in lockstep. */
  phase: number
  /** Per-node drift angular speed. */
  speed: number
  /** Per-node drift amplitude, in the same units as x/y. */
  amplitude: number
}

export interface MeshEdge {
  a: number
  b: number
}

/** Deterministic PRNG (mulberry32) — reproducible sampling/layout for tests and a stable look across renders. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SampleEdgePointsOptions {
  gridStep?: number
  alphaThreshold?: number
  gradientThreshold?: number
  maxPoints?: number
  seed?: number
}

/**
 * Samples edge points from RGBA pixel data via a gradient-magnitude
 * threshold on alpha-premultiplied luminance plus raw alpha (so both a
 * flat-colored silhouette-on-transparent icon and internal color detail
 * produce edges), thinned onto a grid so points stay evenly spaced, then
 * deterministically shuffled and capped. Pure function of the pixel buffer —
 * unit-testable with a synthetic bitmap, no image decoding involved.
 */
export function sampleEdgePoints(
  pixels: Uint8ClampedArray | number[],
  width: number,
  height: number,
  opts: SampleEdgePointsOptions = {},
): MeshPoint[] {
  const gridStep = opts.gridStep ?? 6
  const alphaThreshold = opts.alphaThreshold ?? 32
  const gradientThreshold = opts.gradientThreshold ?? 70
  const maxPoints = opts.maxPoints ?? 260
  const rand = mulberry32(opts.seed ?? 99)

  const alphaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0
    return pixels[(y * width + x) * 4 + 3]
  }
  const luminanceAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0
    const i = (y * width + x) * 4
    const a = pixels[i + 3]
    return ((pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11) * a) / 255
  }

  const candidates: MeshPoint[] = []
  for (let y = 1; y < height - 1; y += gridStep) {
    for (let x = 1; x < width - 1; x += gridStep) {
      if (alphaAt(x, y) < alphaThreshold) continue
      const lGrad =
        Math.abs(luminanceAt(x + 1, y) - luminanceAt(x - 1, y)) +
        Math.abs(luminanceAt(x, y + 1) - luminanceAt(x, y - 1))
      const aGrad =
        Math.abs(alphaAt(x + 1, y) - alphaAt(x - 1, y)) + Math.abs(alphaAt(x, y + 1) - alphaAt(x, y - 1))
      if (lGrad + aGrad * 0.5 > gradientThreshold) {
        candidates.push({ x, y })
      }
    }
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = tmp
  }
  return candidates.slice(0, maxPoints)
}

export interface MeshLayout {
  cx: number
  cy: number
  size: number
}

export interface BuildMeshNodesOptions {
  seed?: number
  driftAmplitude?: number
  driftSpeedMin?: number
  driftSpeedMax?: number
}

/**
 * Centers and scales sampled points into `layout` (preserving the source
 * bitmap's aspect ratio) and assigns each a small, unique drift phase/speed/
 * amplitude — the resting position a node breathes around, not an assemble
 * animation.
 */
export function buildMeshNodes(
  points: MeshPoint[],
  layout: MeshLayout,
  opts: BuildMeshNodesOptions = {},
): MeshNode[] {
  if (points.length === 0) return []
  const rand = mulberry32(opts.seed ?? 7)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  const scale = layout.size / Math.max(w, h)
  const offsetX = layout.cx - ((minX + maxX) / 2) * scale
  const offsetY = layout.cy - ((minY + maxY) / 2) * scale

  const driftAmplitude = opts.driftAmplitude ?? 2.2
  const speedMin = opts.driftSpeedMin ?? 0.15
  const speedMax = opts.driftSpeedMax ?? 0.4

  return points.map((p) => ({
    x: p.x * scale + offsetX,
    y: p.y * scale + offsetY,
    phase: rand() * Math.PI * 2,
    speed: speedMin + rand() * (speedMax - speedMin),
    amplitude: driftAmplitude * (0.6 + rand() * 0.8),
  }))
}

/**
 * The node's resting position plus a small elliptical drift — a pure
 * function of `t`: calling it repeatedly with the same `t` always returns
 * the same point (needed for deterministic tests and for pausing/resuming
 * the animation without a jump).
 */
export function nodePositionAt(node: MeshNode, t: number): MeshPoint {
  const angle = node.phase + t * node.speed
  return {
    x: node.x + Math.cos(angle) * node.amplitude,
    y: node.y + Math.sin(angle * 1.3) * node.amplitude * 0.7,
  }
}

/**
 * Builds the static neighbourhood graph once, from resting positions —
 * recomputing this every frame is unnecessary since drift amplitude is
 * small relative to `reach`.
 */
export function buildMeshEdges(nodes: MeshNode[], reach: number): MeshEdge[] {
  const edges: MeshEdge[] = []
  const reachSq = reach * reach
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x
      const dy = nodes[i].y - nodes[j].y
      if (dx * dx + dy * dy <= reachSq) {
        edges.push({ a: i, b: j })
      }
    }
  }
  return edges
}
