#!/usr/bin/env node
// Fails when frontend code uses a raw Tailwind palette class (text-red-400, bg-slate-100/20, …), a
// hex/rgb colour literal or a raw radius class (rounded, rounded-md, …) instead of a semantic design
// token (text-critical-fg, bg-warning-soft, border-control, rounded-control, …; see
// design/tokens.json and docs/design-system.md). One meaning, one colour, one shape per role.
//
// Data visualisation is deliberately outside the token set and allow-listed below.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'frontend/src')

// Categorical avatar colours and the heatmap ramp are data-viz, not status semantics.
const ALLOW = new Set(['lib/avatarUtils.ts', 'lib/heatmapUtils.ts'])
const SKIP_DIRS = new Set(['generated', 'testdata'])

const PALETTE = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|shadow|outline|divide|decoration|accent|caret|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/
const RADIUS = /(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br))?(?:-(?:sm|md|lg|xl|2xl|3xl|full))?(?![\w[-])/
const LITERAL = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])|\brgba?\(/

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(p)
    } else if (/\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) && name !== 'index.css') {
      yield p
    }
  }
}

const problems = []
for (const file of walk(SRC)) {
  const rel = relative(SRC, file)
  if (ALLOW.has(rel)) continue
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return // comments may mention the old classes
    const m = line.match(PALETTE) || line.match(LITERAL) || line.match(RADIUS)
    if (m) problems.push(`${rel}:${i + 1}  ${m[0]}`)
  })
}

if (problems.length) {
  console.error('Raw colours or radii found — use a semantic token instead (docs/design-system.md):')
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
console.log('design drift check: no raw palette classes, colour literals or radii in frontend/src')
