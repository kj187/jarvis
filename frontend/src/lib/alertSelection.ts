import type { EnrichedAlert } from '@/types'

const ALERT_SELECTION_SEPARATOR = '::'

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function makeAlertSelectionKey(fingerprint: string, clusterName: string): string {
  return `${encodeURIComponent(clusterName)}${ALERT_SELECTION_SEPARATOR}${encodeURIComponent(fingerprint)}`
}

export function makeAlertSelectionKeyForAlert(alert: EnrichedAlert): string {
  return makeAlertSelectionKey(alert.fingerprint, alert.clusterName)
}

export function parseAlertSelectionKey(selectionKey: string): { fingerprint: string; clusterName?: string } {
  const parse = (value: string): { fingerprint: string; clusterName?: string } => {
    const sepIndex = value.indexOf(ALERT_SELECTION_SEPARATOR)
    if (sepIndex === -1) return { fingerprint: value }
    return {
      clusterName: decodeURIComponentSafe(value.slice(0, sepIndex)),
      fingerprint: decodeURIComponentSafe(value.slice(sepIndex + ALERT_SELECTION_SEPARATOR.length)),
    }
  }

  const parsed = parse(selectionKey)
  if (parsed.clusterName == null && selectionKey.toLowerCase().includes('%3a%3a')) {
    // Be tolerant with URL values that may have been encoded twice.
    return parse(decodeURIComponentSafe(selectionKey))
  }
  if (parsed.clusterName == null) {
    // Backward compatibility for legacy URLs that stored fingerprint only.
    return { fingerprint: selectionKey }
  }
  return parsed
}

export function matchesAlertSelectionKey(alert: EnrichedAlert, selectionKey: string | null | undefined): boolean {
  if (!selectionKey) return false
  const parsed = parseAlertSelectionKey(selectionKey)
  if (parsed.clusterName == null) return alert.fingerprint === parsed.fingerprint
  return alert.fingerprint === parsed.fingerprint && alert.clusterName === parsed.clusterName
}
