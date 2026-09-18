import { cn } from '@/lib/utils'

// Status roles come from the design tokens (`critical`, `warning`, …): each role carries its own
// text/fill/edge for both themes, so no component branches on the theme for colour.
const BADGE = 'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold'

const ROLE = {
  critical: 'bg-critical-soft text-critical-fg border-critical-edge',
  warning: 'bg-warning-soft text-warning-fg border-warning-edge',
  info: 'bg-info-soft text-info-fg border-info-edge',
  neutral: 'bg-neutral-soft text-neutral-fg border-neutral-edge',
  success: 'bg-success-soft text-success-fg border-success-edge',
  attention: 'bg-attention-soft text-attention-fg border-attention-edge',
} as const

interface AlertBadgeProps {
  severity: string
  className?: string
}

const severityConfig: Record<string, { label: string; role: keyof typeof ROLE }> = {
  critical: { label: 'Critical', role: 'critical' },
  warning: { label: 'Warning', role: 'warning' },
  info: { label: 'Info', role: 'info' },
  none: { label: 'None', role: 'neutral' },
}

export function AlertBadge({ severity, className }: AlertBadgeProps) {
  const cfg = severityConfig[severity] ?? { label: severity || 'Unknown', role: 'neutral' as const }
  return <span className={cn(BADGE, ROLE[cfg.role], className)}>{cfg.label}</span>
}

interface StatusBadgeProps {
  state: string
  className?: string
}

const stateConfig: Record<string, { label: string; role: keyof typeof ROLE }> = {
  active: { label: 'Active', role: 'critical' },
  unprocessed: { label: 'Unprocessed', role: 'attention' },
  suppressed: { label: 'Suppressed', role: 'neutral' },
  resolved: { label: 'Resolved', role: 'success' },
}

export function StatusBadge({ state, className }: StatusBadgeProps) {
  const cfg = stateConfig[state] ?? { label: state, role: 'neutral' as const }
  return <span className={cn(BADGE, ROLE[cfg.role], className)}>{cfg.label}</span>
}
