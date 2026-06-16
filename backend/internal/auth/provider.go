package auth

import "context"

// Provider defines the authentication interface.
type Provider interface {
	// Mode returns the configured provider name.
	Mode() string // "none" | "internal" | "oidc"

	// AuthURL returns the OIDC authorization URL (oidc mode only).
	// Returns "" for other modes.
	AuthURL(state, codeChallenge string) string

	// Exchange exchanges an OIDC code for a User (oidc mode only).
	Exchange(ctx context.Context, code, codeVerifier string) (*User, error)

	// Authenticate validates internal credentials (internal mode only).
	Authenticate(ctx context.Context, username, password string) (*User, error)

	// Info returns metadata for the frontend.
	Info() ProviderInfo
}

// User is the authenticated principal carried through the system.
type User struct {
	ID       string
	Username string
	Email    string
	Role     string // "user" | "admin"
	Provider string // "internal" | "oidc"
}

// ProviderInfo is returned to the frontend via GET /auth/info.
type ProviderInfo struct {
	Mode           string `json:"mode"`            // "none" | "internal" | "oidc"
	LoginURL       string `json:"loginUrl"`        // "/auth/oidc/start" for oidc; "" otherwise
	SetupRequired  bool   `json:"setupRequired"`   // true when internal mode and no users exist
	AuthMode       string `json:"authMode"`        // "none" | "write_protect" | "full_protect"
	RunbookBaseURL string `json:"runbookBaseUrl"`  // prepended to runbook label values when set
}

// ContextKey is used to store the authenticated user in Echo's context.
const ContextKey = "auth_user"
