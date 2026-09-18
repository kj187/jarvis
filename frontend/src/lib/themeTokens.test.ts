/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../generated/tokens.css', import.meta.url), 'utf8')

// Token blocks: the dark defaults live in @theme, overrides in [data-theme="light"].
const darkBlock = css.slice(css.indexOf('@theme'), css.indexOf('[data-theme="light"]'))
const lightBlock = css.slice(css.indexOf('[data-theme="light"]'))

type Hsla = [number, number, number, number]

function token(block: string, name: string): [number, number, number] {
  const [h, s, l] = tokenA(block, name)
  return [h, s, l]
}

// hsl(H S% L%) or hsl(H S% L% / A)
function tokenA(block: string, name: string): Hsla {
  const m = block.match(new RegExp(`--color-${name}:\\s*hsl\\((\\d+) (\\d+)% (\\d+)%(?: / ([\\d.]+))?\\)`))
  if (!m) throw new Error(`token --color-${name} not found`)
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
}

function luminance([h, s, l]: [number, number, number]): number {
  const sat = s / 100
  const lig = l / 100
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  const lin = [f(0), f(8), f(4)].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const SURFACES = ['background', 'card', 'header', 'input', 'muted', 'accent']

describe('focus ring contrast (WCAG 2.2 SC 1.4.11 / 2.4.11, >= 3:1)', () => {
  it.each(SURFACES)('dark ring vs %s', (surface) => {
    expect(contrast(token(darkBlock, 'ring'), token(darkBlock, surface))).toBeGreaterThanOrEqual(3)
  })

  // Light overrides only some tokens; the rest fall back to the dark @theme value,
  // which is never what renders in light mode, so resolve surfaces from the light block only.
  it.each(SURFACES)('light ring vs %s', (surface) => {
    expect(contrast(token(lightBlock, 'ring'), token(lightBlock, surface))).toBeGreaterThanOrEqual(3)
  })
})

// Field edges (`border-control`) are the only cue that a text field/select exists,
// so they need >= 3:1 against the surface they sit on and against their own fill.
const CONTROL_SURFACES = ['background', 'card', 'header', 'input']

describe('field border contrast (WCAG 2.2 SC 1.4.11, >= 3:1)', () => {
  it.each(CONTROL_SURFACES)('dark control vs %s', (surface) => {
    expect(contrast(token(darkBlock, 'control'), token(darkBlock, surface))).toBeGreaterThanOrEqual(3)
  })

  it.each(CONTROL_SURFACES)('light control vs %s', (surface) => {
    expect(contrast(token(lightBlock, 'control'), token(lightBlock, surface))).toBeGreaterThanOrEqual(3)
  })
})

// ── status roles ─────────────────────────────────────────────────────────────
// Each role is text (-fg) on a tinted fill (-soft, often translucent, so it is composited over the
// surface it sits on) with an edge (-edge). Text must reach 4.5:1 on that fill, on card and background.
const ROLES = ['critical', 'warning', 'info', 'neutral', 'success', 'attention', 'claim']

function rgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sat = s / 100
  const lig = l / 100
  const a = sat * Math.min(lig, 1 - lig)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return lig - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

// Blend a translucent fill over an opaque surface (both hsl), return the resulting hsl-ish luminance colour.
function over(fill: Hsla, surface: [number, number, number]): number {
  const a = fill[3]
  const [fr, fg, fb] = rgb([fill[0], fill[1], fill[2]])
  const [sr, sg, sb] = rgb(surface)
  const mix = [fr * a + sr * (1 - a), fg * a + sg * (1 - a), fb * a + sb * (1 - a)].map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * mix[0] + 0.7152 * mix[1] + 0.0722 * mix[2]
}

describe.each([
  ['dark', darkBlock],
  ['light', lightBlock],
])('status role text contrast, %s theme (WCAG AA 4.5:1)', (_theme, block) => {
  // Light only overrides some tokens; every role is fully defined in both blocks.
  const source = _theme === 'dark' ? darkBlock : lightBlock
  const surfaces = (['background', 'card'] as const).map((n) => [n, token(source, n)] as const)
  it.each(ROLES.flatMap((r) => surfaces.map(([n, surf]) => [r, n, surf] as const)))('%s text on its fill over %s', (role, _n, surf) => {
    const fg = luminance(token(block, `${role}-fg`))
    const fill = over(tokenA(block, `${role}-soft`), surf)
    const ratio = (Math.max(fg, fill) + 0.05) / (Math.min(fg, fill) + 0.05)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})
