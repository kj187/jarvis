import { useEffect, useRef, useState } from 'react'
import { Bookmark, ChevronDown, Star, RefreshCw, Pencil, Trash2, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { MAX_SAVED_FILTERS, MAX_SAVED_FILTER_NAME_LENGTH } from '@/lib/settingsUtils'
import type { SavedFilter } from '@/lib/settingsUtils'
import {
  resolveSavedFilterStatus,
  validateSavedFilterName,
  addSavedFilter,
  renameSavedFilter,
  replaceSavedFilterMatchers,
  deleteSavedFilter,
  toggleDefaultSavedFilter,
} from '@/lib/savedFilters'

const CONFIRM_TIMEOUT_MS = 3000

const NAME_ERRORS = {
  empty: 'Name is required.',
  duplicate: 'A saved filter with this name already exists.',
} as const

function matchersSummary(matchers: SavedFilter['matchers']): string {
  return matchers.map((m) => `${m.name}${m.operator}${m.value}`).join(', ')
}

/** A two-click confirmation target: which action on which filter is armed. */
type PendingConfirm = { action: 'delete' | 'overwrite'; name: string } | null

/**
 * Quick-select and management menu for saved label filters (replaces the
 * removed "Default Filter" Settings section — see docs/features.md "Saved
 * filters"). Nothing auto-saves. How the current chips relate to the saved
 * filters comes from lib/savedFilters.ts resolveSavedFilterStatus:
 *   - saved:    button shows the filter's name.
 *   - modified: button shows the base filter's name in italics plus the
 *               unsaved dot; the footer offers "Save changes to <base>".
 *   - unsaved:  generic label plus the unsaved dot; the footer offers "save
 *               as new", rows offer an explicit (two-click) overwrite.
 * The base is a per-tab hint (uiStore.savedFilterBase), never trusted when
 * the named filter no longer exists.
 */
export function SavedFiltersMenu() {
  const labelMatchers = useUIStore((s) => s.filters.labelMatchers)
  const setLabelMatchers = useUIStore((s) => s.setLabelMatchers)
  const savedFilterBase = useUIStore((s) => s.savedFilterBase)
  const setSavedFilterBase = useUIStore((s) => s.setSavedFilterBase)
  const savedFilters = useSettingsStore((s) => s.savedFilters)
  const update = useSettingsStore((s) => s.update)
  const syncFailed = useSettingsStore((s) => s.origin === 'server' && s.syncState === 'error')

  const [open, setOpen] = useState(false)
  const [renamingName, setRenamingName] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameTouched, setRenameTouched] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null)
  const [newFilterName, setNewFilterName] = useState('')

  const ref = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const status = resolveSavedFilterStatus(labelMatchers, savedFilters, savedFilterBase)

  // Keep the base hint in step with what the user can see: whenever the chips
  // equal a saved filter (applied, saved, the default on load, or built by
  // hand to match), that filter becomes the base. Removing every chip does NOT
  // drop it — "remove the only chip, add a different one" is an ordinary edit
  // of that filter, and an empty filter shows no status anyway.
  const matchingName = status.kind === 'saved' ? status.filter.name : null
  useEffect(() => {
    if (matchingName !== null && matchingName !== savedFilterBase) setSavedFilterBase(matchingName)
  }, [matchingName, savedFilterBase, setSavedFilterBase])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // An in-progress rename handles its own Escape (input onKeyDown); only
      // close the popover when nothing inside it claimed the key.
      if (e.defaultPrevented) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (renamingName !== null) {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [renamingName])

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
  }, [])

  function clearConfirm() {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = null
    setPendingConfirm(null)
  }

  function toggleMenu() {
    if (open) {
      setOpen(false)
      return
    }
    // Transient popover state is reset on open rather than on close, so every
    // way of closing (button, outside click, Escape, apply) leaves nothing
    // stale behind — without a state-syncing effect.
    cancelRename()
    clearConfirm()
    setNewFilterName('')
    setOpen(true)
  }

  /** First click arms the action, a second click on the same target within
      CONFIRM_TIMEOUT_MS runs it — same pattern as "Reset all settings". */
  function confirmThen(action: 'delete' | 'overwrite', name: string, run: () => void) {
    if (pendingConfirm?.action === action && pendingConfirm.name === name) {
      clearConfirm()
      run()
      return
    }
    clearConfirm()
    setPendingConfirm({ action, name })
    confirmTimerRef.current = setTimeout(() => setPendingConfirm(null), CONFIRM_TIMEOUT_MS)
  }

  function cancelRename() {
    setRenamingName(null)
    setRenameValue('')
    setRenameTouched(false)
  }

  function startRename(filter: SavedFilter) {
    clearConfirm()
    setRenamingName(filter.name)
    setRenameValue(filter.name)
    setRenameTouched(false)
  }

  const renameError = renamingName === null
    ? null
    : validateSavedFilterName(savedFilters, renameValue, renamingName)

  function commitRename() {
    if (renamingName === null) return
    setRenameTouched(true)
    if (renameError) return
    const nextName = renameValue.trim()
    update({ savedFilters: renameSavedFilter(savedFilters, renamingName, nextName) })
    if (savedFilterBase === renamingName) setSavedFilterBase(nextName)
    cancelRename()
  }

  function applyFilter(filter: SavedFilter) {
    setLabelMatchers(filter.matchers)
    setSavedFilterBase(filter.name)
    setOpen(false)
  }

  function handleDelete(name: string) {
    confirmThen('delete', name, () => {
      update({ savedFilters: deleteSavedFilter(savedFilters, name) })
      if (savedFilterBase === name) setSavedFilterBase(null)
    })
  }

  function overwriteWithCurrent(name: string) {
    update({ savedFilters: replaceSavedFilterMatchers(savedFilters, name, labelMatchers) })
    setSavedFilterBase(name)
  }

  const trimmedNewName = newFilterName.trim()
  const newNameError = trimmedNewName === '' ? null : validateSavedFilterName(savedFilters, newFilterName)

  function handleSaveAsNew() {
    if (trimmedNewName === '' || newNameError) return
    update({ savedFilters: addSavedFilter(savedFilters, trimmedNewName, labelMatchers) })
    setSavedFilterBase(trimmedNewName)
    setNewFilterName('')
  }

  const atLimit = savedFilters.length >= MAX_SAVED_FILTERS
  const isDirty = status.kind === 'modified' || status.kind === 'unsaved'

  // Only a named state (saved/modified) earns text on the button; idle it's a
  // compact icon-only square like the other toolbar icon buttons.
  const buttonLabel =
    status.kind === 'saved' ? status.filter.name
      : status.kind === 'modified' ? status.base.name
        : null
  const buttonTitle =
    status.kind === 'saved' ? `Saved filter "${status.filter.name}" is applied`
      : status.kind === 'modified' ? `"${status.base.name}" — changed, not saved yet. Open to save the changes or save as a new filter.`
        : status.kind === 'unsaved' ? "Current filter isn't saved yet — open Saved filters to save it."
          : 'Saved filters'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="saved-filters-menu"
        onClick={toggleMenu}
        className={cn(
          'flex h-7 cursor-pointer items-center rounded-md border border-border text-xs font-medium transition-colors',
          buttonLabel === null ? 'w-7 justify-center' : 'gap-1.5 px-2',
          status.kind === 'saved' || status.kind === 'modified'
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/40',
        )}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Saved filters"
        title={buttonTitle}
      >
        <span className="relative shrink-0">
          <Bookmark className={cn(buttonLabel === null ? 'h-3.5 w-3.5' : 'h-3 w-3', (status.kind === 'saved' || status.kind === 'modified') && 'fill-current')} />
          {isDirty && (
            <span
              data-testid="saved-filters-unsaved-dot"
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500 ring-1 ring-background"
            />
          )}
        </span>
        {buttonLabel !== null && (
          <span
            data-testid="saved-filters-menu-label"
            className={cn('hidden max-w-[10rem] truncate sm:inline', status.kind === 'modified' && 'italic')}
          >
            {buttonLabel}
          </span>
        )}
        {isDirty && <span className="sr-only">(unsaved changes)</span>}
        {buttonLabel !== null && (
          <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && (
        <div
          data-testid="saved-filters-popover"
          className="absolute left-0 top-full z-50 mt-1 flex max-h-[min(32rem,calc(100vh-8rem))] w-[32rem] max-w-[calc(100vw-2rem)] flex-col rounded-md border border-border bg-popover p-2 shadow-lg"
        >
          <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2 border-b border-border pb-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
              Saved filters
            </span>
            {savedFilters.length > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {savedFilters.length}/{MAX_SAVED_FILTERS}
              </span>
            )}
          </div>

          {savedFilters.length === 0 ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">
              No saved filters yet. Build a filter with the chips next to this button, then save it here.
            </p>
          ) : (
            <div className="combo-dropdown min-h-0 space-y-0.5 overflow-y-auto">
              {savedFilters.map((filter) => {
                const isActive = status.kind === 'saved' && status.filter.name === filter.name
                const isBase = status.kind === 'modified' && status.base.name === filter.name
                const summary = matchersSummary(filter.matchers)

                if (renamingName === filter.name) {
                  const showError = renameError !== null && (renameTouched || renameError === 'duplicate')
                  return (
                    <div key={filter.name} data-testid="saved-filter-row" className="space-y-1 px-1.5 py-1">
                      <div className="flex items-center gap-1">
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename()
                            if (e.key === 'Escape') {
                              e.preventDefault()
                              cancelRename()
                            }
                          }}
                          maxLength={MAX_SAVED_FILTER_NAME_LENGTH}
                          aria-label={`Rename ${filter.name}`}
                          aria-invalid={showError}
                          className={cn(
                            'h-7 min-w-0 flex-1 rounded border bg-input px-2 text-xs text-foreground outline-none',
                            showError ? 'border-destructive' : 'border-border',
                          )}
                        />
                        <button
                          type="button"
                          onClick={commitRename}
                          disabled={renameError !== null}
                          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label="Confirm rename"
                          title="Save name (Enter)"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelRename}
                          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                          aria-label="Cancel rename"
                          title="Cancel (Esc)"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {showError && <p className="text-[10px] text-destructive">{NAME_ERRORS[renameError]}</p>}
                    </div>
                  )
                }

                const confirmingDelete = pendingConfirm?.action === 'delete' && pendingConfirm.name === filter.name
                const confirmingOverwrite = pendingConfirm?.action === 'overwrite' && pendingConfirm.name === filter.name

                return (
                  <div
                    key={filter.name}
                    data-testid="saved-filter-row"
                    className={cn(
                      'group flex items-center gap-1 rounded px-1 py-0.5',
                      isActive || isBase ? 'bg-accent/60' : 'hover:bg-accent/40',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => applyFilter(filter)}
                      title={isBase ? `Discard changes and re-apply "${filter.name}": ${summary}` : `Apply "${filter.name}": ${summary}`}
                      aria-label={`Apply saved filter ${filter.name}`}
                      aria-current={isActive ? 'true' : undefined}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-0.5 py-0.5 text-left"
                    >
                      <span className="flex w-3 shrink-0 justify-center text-primary" aria-hidden="true">
                        {isActive && <Check className="h-3 w-3" />}
                        {isBase && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={cn('truncate text-xs text-foreground', isActive && 'font-medium')}>
                            {filter.name}
                          </span>
                          {isBase && <span className="shrink-0 text-[10px] italic text-amber-500">modified</span>}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{summary}</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => update({ savedFilters: toggleDefaultSavedFilter(savedFilters, filter.name) })}
                      aria-label={filter.isDefault ? `Unset ${filter.name} as default` : `Set ${filter.name} as default`}
                      aria-pressed={filter.isDefault}
                      title={filter.isDefault
                        ? 'Default filter — applied when you open Jarvis without a filter in the link. Click to unset.'
                        : 'Make default — applied when you open Jarvis without a filter in the link'}
                      className={cn(
                        'flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent/60',
                        filter.isDefault ? 'text-amber-500' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Star className={cn('h-3.5 w-3.5', filter.isDefault && 'fill-current')} />
                    </button>

                    {/* Overwrite a different saved filter with the current chips — only when
                        there's no base to "save changes" to (the footer covers that case),
                        and always behind a second click since it discards that filter's matchers. */}
                    {status.kind === 'unsaved' && (
                      confirmingOverwrite ? (
                        <button
                          type="button"
                          onClick={() => confirmThen('overwrite', filter.name, () => overwriteWithCurrent(filter.name))}
                          aria-label={`Click again to overwrite ${filter.name}`}
                          className="h-6 shrink-0 cursor-pointer whitespace-nowrap rounded px-1 text-[10px] font-medium text-amber-500 hover:bg-accent/60"
                        >
                          Overwrite?
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => confirmThen('overwrite', filter.name, () => overwriteWithCurrent(filter.name))}
                          aria-label={`Update ${filter.name} with current filter`}
                          title={`Replace "${filter.name}" with the current filter`}
                          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() => startRename(filter)}
                      aria-label={`Rename ${filter.name}`}
                      title="Rename"
                      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    {confirmingDelete ? (
                      <button
                        type="button"
                        onClick={() => handleDelete(filter.name)}
                        aria-label={`Click again to delete ${filter.name}`}
                        className="h-6 shrink-0 cursor-pointer whitespace-nowrap rounded px-1 text-[10px] font-medium text-destructive hover:bg-accent/60"
                      >
                        Delete?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDelete(filter.name)}
                        aria-label={`Delete ${filter.name}`}
                        title="Delete"
                        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-2 shrink-0 space-y-2 border-t border-border pt-2">
            {syncFailed && (
              <p
                data-testid="saved-filters-sync-error"
                className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[10.5px] leading-snug text-destructive"
              >
                Couldn't save to your account — changes are only kept in this browser for now.
              </p>
            )}
            {status.kind === 'empty' && (
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                Add filter chips to save them as a filter.
              </p>
            )}

            {status.kind === 'saved' && (
              <p className="text-[10.5px] leading-snug text-muted-foreground">
                Current filter is saved as "{status.filter.name}".
              </p>
            )}

            {status.kind === 'modified' && (
              <div className="space-y-1">
                <p className="text-[10.5px] leading-snug text-muted-foreground">
                  You changed "{status.base.name}" — the changes aren't saved yet.
                </p>
                <button
                  type="button"
                  onClick={() => overwriteWithCurrent(status.base.name)}
                  aria-label={`Save changes to ${status.base.name}`}
                  className="flex h-7 w-full cursor-pointer items-center justify-center gap-1.5 rounded bg-primary px-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span className="truncate">Save changes to "{status.base.name}"</span>
                </button>
              </div>
            )}

            {isDirty && (
              atLimit ? (
                <p className="text-[10.5px] leading-snug text-muted-foreground">
                  Limit of {MAX_SAVED_FILTERS} saved filters reached — delete one to save another.
                </p>
              ) : (
                <form
                  className="space-y-1"
                  onSubmit={(e) => {
                    e.preventDefault()
                    handleSaveAsNew()
                  }}
                >
                  {status.kind === 'modified' && (
                    <p className="text-[10px] text-muted-foreground">…or save as a new filter:</p>
                  )}
                  <div className="flex items-center gap-1">
                    <input
                      value={newFilterName}
                      onChange={(e) => setNewFilterName(e.target.value)}
                      maxLength={MAX_SAVED_FILTER_NAME_LENGTH}
                      placeholder="Name this filter"
                      aria-label="Saved filter name"
                      aria-invalid={newNameError !== null}
                      className={cn(
                        'h-7 min-w-0 flex-1 rounded border bg-input px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground',
                        newNameError ? 'border-destructive' : 'border-border',
                      )}
                    />
                    <button
                      type="submit"
                      disabled={trimmedNewName === '' || newNameError !== null}
                      className={cn(
                        'h-7 shrink-0 cursor-pointer rounded px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40',
                        status.kind === 'unsaved'
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'border border-border text-foreground hover:bg-accent/40',
                      )}
                    >
                      Save
                    </button>
                  </div>
                  {newNameError && <p className="text-[10px] text-destructive">{NAME_ERRORS[newNameError]}</p>}
                </form>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
