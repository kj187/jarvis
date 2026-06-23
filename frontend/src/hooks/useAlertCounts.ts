import { useEffect, useMemo } from 'react'
import { useAlerts } from '@/hooks/useAlerts'
import { useSilences } from '@/hooks/useSilences'
import { useUIStore } from '@/store/uiStore'
import { getEffectiveAlertState, matchesLabelMatchers, filterSilences } from '@/lib/alertUtils'

export function useAlertCounts() {
  const filters = useUIStore((s) => s.filters)
  const setAlertCounts = useUIStore((s) => s.setAlertCounts)

  const { data: liveAlerts = [] } = useAlerts()
  const { data: resolvedAlerts = [] } = useAlerts({ state: 'resolved' })
  const { data: silences = [] } = useSilences()

  const byState = useMemo(() => {
    const counts = { active: 0, suppressed: 0, resolved: 0 }
    liveAlerts.forEach((alert) => {
      if (filters.search) {
        const needle = filters.search.toLowerCase()
        const haystack = (alert.labels['alertname'] ?? '') + JSON.stringify(alert.labels)
        if (!haystack.toLowerCase().includes(needle)) return
      }
      if (!matchesLabelMatchers(alert, filters.labelMatchers)) return
      const s = getEffectiveAlertState(alert, silences)
      if (s in counts) counts[s as keyof typeof counts]++
    })
    counts.resolved = resolvedAlerts.length
    return counts
  }, [liveAlerts, resolvedAlerts.length, silences, filters.search, filters.labelMatchers])

  const silenceCount = useMemo(
    () => filterSilences(
      silences.filter((s) => s.status.state !== 'expired'),
      filters.search,
      filters.labelMatchers,
    ).length,
    [silences, filters.search, filters.labelMatchers]
  )

  useEffect(() => {
    setAlertCounts({ filtered: 0, total: liveAlerts.length, byState, silenceCount })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAlerts.length, byState.active, byState.suppressed, byState.resolved, silenceCount, setAlertCounts])
}
