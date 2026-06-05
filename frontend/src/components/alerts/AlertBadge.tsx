import { cn } from '@/lib/utils'

interface AlertBadgeProps {
  severity: string
  className?: string
}

const severityConfig: Record<string, { label: string; className: string }> = {
  critical: { label: 'Critical', className: 'bg-red-600/20 text-red-400 border-red-700' },
  warning: { label: 'Warning', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-600' },
  info: { label: 'Info', className: 'bg-blue-600/20 text-blue-400 border-blue-700' },
  none: { label: 'None', className: 'bg-slate-600/20 text-slate-400 border-slate-700' },
}

export function AlertBadge({ severity, className }: AlertBadgeProps) {
  const cfg = severityConfig[severity] ?? {
    label: severity || 'Unknown',
    className: 'bg-slate-600/20 text-slate-400 border-slate-700',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        cfg.className,
        className,
      )}
    >
      {cfg.label}
    </span>
  )
}

interface StatusBadgeProps {
  state: string
  className?: string
}

const stateConfig: Record<string, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-red-600/20 text-red-400 border-red-700' },
  unprocessed: { label: 'Unprocessed', className: 'bg-orange-600/20 text-orange-400 border-orange-700' },
  suppressed: { label: 'Suppressed', className: 'bg-slate-600/20 text-slate-400 border-slate-700' },
  resolved: { label: 'Resolved', className: 'bg-green-600/20 text-green-400 border-green-700' },
}

export function StatusBadge({ state, className }: StatusBadgeProps) {
  const cfg = stateConfig[state] ?? {
    label: state,
    className: 'bg-slate-600/20 text-slate-400 border-slate-700',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        cfg.className,
        className,
      )}
    >
      {cfg.label}
    </span>
  )
}
