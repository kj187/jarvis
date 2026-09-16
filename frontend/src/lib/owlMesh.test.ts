import { describe, expect, it } from 'vitest'
import {
  buildMeshEdges,
  buildMeshNodes,
  mulberry32,
  nodePositionAt,
  sampleEdgePoints,
  type MeshNode,
} from './owlMesh'

describe('mulberry32', () => {
  it('is deterministic for the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect(a()).toBe(b())
    expect(a()).toBe(b())
  })

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })

  it('stays within [0, 1)', () => {
    const rand = mulberry32(7)
    for (let i = 0; i < 200; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

/** Builds a square RGBA bitmap with a filled square of solid color in the middle, transparent elsewhere — gives a bitmap with clear, known edges. */
function squareBitmap(size: number, squareStart: number, squareEnd: number) {
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const inside = x >= squareStart && x < squareEnd && y >= squareStart && y < squareEnd
      pixels[i] = 0
      pixels[i + 1] = 0
      pixels[i + 2] = 0
      pixels[i + 3] = inside ? 255 : 0
    }
  }
  return pixels
}

describe('sampleEdgePoints', () => {
  it('finds no points in a fully transparent bitmap', () => {
    const pixels = new Uint8ClampedArray(40 * 40 * 4)
    const points = sampleEdgePoints(pixels, 40, 40)
    expect(points).toHaveLength(0)
  })

  it('finds points only near the border of a solid square', () => {
    const size = 40
    const points = sampleEdgePoints(squareBitmap(size, 10, 30), size, size, { gridStep: 1 })
    expect(points.length).toBeGreaterThan(0)
    for (const p of points) {
      const nearLeft = Math.abs(p.x - 10) <= 2
      const nearRight = Math.abs(p.x - 30) <= 2
      const nearTop = Math.abs(p.y - 10) <= 2
      const nearBottom = Math.abs(p.y - 30) <= 2
      expect(nearLeft || nearRight || nearTop || nearBottom).toBe(true)
    }
  })

  it('respects maxPoints', () => {
    const size = 60
    const points = sampleEdgePoints(squareBitmap(size, 5, 55), size, size, {
      gridStep: 1,
      maxPoints: 10,
    })
    expect(points.length).toBeLessThanOrEqual(10)
  })

  it('is deterministic for the same seed', () => {
    const size = 40
    const bitmap = squareBitmap(size, 10, 30)
    const a = sampleEdgePoints(bitmap, size, size, { gridStep: 1, seed: 3, maxPoints: 5 })
    const b = sampleEdgePoints(bitmap, size, size, { gridStep: 1, seed: 3, maxPoints: 5 })
    expect(a).toEqual(b)
  })

  it('ignores fully transparent pixels below the alpha threshold', () => {
    const size = 20
    const pixels = new Uint8ClampedArray(size * size * 4)
    // a single semi-transparent pixel, below the default threshold of 32
    const i = (10 * size + 10) * 4
    pixels[i] = 255
    pixels[i + 1] = 255
    pixels[i + 2] = 255
    pixels[i + 3] = 10
    const points = sampleEdgePoints(pixels, size, size, { gridStep: 1 })
    expect(points).toHaveLength(0)
  })
})

describe('buildMeshNodes', () => {
  it('returns an empty array for no points', () => {
    expect(buildMeshNodes([], { cx: 0, cy: 0, size: 100 })).toEqual([])
  })

  it('centers points on the given layout center', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ]
    const nodes = buildMeshNodes(points, { cx: 50, cy: 50, size: 20 })
    const avgX = (nodes[0].x + nodes[1].x) / 2
    const avgY = (nodes[0].y + nodes[1].y) / 2
    expect(avgX).toBeCloseTo(50, 5)
    expect(avgY).toBeCloseTo(50, 5)
  })

  it('scales the bounding box to fit layout.size on its longer axis', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const nodes = buildMeshNodes(points, { cx: 0, cy: 0, size: 50 })
    const spread = Math.abs(nodes[0].x - nodes[1].x)
    expect(spread).toBeCloseTo(50, 5)
  })

  it('assigns every node a phase, speed and amplitude', () => {
    const nodes = buildMeshNodes([{ x: 1, y: 1 }], { cx: 0, cy: 0, size: 10 })
    expect(nodes[0].phase).toBeGreaterThanOrEqual(0)
    expect(nodes[0].phase).toBeLessThan(Math.PI * 2)
    expect(nodes[0].speed).toBeGreaterThan(0)
    expect(nodes[0].amplitude).toBeGreaterThan(0)
  })

  it('is deterministic for the same seed', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 8 },
      { x: 12, y: 3 },
    ]
    const a = buildMeshNodes(points, { cx: 0, cy: 0, size: 40 }, { seed: 11 })
    const b = buildMeshNodes(points, { cx: 0, cy: 0, size: 40 }, { seed: 11 })
    expect(a).toEqual(b)
  })
})

describe('nodePositionAt', () => {
  const node: MeshNode = { x: 100, y: 200, phase: 0.5, speed: 0.3, amplitude: 4 }

  it('is a pure function of t — same t, same result', () => {
    expect(nodePositionAt(node, 1.5)).toEqual(nodePositionAt(node, 1.5))
  })

  it('stays within a bounded distance of the resting position', () => {
    // x and y drift on independent (differently-scaled) phases, so the path
    // is a lissajous-like wobble, not a circle — bounded by
    // amplitude * sqrt(1^2 + 0.7^2), not amplitude itself.
    const maxDist = node.amplitude * Math.hypot(1, 0.7)
    for (let t = 0; t < 20; t += 0.37) {
      const p = nodePositionAt(node, t)
      const dist = Math.hypot(p.x - node.x, p.y - node.y)
      expect(dist).toBeLessThanOrEqual(maxDist + 1e-9)
    }
  })

  it('moves over time (not frozen)', () => {
    const p0 = nodePositionAt(node, 0)
    const p1 = nodePositionAt(node, 3)
    expect(p0).not.toEqual(p1)
  })
})

describe('buildMeshEdges', () => {
  it('connects nodes within reach', () => {
    const nodes: MeshNode[] = [
      { x: 0, y: 0, phase: 0, speed: 0, amplitude: 0 },
      { x: 1, y: 0, phase: 0, speed: 0, amplitude: 0 },
    ]
    expect(buildMeshEdges(nodes, 5)).toEqual([{ a: 0, b: 1 }])
  })

  it('does not connect nodes beyond reach', () => {
    const nodes: MeshNode[] = [
      { x: 0, y: 0, phase: 0, speed: 0, amplitude: 0 },
      { x: 100, y: 0, phase: 0, speed: 0, amplitude: 0 },
    ]
    expect(buildMeshEdges(nodes, 5)).toEqual([])
  })

  it('never duplicates a pair or connects a node to itself', () => {
    const nodes: MeshNode[] = [
      { x: 0, y: 0, phase: 0, speed: 0, amplitude: 0 },
      { x: 1, y: 0, phase: 0, speed: 0, amplitude: 0 },
      { x: 2, y: 0, phase: 0, speed: 0, amplitude: 0 },
    ]
    const edges = buildMeshEdges(nodes, 10)
    const keys = edges.map((e) => `${e.a}-${e.b}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(edges.every((e) => e.a !== e.b)).toBe(true)
  })

  it('returns no edges for a single node', () => {
    const nodes: MeshNode[] = [{ x: 0, y: 0, phase: 0, speed: 0, amplitude: 0 }]
    expect(buildMeshEdges(nodes, 100)).toEqual([])
  })
})
