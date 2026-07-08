// WebSocket push (alerts_update / silences_update) is the primary update
// channel; useWebSocket additionally invalidates all queries on every
// (re)connect, so missed events during a disconnect are recovered
// immediately. This interval is only a last-resort safety net in case a
// broadcast is lost on a live connection (e.g. slow-client drop in the WS
// hub) — it hits the backend's in-memory snapshots only, never Alertmanager.
export const FALLBACK_REFETCH_INTERVAL_MS = 60_000
