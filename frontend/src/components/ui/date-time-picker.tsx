import { useState } from 'react'
import { DayPicker } from 'react-day-picker'
import { de } from 'date-fns/locale'
import { format, parse, isValid } from 'date-fns'
import { CalendarDays, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DateTimePickerProps {
  value: string // "yyyy-MM-dd'T'HH:mm"
  onChange: (v: string) => void
  className?: string
}

const FMT = "yyyy-MM-dd'T'HH:mm"

function parseValue(value: string): Date | undefined {
  if (!value) return undefined
  const d = parse(value, FMT, new Date())
  return isValid(d) ? d : undefined
}

export function DateTimePicker({ value, onChange, className }: DateTimePickerProps) {
  const [open, setOpen] = useState(false)

  const selected = parseValue(value)
  const displayValue = selected ? format(selected, 'dd.MM.yyyy HH:mm') : ''

  const hh = selected ? String(selected.getHours()).padStart(2, '0') : '00'
  const mm = selected ? String(selected.getMinutes()).padStart(2, '0') : '00'

  function handleDaySelect(day: Date | undefined) {
    if (!day) return
    const base = selected ?? new Date()
    day.setHours(base.getHours(), base.getMinutes(), 0, 0)
    onChange(format(day, FMT))
  }

  function handleTime(hoursStr: string, minutesStr: string) {
    const base = selected ?? new Date()
    const h = Math.min(23, Math.max(0, parseInt(hoursStr, 10) || 0))
    const m = Math.min(59, Math.max(0, parseInt(minutesStr, 10) || 0))
    const updated = new Date(base)
    updated.setHours(h, m, 0, 0)
    onChange(format(updated, FMT))
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full items-center gap-2 rounded border border-input bg-background px-2 text-xs hover:border-ring focus:outline-none focus:ring-1 focus:ring-ring cursor-pointer"
      >
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={cn('flex-1 text-left font-mono', !displayValue && 'text-muted-foreground')}>
          {displayValue || 'Datum wählen…'}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 rounded border border-border bg-popover shadow-xl">
            <DayPicker
              mode="single"
              selected={selected}
              defaultMonth={selected ?? new Date()}
              onSelect={handleDaySelect}
              locale={de}
              components={{
                Chevron: ({ orientation }) =>
                  orientation === 'left'
                    ? <ChevronLeft className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />,
              }}
              classNames={{
                root: 'p-3',
                months: 'flex flex-col',
                month: 'space-y-3',
                month_caption: 'flex items-center justify-center relative h-7',
                caption_label: 'text-sm font-medium text-foreground',
                nav: 'flex items-center justify-between absolute inset-x-0 top-0',
                button_previous:
                  'inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground cursor-pointer transition-colors',
                button_next:
                  'inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/80 hover:bg-accent hover:text-foreground cursor-pointer transition-colors',
                month_grid: 'w-full border-collapse',
                weekdays: 'flex',
                weekday: 'w-8 text-center text-[10px] font-medium text-muted-foreground',
                week: 'flex mt-1',
                day: 'relative flex h-8 w-8 items-center justify-center',
                day_button:
                  'h-8 w-8 rounded text-sm hover:bg-accent hover:text-foreground focus:outline-none cursor-pointer transition-colors',
                today:
                  '[&>button]:bg-accent [&>button]:text-foreground [&>button]:font-semibold',
                selected:
                  '[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:hover:!bg-primary',
                outside: '[&>button]:text-muted-foreground/40',
                disabled: '[&>button]:opacity-30 [&>button]:cursor-not-allowed',
              }}
            />

            {/* Time row */}
            <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
              <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <input
                type="number"
                min={0}
                max={23}
                value={hh}
                onChange={(e) => handleTime(e.target.value, mm)}
                className="w-10 rounded border border-input bg-background px-1 py-0.5 text-center font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-muted-foreground">:</span>
              <input
                type="number"
                min={0}
                max={59}
                value={mm}
                onChange={(e) => handleTime(hh, e.target.value)}
                className="w-10 rounded border border-input bg-background px-1 py-0.5 text-center font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="ml-auto text-xs text-muted-foreground font-mono">
                {hh}:{mm}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
