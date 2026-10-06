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
 *   1. Only the files listed in READERS may mention either identifier, and
 *      each only the identifier(s) listed for it (the detail panel may read
 *      `labelColors`, never `labelDisplay`).
 *   2. In those files every use is one of the sanctioned shapes: the store
 *      selector `useSettingsStore((s) => s.<name>)` (the property itself, no
 *      further `.hidden`/`.order` access), a declaration, a prop hand-over to
 *      a component listed in PROP_TARGETS, or the argument of
 *      `partitionLabelsForDisplay` (labelDisplay) / `labelColorStyle`
 *      (labelColors). Anything else — e.g. `labelDisplay.hidden.includes(k)`
 *      in a filter, `s.labelDisplay.hidden` in a selector, or a prop handed to
 *      an arbitrary component — is a violation.
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
// reader file -> the identifiers it may touch
const READERS: Record<string, readonly string[]> = {
  'components/alerts/AlertCard.tsx': ['labelDisplay'],
  'components/alerts/AlertListView.tsx': ['labelDisplay'],
  'components/alerts/AlertListRow.tsx': ['labelDisplay'],
  'components/alerts/LabelChip.tsx': ['labelColors'],
  'components/alerts/AlertsOverviewModal.tsx': ['labelColors'],
  'components/alerts/AlertDetailRelatedSection.tsx': ['labelColors'],
  'components/alerts/AlertDetailPanel.tsx': ['labelColors'],
  'components/silences/SilenceMatcherChip.tsx': ['labelColors'],
}
// Components that may receive the configuration as a prop; each one only
// passes it to the matching sink (AlertListView.tsx PartitionedLabelChips).
const PROP_TARGETS = new Set(['PartitionedLabelChips'])

function calleeName(call: ts.CallExpression): string | undefined {
  return ts.isIdentifier(call.expression) ? call.expression.text : undefined
}

function jsxTagOf(attr: ts.JsxAttribute): string | undefined {
  const el = attr.parent.parent // JsxAttributes -> JsxOpeningElement | JsxSelfClosingElement
  return ts.isJsxOpeningElement(el) || ts.isJsxSelfClosingElement(el) ? el.tagName.getText() : undefined
}

/** `useSettingsStore((s) => s.<name>)` — exactly the property, nothing deeper. */
function isStoreSelector(pae: ts.PropertyAccessExpression): boolean {
  let body: ts.Node = pae
  if (ts.isParenthesizedExpression(body.parent)) body = body.parent
  const fn = body.parent
  if (!fn || !ts.isArrowFunction(fn) || fn.body !== body) return false
  const call = fn.parent
  return ts.isCallExpression(call) && call.arguments.includes(fn) && calleeName(call) === 'useSettingsStore'
}

/** Is this identifier one of the sanctioned ways to touch the configuration? */
function isSanctioned(node: ts.Identifier): boolean {
  const parent = node.parent

  // const labelDisplay = …   /   { labels, labelDisplay }: Props   /   labelDisplay: T
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true
  // function params: ({ labels, labelDisplay }: Props); never `const { labelDisplay } = useSettingsStore()`
  if (ts.isBindingElement(parent) && parent.name === node) {
    let pattern: ts.Node = parent.parent
    while (ts.isBindingElement(pattern.parent) || ts.isObjectBindingPattern(pattern.parent)) pattern = pattern.parent
    return ts.isParameter(pattern.parent)
  }
  if (ts.isParameter(parent) && parent.name === node) return true
  if (ts.isPropertySignature(parent) && parent.name === node) return true
  // <PartitionedLabelChips labelDisplay={labelDisplay} /> — the prop hand-over, only to listed components
  if (ts.isJsxAttribute(parent) && parent.name === node) return PROP_TARGETS.has(jsxTagOf(parent) ?? '')
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return PROP_TARGETS.has(jsxTagOf(parent.parent) ?? '')

  // useSettingsStore((s) => s.labelDisplay) — and not s.labelDisplay.hidden
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return isStoreSelector(parent)

  // partitionLabelsForDisplay(labels, labelDisplay) / labelColorStyle(key, labelColors, theme)
  if (ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return calleeName(parent) === SINK[node.text]
  }
  return false
}

function violationsIn(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const at = (node: ts.Node) => `${path}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
  const visit = (node: ts.Node) => {
    // s['labelDisplay'] sidesteps the identifier check
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      NAMES.has(node.text) &&
      ts.isElementAccessExpression(node.parent) &&
      !OWNERS.has(path)
    ) {
      out.push(`${at(node)}: \`${node.text}\` read through an element access`)
    }
    if (ts.isIdentifier(node) && NAMES.has(node.text)) {
      const where = at(node)
      const allowed = READERS[path]
      if (!OWNERS.has(path) && !allowed) {
        out.push(`${where}: \`${node.text}\` read outside the allowed readers`)
      } else if (!OWNERS.has(path) && !allowed.includes(node.text)) {
        out.push(`${where}: \`${node.text}\` is not allowed in this file (allowed: ${allowed.join(', ')})`)
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
    expect([...OWNERS, ...Object.keys(READERS)].filter((f) => !present.has(f))).toEqual([])
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

    it('the detail panel reading labelDisplay (per-identifier allowance)', () => {
      const src = `
        const labelDisplay = useSettingsStore((s) => s.labelDisplay)
        const parts = partitionLabelsForDisplay(labels, labelDisplay)`
      expect(violationsIn('components/alerts/AlertDetailPanel.tsx', src).length).toBeGreaterThan(0)
    })

    it('a selector that reaches into the hidden list', () => {
      const src = `const hidden = useSettingsStore((s) => s.labelDisplay.hidden)`
      expect(violationsIn('components/alerts/AlertCard.tsx', src).length).toBeGreaterThan(0)
    })

    it('a selector read through an element access', () => {
      const src = `const hidden = useSettingsStore((s) => s['labelDisplay'])`
      expect(violationsIn('components/alerts/AlertCard.tsx', src).length).toBeGreaterThan(0)
    })

    it('a prop hand-over to a component that is not on the list', () => {
      const src = `
        const labelDisplay = useSettingsStore((s) => s.labelDisplay)
        const el = <SomethingElse labelDisplay={labelDisplay} />`
      expect(violationsIn('components/alerts/AlertListView.tsx', src).length).toBeGreaterThan(0)
    })

    it('destructuring the whole store', () => {
      const src = `const { labelDisplay } = useSettingsStore()`
      expect(violationsIn('components/alerts/AlertCard.tsx', src).length).toBeGreaterThan(0)
    })

    it('the sanctioned shapes pass', () => {
      const src = `
        const labelDisplay = useSettingsStore((s) => s.labelDisplay)
        const parts = partitionLabelsForDisplay(labels, labelDisplay)
        const el = <PartitionedLabelChips labels={labels} labelDisplay={labelDisplay} />
        function PartitionedLabelChips({ labels, labelDisplay }: P) { return partitionLabelsForDisplay(labels, labelDisplay) }`
      expect(violationsIn('components/alerts/AlertListView.tsx', src)).toEqual([])
      const colors = `const labelColors = useSettingsStore((s) => s.labelColors)\n        const style = labelColorStyle(key, labelColors, theme)`
      expect(violationsIn('components/alerts/AlertDetailPanel.tsx', colors)).toEqual([])
    })
  })
})
