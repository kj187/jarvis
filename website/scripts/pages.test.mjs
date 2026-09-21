import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { PAGES } from './pages.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

test('every docs/*.md file is registered in PAGES, so it cannot go unpublished silently', () => {
  const registered = new Set(PAGES.map((page) => page.src))
  const missing = fs
    .readdirSync(path.join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`)
    .filter((src) => !registered.has(src))

  assert.deepEqual(missing, [], `not registered in website/scripts/pages.mjs: ${missing.join(', ')}`)
})

test('every registered page source exists', () => {
  for (const { src } of PAGES) {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `${src} is listed in PAGES but missing`)
  }
})
