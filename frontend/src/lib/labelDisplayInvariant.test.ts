/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Critical Invariant #19 — label display configuration is display-only.
 *
 * `labelDisplay` (pinned/hidden labels) and `labelColors` (palette) may only
 * decide which chips `partitionLabelsForDisplay` emits and how `labelColorStyle`
 * paints them. They must never reach filtering, silence matching,
 * `findRelatedAlerts` or the detail panel's Labels section: a hidden label is
 * invisible, not absent.
 *
 * Mechanical form of the rule, over the real source tree:
 *   1. Only the files listed in READERS may mention either identifier.
 *   2. In those files every use is one of the sanctioned shapes: the store
 *      selector, a declaration, a prop hand-over, or the argument of
 *      `partitionLabelsForDisplay` (labelDisplay) / `labelColorStyle`
 *      (labelColors). Anything else — e.g. `labelDisplay.hidden.includes(k)`
 *      in a filter — is a violation.
 * A new reader therefore fails here until it is added on purpose, after
 * reading the invariant.
 */

const NAMES = new Set(['labelDisplay', 'labelColors'])
const SINK: Record<string, string> = {
  labelDisplay: 'partitionLabelsForDisplay',
  labelColors: 'labelColorStyle',
}

// Paths relative to src/. The settings UI and the settings model own the
// configuration itself and are exempt from rule 2.
const OWNERS = new Set(['lib/settingsUtils.ts', 'components/settings/SettingsSheet.tsx'])
const READERS = new Set([
  ...OWNERS,
  'components/alerts/AlertCard.tsx',
  'components/alerts/AlertListView.tsx',
  'components/alerts/AlertListRow.tsx',
  'components/alerts/LabelChip.tsx',
  'components/alerts/AlertsOverviewModal.tsx',
  'components/alerts/AlertDetailRelatedSection.tsx',
  'components/alerts/AlertDetailPanel.tsx',
  'components/silences/SilenceMatcherChip.tsx',
])

function calleeName(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined
}

/** Is this identifier one of the sanctioned ways to touch the configuration? */
function isSanctioned(node: ts.Identifier): boolean {
  const parent = node.parent

  // const labelDisplay = …   /   { labels, labelDisplay }: Props   /   labelDisplay: T
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true
  if (ts.isBindingElement(parent) && parent.name === node) return true
  if (ts.isParameter(parent) && parent.name === node) return true
  if (ts.isPropertySignature(parent) && parent.name === node) return true
  // <Chips labelDisplay={labelDisplay} /> — the prop hand-over
  if (ts.isJsxAttribute(parent) && parent.name === node) return true
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return true

  // useSettingsStore((s) => s.labelDisplay)
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
    let up: ts.Node | undefined = parent.parent
    while (up && !ts.isCallExpression(up) && !ts.isSourceFile(up)) up = up.parent
    if (up && ts.isCallExpression(up) && calleeName(up) === 'useSettingsStore') return true
    return false
  }

  // partitionLabelsForDisplay(labels, labelDisplay) / labelColorStyle(key, labelColors, theme)
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return calleeName(parent) === SINK[node.text]
  }
  return false
}

function violationsIn(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && NAMES.has(node.text)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart())
      const where = `${path}:${line + 1}`
      if (!READERS.has(path)) {
        out.push(`${where}: \`${node.text}\` read outside the allowed readers`)
      } else if (!OWNERS.has(path) && !isSanctioned(node)) {
        out.push(`${where}: \`${node.text}\` used other than as an argument of ${SINK[node.text]} (display-only, Invariant #19)`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return out
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(p)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

describe('Invariant #19: label display config is display-only', () => {
  const srcDir = fileURLToPath(new URL('..', import.meta.url))

  it('only the sanctioned readers touch labelDisplay/labelColors, and only as display input', () => {
    const files = sourceFiles(srcDir)
    expect(files.length).toBeGreaterThan(50) // the walk really saw the tree
    const violations = files.flatMap((f) => violationsIn(relative(srcDir, f), readFileSync(f, 'utf8')))
    expect(violations).toEqual([])
  })

  it('the allowed readers still exist (a rename must update the list)', () => {
    const present = new Set(sourceFiles(srcDir).map((f) => relative(srcDir, f)))
    expect([...READERS].filter((f) => !present.has(f))).toEqual([])
  })

  describe('rejects violating code (negative fixtures)', () => {
    it('a filter that consults the hidden labels', () => {
      const src = `export function matchesLabelMatchers(a: A, labelDisplay: D) { return !labelDisplay.hidden.includes(a.k) }`
      expect(violationsIn('lib/alertUtils.ts', src).length).toBeGreaterThan(0)
    })

    it('a new component that reads the config', () => {
      const src = `const labelColors = useSettingsStore((s) => s.labelColors)`
      expect(violationsIn('components/alerts/AlertDetailLabels.tsx', src).length).toBeGreaterThan(0)
    })

    it('an allowed reader that lets the config reach another function', () => {
      const src = `
        const labelDisplay = useSettingsStore((s) => s.labelDisplay)
        const related = findRelatedAlerts(alert, all, labelDisplay)`
      expect(violationsIn('components/alerts/AlertCard.tsx', src)).toHaveLength(1)
    })

    it('an allowed reader that filters on the hidden list directly', () => {
      const src = `
        const labelDisplay = useSettingsStore((s) => s.labelDisplay)
        const shown = alerts.filter((a) => !labelDisplay.hidden.includes(a.name))`
      expect(violationsIn('components/alerts/AlertCard.tsx', src)).toHaveLength(1)
    })

    it('the sanctioned shapes pass', () => {
      const src = `
        const labelDisplay = useSettingsStore((s) => s.labelDisplay)
        const labelColors = useSettingsStore((s) => s.labelColors)
        const parts = partitionLabelsForDisplay(labels, labelDisplay)
        const style = labelColorStyle(key, labelColors, theme)
        const el = <PartitionedLabelChips labels={labels} labelDisplay={labelDisplay} />`
      expect(violationsIn('components/alerts/AlertCard.tsx', src)).toEqual([])
    })
  })
})
