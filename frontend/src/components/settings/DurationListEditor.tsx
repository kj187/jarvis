import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { InfoHint } from '@/components/ui/info-hint'
import { cn } from '@/lib/utils'
import {
  MAX_SILENCE_DURATION_CHOICES,
  formatDurationChoice,
  parseSilenceDuration,
} from '@/lib/silenceDurations'

interface DurationListEditorProps {
  label: string
  /** Tooltip text next to the label. */
  info: string
  /** Current durations in minutes, ascending. */
  value: number[]
  /** What "Reset" restores: the instance default, or the built-in one. */
  baseline: number[]
  onChange: (next: number[]) => void
}

/**
 * Tag input for a list of durations (`30m`, `4h`, `1d`, `1w`, `30d`, `1y`):
 * the chips and the entry field share one bordered box. Remove a chip with its
 * ×; type a duration and press Enter (or comma) to add it. The list stays
 * sorted and duplicate-free and never becomes empty (a menu without buttons is
 * useless); "Reset" appears once it differs from the default (instance or
 * built-in).
 */
export function DurationListEditor({ label, info, value, baseline, onChange }: DurationListEditorProps) {
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isModified = JSON.stringify(value) !== JSON.stringify(baseline)
  const isFull = value.length >= MAX_SILENCE_DURATION_CHOICES
  const isLast = value.length <= 1

  const add = () => {
    const text = draft.trim()
    if (text === '') return
    const minutes = parseSilenceDuration(text)
    if (minutes === null) {
      setError('Use a number plus m, h, d, w or y — e.g. 30m, 4h, 1d, 1w, 30d, 1y (max 365d).')
      return
    }
    if (value.includes(minutes)) {
      setError(`${formatDurationChoice(minutes)} is already in the list.`)
      return
    }
    onChange([...value, minutes].sort((a, b) => a - b))
    setDraft('')
    setError(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    }
  }

  return (
    <div className="space-y-1.5" data-testid="duration-list-editor">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-sm">
          {label}
          <InfoHint label={`More information about ${label}`}>{info}</InfoHint>
        </span>
        {isModified && (
          <button
            type="button"
            onClick={() => {
              onChange(baseline)
              setError(null)
            }}
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-compact px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Restore the default durations"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </button>
        )}
      </div>

      {/* One field: clicking anywhere in it focuses the entry input. */}
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex cursor-text flex-wrap items-center gap-1 rounded-control border border-control bg-input p-1 transition-colors focus-within:ring-2 focus-within:ring-ring',
          error && 'border-destructive',
        )}
      >
        <ul className="contents" aria-label={`${label} durations`}>
          {value.map((minutes) => {
            const text = formatDurationChoice(minutes)
            return (
              <li
                key={minutes}
                className="inline-flex h-6 items-center gap-0.5 rounded-compact bg-accent pl-2 pr-0.5 text-xs tabular-nums text-foreground"
              >
                {text}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(value.filter((m) => m !== minutes))
                  }}
                  disabled={isLast}
                  aria-label={`Remove ${text}`}
                  title={isLast ? 'At least one duration is required' : `Remove ${text}`}
                  className={cn(
                    'inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-compact text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isLast && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </li>
            )
          })}
        </ul>
        <input
          ref={inputRef}
          aria-label={`Add duration to ${label}`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={onKeyDown}
          placeholder={isFull ? 'Maximum reached' : 'Add, e.g. 30d'}
          disabled={isFull}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          className="h-6 min-w-20 flex-1 bg-transparent px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        />
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-[10px] text-destructive">
          {error}
        </p>
      ) : (
        draft.trim() !== '' && <p className="text-[10px] text-muted-foreground">Press Enter to add</p>
      )}
    </div>
  )
}
