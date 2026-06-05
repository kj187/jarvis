package alertmanager

import "time"

// ── Alertmanager API v2 types ─────────────────────────────────────────────────

// GettableAlert is the response type from GET /api/v2/alerts.
type GettableAlert struct {
	Fingerprint  string            `json:"fingerprint"`
	Status       GettableAlertStatus `json:"status"`
	Labels       map[string]string `json:"labels"`
	Annotations  map[string]string `json:"annotations"`
	StartsAt     time.Time         `json:"startsAt"`
	EndsAt       time.Time         `json:"endsAt"`
	UpdatedAt    time.Time         `json:"updatedAt"`
	GeneratorURL string            `json:"generatorURL"`
	Receivers    []AMReceiver      `json:"receivers"`
}

type GettableAlertStatus struct {
	InhibitedBy []string `json:"inhibitedBy"`
	SilencedBy  []string `json:"silencedBy"`
	State       string   `json:"state"` // active | suppressed | unprocessed
}

type AMReceiver struct {
	Name string `json:"name"`
}

// GettableSilence is the response type from GET /api/v2/silences.
type GettableSilence struct {
	ID        string         `json:"id"`
	Matchers  []AMSilenceMatcher `json:"matchers"`
	StartsAt  time.Time      `json:"startsAt"`
	EndsAt    time.Time      `json:"endsAt"`
	CreatedBy string         `json:"createdBy"`
	Comment   string         `json:"comment"`
	Status    AMSilenceStatus `json:"status"`
	UpdatedAt time.Time      `json:"updatedAt"`
}

type AMSilenceMatcher struct {
	IsEqual bool   `json:"isEqual"`
	IsRegex bool   `json:"isRegex"`
	Name    string `json:"name"`
	Value   string `json:"value"`
}

type AMSilenceStatus struct {
	State string `json:"state"` // active | pending | expired
}

// PostableSilence is the request body for POST /api/v2/silences.
type PostableSilence struct {
	ID        string         `json:"id,omitempty"` // set for update/extend
	Matchers  []AMSilenceMatcher `json:"matchers"`
	StartsAt  time.Time      `json:"startsAt"`
	EndsAt    time.Time      `json:"endsAt"`
	CreatedBy string         `json:"createdBy"`
	Comment   string         `json:"comment"`
}

// PostSilenceResponse is the response from POST /api/v2/silences.
type PostSilenceResponse struct {
	SilenceID string `json:"silenceID"`
}

// AMStatus is the response from GET /api/v2/status (used for health check).
type AMStatus struct {
	Status string `json:"status"`
}
