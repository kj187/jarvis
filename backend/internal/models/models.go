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
	// SeenOn lists the HA member names (host:port) that reported this
	// fingerprint in the last poll. Omitted for single-member clusters so
	// existing payloads stay byte-identical.
	SeenOn []string `json:"seenOn,omitempty"`
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
	EndsAt          *time.Time `json:"endsAt"`      // nil while still firing
	Annotations     string     `json:"annotations"` // JSON string with metadata
	RecordedAt      time.Time  `json:"recordedAt"`
}

type AlertTimelineEntry struct {
	Source     string    `json:"source"` // alert | claim | silence
	SourceID   int64     `json:"sourceId"`
	RecordedAt time.Time `json:"recordedAt"`
	Who        string    `json:"who"`
	Action     string    `json:"action"`
	Comment    string    `json:"comment,omitempty"`
	SilenceID  string    `json:"silenceId,omitempty"`
}

type AlertStats struct {
	Fingerprint     string     `json:"fingerprint"`
	Alertname       string     `json:"alertname"`
	ClusterName     string     `json:"clusterName"`
	FirstSeenAt     time.Time  `json:"firstSeenAt"`
	LastSeenAt      time.Time  `json:"lastSeenAt"`
	LastFiredAt     *time.Time `json:"lastFiredAt,omitempty"`
	LastResolvedAt  *time.Time `json:"lastResolvedAt,omitempty"`
	OccurrenceCount int        `json:"occurrenceCount"`
}

// ── Comment ──────────────────────────────────────────────────────────────────

type Comment struct {
	ID          int64     `json:"id"`
	Fingerprint string    `json:"fingerprint"`
	ClusterName string    `json:"clusterName,omitempty"`
	EventID     *int64    `json:"eventId,omitempty"` // optional reference to firing episode
	UserID      *string   `json:"userId,omitempty"`  // set when auth is enabled; nil for auth-mode "none"
	AuthorName  string    `json:"authorName"`
	Body        string    `json:"body"`
	CreatedAt   time.Time `json:"createdAt"`
}

// ── Claim ────────────────────────────────────────────────────────────────────

// ClaimReleaseReason — typed constants for release reasons.
const (
	ReleaseReasonManual      = "manual"
	ReleaseReasonResolved    = "resolved"
	ReleaseReasonReclaimed   = "reclaimed"
	ReleaseReasonNoteUpdated = "note_updated"
)

type Claim struct {
	ID            int64      `json:"id"`
	Fingerprint   string     `json:"fingerprint"`
	ClusterName   string     `json:"clusterName"`
	EventID       *int64     `json:"eventId,omitempty"`
	ClaimedBy     string     `json:"claimedBy"`
	ClaimedAt     time.Time  `json:"claimedAt"`
	Note          string     `json:"note,omitempty"`
	ReleasedAt    *time.Time `json:"releasedAt,omitempty"`
	ReleasedBy    string     `json:"releasedBy,omitempty"`
	ReleaseReason string     `json:"releaseReason,omitempty"` // manual | resolved | reclaimed
}

// ── Silence Events ────────────────────────────────────────────────────────────

// SilenceEvent records a user-triggered action on a silence.
// Action: "created" | "updated" | "deleted"
type SilenceEvent struct {
	ID          int64     `json:"id"`
	Fingerprint string    `json:"fingerprint"`
	SilenceID   string    `json:"silenceId"`
	ClusterName string    `json:"clusterName"`
	Action      string    `json:"action"`
	PerformedBy string    `json:"performedBy"`
	Comment     string    `json:"comment"`
	RecordedAt  time.Time `json:"recordedAt"`
}

// ── Silence Templates ────────────────────────────────────────────────────────

type SilenceTemplate struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	Matchers  []SilenceMatcher `json:"matchers"`
	Reason    string           `json:"reason"`
	CreatedAt time.Time        `json:"createdAt"`
}

// ── WebSocket Events ─────────────────────────────────────────────────────────

type WSEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

const (
	WSTypeAlertsUpdate   = "alerts_update"   // payload: { alerts: EnrichedAlert[] }
	WSTypeClaimSet       = "claim_set"       // payload: { fingerprint, clusterName, claim }
	WSTypeClaimReleased  = "claim_released"  // payload: { fingerprint, clusterName, releasedBy }
	WSTypeCommentAdded   = "comment_added"   // payload: { fingerprint, comment }
	WSTypeSilencesUpdate = "silences_update" // payload: {} — pure invalidation signal, clients refetch /api/v1/silences
)

// ── Cluster ──────────────────────────────────────────────────────────────────

type ClusterInfo struct {
	Name            string `json:"name"`
	AlertmanagerURL string `json:"alertmanagerUrl"`
	PrometheusURL   string `json:"prometheusUrl"`
	Healthy         bool   `json:"healthy"`
	AlertCount      int    `json:"alertCount"`
	// Members lists per-member health for HA clusters. Omitted for
	// single-member clusters so existing payloads stay byte-identical.
	Members []MemberInfo `json:"members,omitempty"`
}

// MemberInfo describes one Alertmanager HA-cluster member.
type MemberInfo struct {
	Name    string `json:"name"` // host:port
	URL     string `json:"url"`  // browser-visible URL (HOST_ALIAS-rewritten)
	Healthy bool   `json:"healthy"`
}

// ── AlertGroup ───────────────────────────────────────────────────────────────

// AlertGroup groups alerts by severity + alertname (for /alerts/groups).
type AlertGroup struct {
	Alertname string          `json:"alertname"`
	Severity  string          `json:"severity"`
	Alerts    []EnrichedAlert `json:"alerts"`
	Count     int             `json:"count"`
}

// ── AlertHeatmap ─────────────────────────────────────────────────────────────

// AlertHeatmapResponse carries raw firing-start timestamps for
// /alerts/:fingerprint/heatmap; the frontend buckets them into cells so
// day/hour boundaries are computed in the browser's local timezone.
type AlertHeatmapResponse struct {
	Range        string   `json:"range"`
	FiringStarts []string `json:"firingStarts"`
}
