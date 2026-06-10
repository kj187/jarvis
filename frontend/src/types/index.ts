// ── Alert ────────────────────────────────────────────────────────────────────

export interface AlertStatus {
  inhibitedBy: string[]
  silencedBy: string[]
  state: 'active' | 'suppressed' | 'unprocessed' | 'resolved'
}

export interface Receiver {
  name: string
}

export interface EnrichedAlert {
  fingerprint: string
  status: AlertStatus
  labels: Record<string, string>
  annotations: Record<string, string>
  startsAt: string
  endsAt: string
  updatedAt: string
  generatorURL: string
  receivers: Receiver[]
  clusterName: string
  alertmanagerUrl: string
  activeClaim?: Claim
}

// ── Silence ──────────────────────────────────────────────────────────────────

export interface SilenceMatcher {
  isEqual: boolean
  isRegex: boolean
  name: string
  value: string
}

export interface SilenceStatus {
  state: 'active' | 'pending' | 'expired'
}

export interface Silence {
  id: string
  matchers: SilenceMatcher[]
  startsAt: string
  endsAt: string
  createdBy: string
  comment: string
  status: SilenceStatus
  updatedAt: string
  clusterName: string
  alertmanagerUrl: string
}

// ── History ──────────────────────────────────────────────────────────────────

export type AlertEventStatus = 'firing' | 'suppressed' | 'expired' | 'resolved'

export interface AlertEvent {
  id: number
  fingerprint: string
  clusterName: string
  alertmanagerUrl: string
  status: AlertEventStatus
  startsAt: string
  endsAt: string | null
  annotations: string
  recordedAt: string
}

export interface AlertStats {
  fingerprint: string
  alertname: string
  clusterName: string
  firstSeenAt: string
  lastSeenAt: string
  lastResolvedAt?: string
  occurrenceCount: number
}

// ── Comment ──────────────────────────────────────────────────────────────────

export interface Comment {
  id: number
  fingerprint: string
  eventId?: number
  authorName: string
  body: string
  createdAt: string
}

// ── Claim ────────────────────────────────────────────────────────────────────

export type ClaimReleaseReason = 'manual' | 'resolved' | 'reclaimed'

export interface Claim {
  id: number
  fingerprint: string
  eventId?: number
  claimedBy: string
  claimedAt: string
  note?: string
  releasedAt?: string
  releasedBy?: string
  releaseReason?: ClaimReleaseReason
}

// ── Cluster ──────────────────────────────────────────────────────────────────

export interface ClusterInfo {
  name: string
  alertmanagerUrl: string
  prometheusUrl: string
  healthy: boolean
  alertCount: number
}

// ── AlertGroup ───────────────────────────────────────────────────────────────

export interface AlertGroup {
  alertname: string
  severity: string
  alerts: EnrichedAlert[]
  count: number
}

// ── Filter / UI ───────────────────────────────────────────────────────────────

export type LabelMatcherOperator = '=' | '!=' | '=~' | '!~'

export interface LabelMatcher {
  id: string
  name: string
  operator: LabelMatcherOperator
  value: string
  /** Locked matchers come from Settings default filters — cannot be removed from the header. */
  locked?: boolean
}

// ── Silence Events ────────────────────────────────────────────────────────────

export interface SilenceEvent {
  id: number
  fingerprint: string
  silenceId: string
  clusterName: string
  action: 'created' | 'updated' | 'deleted'
  performedBy: string
  comment: string
  recordedAt: string
}

// ── WebSocket Events ──────────────────────────────────────────────────────────

export interface WSEvent<T = unknown> {
  type: string
  payload: T
}

export interface AlertsUpdatePayload {
  alerts: EnrichedAlert[]
}

export interface ClaimSetPayload {
  fingerprint: string
  claim: Claim
}

export interface ClaimReleasedPayload {
  fingerprint: string
  releasedBy: string
}

export interface CommentAddedPayload {
  fingerprint: string
  comment: Comment
}
