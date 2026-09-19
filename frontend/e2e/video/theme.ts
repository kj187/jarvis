import { palette } from './generated-theme'

// Colours of the release-video cards (title, feature, outro, cover). The base palette is generated
// from design/tokens.json (generated-theme.ts); the brand accents are product blue and coral — the
// logo's two eyes. The earlier violet accent is gone: new videos use blue with a coral counterweight.

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

export const theme = {
  /** Deeper than the app background so cards read as a stage, not a screenshot. */
  stage: '#060912',
  blue: palette.blue,
  coral: palette.coral,
  /** Light blue for heading gradients and inline code — replaces the former lavender. */
  blueSoft: '#bfdbfe',
} as const

/** RGB triples handed to backdrops.js (plain JS in the page, no imports). */
export const backdropPalette = {
  blue: hexToRgb(palette.blue),
  blueLight: hexToRgb('#93c5fd'),
  coral: hexToRgb(palette.coral),
}
