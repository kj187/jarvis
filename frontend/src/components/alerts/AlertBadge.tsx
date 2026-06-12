import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/store/useSettingsStore'

interface AlertBadgeProps {
  severity: string
  className?: string
}

const severityConfig: Record<string, { label: string; dark: string; light: string }> = {
  critical: { label: 'Critical', dark: 'bg-red-600/20 text-red-400 border-red-700',     light: 'bg-red-100 text-red-700 border-red-300' },
  warning:  { label: 'Warning',  dark: 'bg-yellow-500/20 text-yellow-300 border-yellow-600', light: 'bg-yellow-100 text-yellow-700 border-yellow-400' },
  info:     { label: 'Info',     dark: 'bg-blue-600/20 text-blue-400 border-blue-700',   light: 'bg-blue-100 text-blue-700 border-blue-300' },
  none:     { label: 'None',     dark: 'bg-slate-600/20 text-slate-400 border-slate-700', light: 'bg-slate-100 text-slate-600 border-slate-300' },
}

export function AlertBadge({ severity, className }: AlertBadgeProps) {
  const theme = useSettingsStore((s) => s.theme)
  const cfg = severityConfig[severity] ?? {
    label: severity || 'Unknown',
    dark: 'bg-slate-600/20 text-slate-400 border-slate-700',
    light: 'bg-slate-100 text-slate-600 border-slate-300',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        theme === 'light' ? cfg.light : cfg.dark,
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

const stateConfig: Record<string, { label: string; dark: string; light: string }> = {
  active:      { label: 'Active',      dark: 'bg-red-600/20 text-red-400 border-red-700',       light: 'bg-red-100 text-red-700 border-red-300' },
  unprocessed: { label: 'Unprocessed', dark: 'bg-orange-600/20 text-orange-400 border-orange-700', light: 'bg-orange-100 text-orange-700 border-orange-300' },
  suppressed:  { label: 'Suppressed',  dark: 'bg-slate-600/20 text-slate-400 border-slate-700', light: 'bg-slate-100 text-slate-600 border-slate-300' },
  resolved:    { label: 'Resolved',    dark: 'bg-green-600/20 text-green-400 border-green-700', light: 'bg-green-100 text-green-700 border-green-300' },
}

export function StatusBadge({ state, className }: StatusBadgeProps) {
  const theme = useSettingsStore((s) => s.theme)
  const cfg = stateConfig[state] ?? {
    label: state,
    dark: 'bg-slate-600/20 text-slate-400 border-slate-700',
    light: 'bg-slate-100 text-slate-600 border-slate-300',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
        theme === 'light' ? cfg.light : cfg.dark,
        className,
      )}
    >
      {cfg.label}
    </span>
  )
}
