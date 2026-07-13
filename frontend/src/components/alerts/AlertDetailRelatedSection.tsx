import { useState } from 'react'
import { TruncatableChip } from '@/components/ui/truncatable-chip'
import { AlertBadge } from './AlertBadge'
import { labelColorStyle, type RelatedAlert } from '@/lib/alertUtils'
import { makeAlertSelectionKeyForAlert } from '@/lib/alertSelection'
import { useFormatTime } from '@/hooks/useFormatTime'
import { useSettingsStore } from '@/store/useSettingsStore'
import type { EnrichedAlert } from '@/types'

const PAGE_SIZE = 10
const MAX_CHIPS = 3

interface AlertDetailRelatedSectionProps {
  alert: EnrichedAlert
  related: RelatedAlert[]
  onSelectAlert?: (selectionKey: string) => void
}

function RelatedAlertRow({
  related,
  showCluster,
  onSelect,
}: {
  related: RelatedAlert
  showCluster: boolean
  onSelect?: () => void
}) {
  const theme = useSettingsStore((s) => s.theme)
  const fmtTime = useFormatTime()
  const { alert, sharedKeys } = related
  const visibleKeys = sharedKeys.slice(0, MAX_CHIPS)
  const hiddenKeys = sharedKeys.length - visibleKeys.length

  return (
    <div
      data-testid="detail-related-row"
      className={
        onSelect
          ? 'space-y-1 rounded border border-border/60 px-2.5 py-2 cursor-pointer hover:bg-accent'
          : 'space-y-1 rounded border border-border/60 px-2.5 py-2'
      }
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <AlertBadge severity={alert.labels.severity ?? 'none'} className="shrink-0 px-1.5 py-0 text-[10px]" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {alert.labels.alertname ?? alert.fingerprint}
        </span>
        {showCluster && (
          <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {alert.clusterName}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(alert.startsAt)}</span>
      </div>
      <div className="flex items-center gap-1 overflow-hidden pl-0.5">
        {visibleKeys.map((key) => (
          <TruncatableChip
            key={key}
            className="max-w-[180px] rounded border px-1.5 py-0.5 text-[10px] font-medium"
            style={labelColorStyle(key, theme)}
          >
            {key}={alert.labels[key]}
          </TruncatableChip>
        ))}
        {hiddenKeys > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground" title={sharedKeys.slice(MAX_CHIPS).join(', ')}>
            +{hiddenKeys}
          </span>
        )}
      </div>
    </div>
  )
}

export function AlertDetailRelatedSection({ alert, related, onSelectAlert }: AlertDetailRelatedSectionProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  if (related.length === 0) {
    return (
      <div className="px-5 py-4" data-testid="detail-related-empty">
        <p className="text-xs text-muted-foreground">No related alerts.</p>
      </div>
    )
  }

  const visible = related.slice(0, visibleCount)
  const remainder = related.length - visible.length

  return (
    <div className="px-5 py-4" data-testid="detail-related-section">
      <p className="mb-3 text-xs text-muted-foreground">
        Currently firing or suppressed alerts that share labels with this alert — rarest shared labels first.
      </p>
      <div className="space-y-1.5">
        {visible.map((r) => (
          <RelatedAlertRow
            key={`${r.alert.clusterName}:${r.alert.fingerprint}`}
            related={r}
            showCluster={r.alert.clusterName !== alert.clusterName}
            onSelect={onSelectAlert ? () => onSelectAlert(makeAlertSelectionKeyForAlert(r.alert)) : undefined}
          />
        ))}
      </div>
      {remainder > 0 && (
        <button
          data-testid="detail-related-show-more"
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="mt-2 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
        >
          Show {Math.min(PAGE_SIZE, remainder)} more ({remainder} remaining)
        </button>
      )}
    </div>
  )
}
