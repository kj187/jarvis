/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Silence mutations already trigger a poll on the server. A second POST /poll
 * from the browser is redundant and, behind the server's minimum poll
 * interval, answered with 429 (logged as a warning) on fan-outs such as Extend
 * and group acknowledge. The frontend therefore never calls the poll endpoint.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

describe('browser poll trigger', () => {
  it('is never called from the frontend source', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => /triggerPoll|['"`]\/poll['"`]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(offenders).toEqual([])
  })
})
