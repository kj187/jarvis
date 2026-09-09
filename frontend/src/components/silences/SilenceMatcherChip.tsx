import { labelColorStyle } from '@/lib/alertUtils'
import { matcherOperator } from './silenceDisplay'
import type { SilenceMatcher } from '@/types'
import { cn } from '@/lib/utils'

interface SilenceMatcherChipProps {
  matcher: SilenceMatcher
  theme: 'light' | 'dark'
  className?: string
}

/**
 * Quiet matcher chip: only the label name carries the per-label tint
 * (`labelColorStyle`), the operator and value stay in neutral ink. Deliberately
 * calmer than the fully colour-filled `TruncatableChip` the alert views use —
 * a silence card shows several matchers at once and the wall of colour was the
 * main source of visual noise.
 */
export function SilenceMatcherChip({ matcher, theme, className }: SilenceMatcherChipProps) {
  const { color } = labelColorStyle(matcher.name, theme)
  const op = matcherOperator(matcher.isRegex, matcher.isEqual)
  const full = `${matcher.name}${op}${matcher.value}`

  return (
    <span
      className={cn('silence-matcher inline-flex max-w-full items-baseline font-mono text-[11px] leading-tight', className)}
      title={full}
    >
      <span className="shrink-0 font-medium" style={{ color }}>{matcher.name}</span>
      <span className="shrink-0 text-muted-foreground/60">{op}</span>
      <span className="truncate text-muted-foreground">{matcher.value}</span>
    </span>
  )
}
