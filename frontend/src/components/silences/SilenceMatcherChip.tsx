import { labelColorStyle } from '@/lib/alertUtils'
import { matcherOperator } from './silenceDisplay'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { SilenceMatcher } from '@/types'
import { cn } from '@/lib/utils'

interface SilenceMatcherChipProps {
  matcher: SilenceMatcher
  className?: string
}

/**
 * Quiet matcher chip: only the label name carries a per-label tint, and only
 * when this key has a palette color set (`labelColorStyle` — labels have no
 * automatic color); the operator and value always stay in neutral ink. Deliberately calmer than the fully colour-filled `TruncatableChip`
 * the alert views use — a silence card shows several matchers at once and
 * the wall of colour was the main source of visual noise.
 */
export function SilenceMatcherChip({ matcher, className }: SilenceMatcherChipProps) {
  const labelColors = useSettingsStore((s) => s.labelColors)
  const theme = useSettingsStore((s) => s.theme)
  const color = labelColorStyle(matcher.name, labelColors, theme)?.color
  const op = matcherOperator(matcher.isRegex, matcher.isEqual)
  const full = `${matcher.name}${op}${matcher.value}`

  return (
    <span
      className={cn('silence-matcher inline-flex max-w-full items-baseline font-mono text-[11px] leading-tight', className)}
      title={full}
    >
      <span className={cn('shrink-0 font-medium', !color && 'text-foreground')} style={{ color }}>{matcher.name}</span>
      <span className="shrink-0 text-muted-foreground">{op}</span>
      <span className="truncate text-muted-foreground">{matcher.value}</span>
    </span>
  )
}
