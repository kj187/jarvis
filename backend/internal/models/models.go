package models

import (
	"encoding/json"
	"time"
)

// ── Alert ────────────────────────────────────────────────────────────────────

type AlertStatus struct {
	InhibitedBy []string `json:"inhibitedBy"`
	SilencedBy  []string `json:"silencedBy"`
	State       string   `json:"state"` // active | suppressed | unprocessed | resolved
}

type Receiver struct {
	Name string `json:"name"`
}

type EnrichedAlert struct {
	Fingerprint     string            `json:"fingerprint"`
	Status          AlertStatus       `json:"status"`
	Labels          map[string]string `json:"labels"`
	Annotations     map[string]string `json:"annotations"`
	StartsAt        time.Time         `json:"startsAt"`
	EndsAt          time.Time         `json:"endsAt"`
	UpdatedAt       time.Time         `json:"updatedAt"`
	GeneratorURL    string            `json:"generatorURL"`
	Receivers       []Receiver        `json:"receivers"`
	ClusterName     string            `json:"clusterName"`
	AlertmanagerURL string            `json:"alertmanagerUrl"` // Browser link URL
	ActiveClaim     *Claim            `json:"activeClaim,omitempty"`
}

// ── Silence ──────────────────────────────────────────────────────────────────

type SilenceMatcher struct {
	IsEqual bool   `json:"isEqual"`
	IsRegex bool   `json:"isRegex"`
	Name    string `json:"name"`
	Value   string `json:"value"`
}

type SilenceStatus struct {
	State string `json:"state"` // active | pending | expired
}

type Silence struct {
	ID              string           `json:"id"`
	Matchers        []SilenceMatcher `json:"matchers"`
	StartsAt        time.Time        `json:"startsAt"`
	EndsAt          time.Time        `json:"endsAt"`
	CreatedBy       string           `json:"createdBy"`
	Comment         string           `json:"comment"`
	Status          SilenceStatus    `json:"status"`
	UpdatedAt       time.Time        `json:"updatedAt"`
	ClusterName     string           `json:"clusterName"`
	AlertmanagerURL string           `json:"alertmanagerUrl"`
}

// ── History ──────────────────────────────────────────────────────────────────

// AlertEventStatus — typed constants for event status values.
const (
	EventStatusFiring     = "firing"
	EventStatusSuppressed = "suppressed"
	EventStatusExpired    = "expired"
	EventStatusResolved   = "resolved"
)

// AlertEvent represents a status change of an alert.
// Status: firing | suppressed | expired | resolved
//   - firing     = alert appeared / became active again after silence
//   - suppressed = alert silenced or inhibited
//   - expired    = silence expired or deleted, alert active again
//   - resolved   = alert disappeared (no longer in AM API)
type AlertEvent struct {
	ID              int64      `json:"id"`
	Fingerprint     string     `json:"fingerprint"`
	ClusterName     string     `json:"clusterName"`
	AlertmanagerURL string     `json:"alertmanagerUrl"`
	Status          string     `json:"status"`
	StartsAt        time.Time  `json:"startsAt"`
	EndsAt          *time.Time `json:"endsAt"` // nil while still firing
	Annotations     string     `json:"annotations"` // JSON string with metadata
	RecordedAt      time.Time  `json:"recordedAt"`
}

type AlertStats struct {
	Fingerprint     string    `json:"fingerprint"`
	Alertname       string    `json:"alertname"`
	ClusterName     string    `json:"clusterName"`
	FirstSeenAt     time.Time `json:"firstSeenAt"`
	LastSeenAt      time.Time `json:"lastSeenAt"`
	OccurrenceCount int       `json:"occurrenceCount"`
}

// ── Comment ──────────────────────────────────────────────────────────────────

type Comment struct {
	ID          int64     `json:"id"`
	Fingerprint string    `json:"fingerprint"`
	EventID     *int64    `json:"eventId,omitempty"` // optional reference to firing episode
	AuthorName  string    `json:"authorName"`
	Body        string    `json:"body"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ── Claim ────────────────────────────────────────────────────────────────────

// ClaimReleaseReason — typed constants for release reasons.
const (
	ReleaseReasonManual    = "manual"
	ReleaseReasonResolved  = "resolved"
	ReleaseReasonReclaimed = "reclaimed"
)

type Claim struct {
	ID            int64      `json:"id"`
	Fingerprint   string     `json:"fingerprint"`
	EventID       *int64     `json:"eventId,omitempty"`
	ClaimedBy     string     `json:"claimedBy"`
	ClaimedAt     time.Time  `json:"claimedAt"`
	Note          string     `json:"note,omitempty"`
	ReleasedAt    *time.Time `json:"releasedAt,omitempty"`
	ReleasedBy    string     `json:"releasedBy,omitempty"`
	ReleaseReason string     `json:"releaseReason,omitempty"` // manual | resolved | reclaimed
}

// ── WebSocket Events ─────────────────────────────────────────────────────────

type WSEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

const (
	WSTypeAlertsUpdate  = "alerts_update"  // payload: { alerts: EnrichedAlert[] }
	WSTypeClaimSet      = "claim_set"       // payload: { fingerprint, claim }
	WSTypeClaimReleased = "claim_released"  // payload: { fingerprint, releasedBy }
	WSTypeCommentAdded  = "comment_added"   // payload: { fingerprint, comment }
)

// ── Cluster ──────────────────────────────────────────────────────────────────

type ClusterInfo struct {
	Name            string `json:"name"`
	AlertmanagerURL string `json:"alertmanagerUrl"`
	PrometheusURL   string `json:"prometheusUrl"`
	Healthy         bool   `json:"healthy"`
	AlertCount      int    `json:"alertCount"`
}

// ── AlertGroup ───────────────────────────────────────────────────────────────

// AlertGroup groups alerts by severity + alertname (for /alerts/groups).
type AlertGroup struct {
	Alertname string          `json:"alertname"`
	Severity  string          `json:"severity"`
	Alerts    []EnrichedAlert `json:"alerts"`
	Count     int             `json:"count"`
}
