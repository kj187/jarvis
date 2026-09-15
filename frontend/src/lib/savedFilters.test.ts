import { describe, expect, it } from 'vitest'
import {
  toSavedFilterMatchers,
  matcherListsEqual,
  findActiveSavedFilter,
  findDefaultSavedFilter,
  validateSavedFilterName,
  addSavedFilter,
  renameSavedFilter,
  replaceSavedFilterMatchers,
  deleteSavedFilter,
  toggleDefaultSavedFilter,
  hasAlertViewParams,
  resolveSavedFilterStatus,
} from './savedFilters'
import { normalizeSettings } from './settingsUtils'
import type { SavedFilter } from './settingsUtils'
import type { LabelMatcher } from '@/types'

function matcher(name: string, operator: LabelMatcher['operator'], value: string, id = '1'): LabelMatcher {
  return { id, name, operator, value }
}

function savedFilter(name: string, matchers: Omit<LabelMatcher, 'id'>[], isDefault = false): SavedFilter {
  return { name, matchers, isDefault }
}

describe('toSavedFilterMatchers', () => {
  it('strips the runtime id', () => {
    const result = toSavedFilterMatchers([matcher('severity', '=', 'critical')])
    expect(result).toEqual([{ name: 'severity', operator: '=', value: 'critical' }])
    expect(result[0]).not.toHaveProperty('id')
  })

  it('drops exact duplicates, first occurrence wins', () => {
    const result = toSavedFilterMatchers([
      matcher('severity', '=', 'critical', 'a'),
      matcher('severity', '=', 'critical', 'b'),
    ])
    expect(result).toEqual([{ name: 'severity', operator: '=', value: 'critical' }])
  })

  it('rebuilds every matcher in { name, operator, value } key order', () => {
    const result = toSavedFilterMatchers([matcher('severity', '=', 'critical')])
    expect(Object.keys(result[0])).toEqual(['name', 'operator', 'value'])
  })
})

describe('matcherListsEqual', () => {
  it('is true for the same set in a different order', () => {
    const a = [matcher('env', '=', 'prod', '1'), matcher('severity', '=', 'critical', '2')]
    const b = [matcher('severity', '=', 'critical', '3'), matcher('env', '=', 'prod', '4')]
    expect(matcherListsEqual(a, b)).toBe(true)
  })

  it('ignores duplicates', () => {
    const a = [matcher('env', '=', 'prod', '1'), matcher('env', '=', 'prod', '2')]
    const b = [matcher('env', '=', 'prod', '3')]
    expect(matcherListsEqual(a, b)).toBe(true)
  })

  it('is false when an operator differs', () => {
    const a = [matcher('env', '=', 'prod')]
    const b = [matcher('env', '!=', 'prod')]
    expect(matcherListsEqual(a, b)).toBe(false)
  })

  it('is false when a value differs', () => {
    const a = [matcher('env', '=', 'prod')]
    const b = [matcher('env', '=', 'staging')]
    expect(matcherListsEqual(a, b)).toBe(false)
  })

  it('is true for two empty lists', () => {
    expect(matcherListsEqual([], [])).toBe(true)
  })
})

describe('findActiveSavedFilter', () => {
  const saved = [
    savedFilter('Prod critical', [{ name: 'env', operator: '=', value: 'prod' }, { name: 'severity', operator: '=', value: 'critical' }]),
    savedFilter('Default', [{ name: 'severity', operator: '=', value: 'critical' }], true),
  ]

  it('returns null when the current filter is empty', () => {
    expect(findActiveSavedFilter([], saved)).toBeNull()
  })

  it('returns the first matching saved filter', () => {
    const current = [matcher('severity', '=', 'critical', '1'), matcher('env', '=', 'prod', '2')]
    expect(findActiveSavedFilter(current, saved)?.name).toBe('Prod critical')
  })

  it('returns null when nothing matches', () => {
    const current = [matcher('team', '=', 'payments')]
    expect(findActiveSavedFilter(current, saved)).toBeNull()
  })
})

describe('findDefaultSavedFilter', () => {
  it('returns the default entry when one exists', () => {
    const saved = [savedFilter('A', []), savedFilter('B', [], true)]
    expect(findDefaultSavedFilter(saved)?.name).toBe('B')
  })

  it('returns null when there is no default', () => {
    const saved = [savedFilter('A', []), savedFilter('B', [])]
    expect(findDefaultSavedFilter(saved)).toBeNull()
  })
})

