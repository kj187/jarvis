import { useEffect, useMemo, useRef, useState } from 'react'
import { Layers, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/useSettingsStore'
import { getFilterableLabels } from '@/lib/alertUtils'
import type { EnrichedAlert } from '@/types'

interface GroupingControlProps {
  alerts: EnrichedAlert[]
  enabled: boolean
  onToggleEnabled: (enabled: boolean) => void
}

/**
 * Combines the card/list "Grouped" on/off toggle with the "group by which
 * label" choice (`settings.groupByLabel`) in one popover — that choice used
 * to be reachable only from Settings, a level removed from the view it
 * actually affects.
 */
export function GroupingControl({ alerts, enabled, onToggleEnabled }: GroupingControlProps) {
  const groupByLabel = useSettingsStore((s) => s.groupByLabel)
  const update = useSettingsStore((s) => s.update)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (open) searchRef.current?.focus()
    else setSearch('')
  }, [open])

  // Same shape as the Settings sheet's label picker: every label present on
  // any visible alert, 'severity' pinned first (it's the default and always
  // valid even when no alert happens to carry the label), the rest alphabetical.
  const labelCounts = useMemo(() => {
    const map = new Map<string, Set<string>>()
    alerts.forEach((a) => {
      Object.entries(getFilterableLabels(a)).forEach(([k, v]) => {
        if (!v) return
        if (!map.has(k)) map.set(k, new Set())
        map.get(k)!.add(v)
      })
    })
    return map
  }, [alerts])

  const options = useMemo(() => {
    const unique = new Set(['severity', ...labelCounts.keys(), groupByLabel])
    return Array.from(unique).sort((a, b) => {
      if (a === 'severity') return -1
      if (b === 'severity') return 1
      return a.localeCompare(b)
    })
  }, [labelCounts, groupByLabel])

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((name) => name.toLowerCase().includes(q))
  }, [options, search])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="grouping-control-button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium transition-colors',
          enabled ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
        )}
        aria-expanded={open}
        aria-haspopup="true"
        title="Grouping"
      >
        <Layers className="h-3 w-3" />
        Grouped
        <span className={cn('text-[10px]', enabled ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
          · {groupByLabel}
        </span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          data-testid="grouping-panel"
          className="absolute right-0 top-full z-50 mt-1 flex w-72 flex-col rounded-md border border-border bg-popover p-2 shadow-lg"
        >
          <div className="mb-2 flex shrink-0 items-center justify-between border-b border-border pb-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Grouping
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => onToggleEnabled(!enabled)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                enabled ? 'bg-primary' : 'bg-input',
              )}
            >
              <span
                className={cn(
                  'pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform',
                  enabled ? 'translate-x-4' : 'translate-x-0',
                )}
              />
            </button>
          </div>

          <div
            className={cn(
              'mb-1.5 flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-input px-1.5 h-7',
              !enabled && 'pointer-events-none opacity-40',
            )}
          >
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter labels…"
              className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div
            className={cn(
              'combo-dropdown max-h-96 space-y-0.5 overflow-y-auto',
              !enabled && 'pointer-events-none opacity-40',
            )}
          >
            {filteredOptions.length === 0 && (
              <p className="px-1.5 py-2 text-xs text-muted-foreground">No labels match "{search}"</p>
            )}
            {filteredOptions.map((name) => {
              const selected = name === groupByLabel
              const count = labelCounts.get(name)?.size ?? 0
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => update({ groupByLabel: name })}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-left text-xs hover:bg-accent/60',
                    selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-3 w-3 shrink-0 items-center justify-center rounded-full border',
                      selected ? 'border-primary' : 'border-border',
                    )}
                  >
                    {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="flex-1 truncate font-mono">{name}</span>
                  {count > 0 && <span className="tabular-nums text-[10px] text-muted-foreground/70">{count}</span>}
                </button>
              )
            })}
          </div>

          <p className="mt-1.5 shrink-0 border-t border-border pt-2 text-[10.5px] leading-snug text-muted-foreground">
            Applies to Card and List view.
          </p>
        </div>
      )}
    </div>
  )
}