describe('resolveSavedFilterStatus', () => {
  const critical = savedFilter('Critical', [{ name: 'severity', operator: '=', value: 'critical' }])
  const warnings = savedFilter('Warnings', [{ name: 'severity', operator: '=', value: 'warning' }])
  const saved = [critical, warnings]

  it('is empty when there are no chips, even with a base', () => {
    expect(resolveSavedFilterStatus([], saved, 'Critical')).toEqual({ kind: 'empty' })
  })

  it('is saved when the chips equal a saved filter, regardless of the base', () => {
    const current = [matcher('severity', '=', 'warning')]
    expect(resolveSavedFilterStatus(current, saved, 'Critical')).toEqual({ kind: 'saved', filter: warnings })
  })

  it('is modified when the chips differ from every saved filter and the base still exists', () => {
    const current = [matcher('severity', '=', 'critical'), matcher('env', '=', 'prod')]
    expect(resolveSavedFilterStatus(current, saved, 'Critical')).toEqual({ kind: 'modified', base: critical })
  })

  it('is unsaved without a base', () => {
    const current = [matcher('env', '=', 'prod')]
    expect(resolveSavedFilterStatus(current, saved, null)).toEqual({ kind: 'unsaved' })
  })

  it('ignores a base name that no longer exists (deleted or renamed elsewhere)', () => {
    const current = [matcher('env', '=', 'prod')]
    expect(resolveSavedFilterStatus(current, saved, 'Gone')).toEqual({ kind: 'unsaved' })
  })
})

describe('validateSavedFilterName', () => {
  const saved = [savedFilter('Prod', [])]

  it('rejects whitespace-only names as empty', () => {
    expect(validateSavedFilterName(saved, '   ')).toBe('empty')
  })

  it('rejects a case-insensitive duplicate', () => {
    expect(validateSavedFilterName(saved, 'prod')).toBe('duplicate')
  })

  it('allows a case-only rename via exceptName', () => {
    expect(validateSavedFilterName(saved, 'PROD', 'Prod')).toBeNull()
  })

  it('accepts a genuinely new name', () => {
    expect(validateSavedFilterName(saved, 'Staging')).toBeNull()
  })
})

describe('list operations', () => {
  it('addSavedFilter appends with isDefault false and a trimmed name', () => {
    const result = addSavedFilter([], '  New filter  ', [matcher('severity', '=', 'critical')])
    expect(result).toEqual([
      { name: 'New filter', matchers: [{ name: 'severity', operator: '=', value: 'critical' }], isDefault: false },
    ])
  })

  it('renameSavedFilter only touches the target', () => {
    const saved = [savedFilter('A', []), savedFilter('B', [])]
    const result = renameSavedFilter(saved, 'A', 'A renamed')
    expect(result).toEqual([savedFilter('A renamed', []), savedFilter('B', [])])
  })

  it('replaceSavedFilterMatchers only touches the target', () => {
    const saved = [savedFilter('A', [{ name: 'x', operator: '=', value: '1' }]), savedFilter('B', [])]
    const result = replaceSavedFilterMatchers(saved, 'A', [matcher('y', '=', '2')])
    expect(result).toEqual([savedFilter('A', [{ name: 'y', operator: '=', value: '2' }]), savedFilter('B', [])])
  })

  it('deleteSavedFilter removes only the target', () => {
    const saved = [savedFilter('A', []), savedFilter('B', [])]
    expect(deleteSavedFilter(saved, 'A')).toEqual([savedFilter('B', [])])
  })

  it('toggleDefaultSavedFilter sets exclusively', () => {
    const saved = [savedFilter('A', []), savedFilter('B', [])]
    const result = toggleDefaultSavedFilter(saved, 'B')
    expect(result).toEqual([savedFilter('A', [], false), savedFilter('B', [], true)])
  })

  it('toggleDefaultSavedFilter a second time removes the default', () => {
    const saved = [savedFilter('A', [], true)]
    expect(toggleDefaultSavedFilter(saved, 'A')).toEqual([savedFilter('A', [], false)])
  })

  it('every list operation result survives normalizeSettings unchanged (round-trip)', () => {
    let saved = addSavedFilter([], 'Prod critical', [matcher('env', '=', 'prod'), matcher('severity', '=', 'critical')])
    saved = toggleDefaultSavedFilter(saved, 'Prod critical')
    saved = renameSavedFilter(saved, 'Prod critical', 'Prod critical renamed')
    saved = replaceSavedFilterMatchers(saved, 'Prod critical renamed', [matcher('env', '=', 'prod')])
    const result = normalizeSettings({ savedFilters: saved })
    expect(JSON.stringify(result.savedFilters)).toBe(JSON.stringify(saved))
  })
})

describe('hasAlertViewParams', () => {
  it.each([
    [''],
    ['?settings=open'],
  ])('is false for %j', (search) => {
    expect(hasAlertViewParams(search)).toBe(false)
  })

  it.each([
    ['?state=active'],
    ['?q='],
    ['?matchers=[]'],
    ['?filter={}'],
    ['?alert=x'],
  ])('is true for %j', (search) => {
    expect(hasAlertViewParams(search)).toBe(true)
  })
})
