package auth

import (
	"context"
	"errors"
)

// ErrInvalidCredentials is returned by Authenticate when the username/password
// pair is wrong. Any other error is an infrastructure failure (e.g. the
// database) and must not be counted as a failed login attempt.
var ErrInvalidCredentials = errors.New("invalid credentials")

// ErrLoginUnsupported is returned by Authenticate when the provider has no
// password login at all (none and oidc modes). It is neither a failed attempt
// nor a server fault.
var ErrLoginUnsupported = errors.New("password login not supported")

// Provider defines the authentication interface.
type Provider interface {
	// Mode returns the configured provider name.
	Mode() string // "none" | "internal" | "oidc"

	// AuthURL returns the OIDC authorization URL (oidc mode only).
	// Returns "" for other modes.
	AuthURL(state, nonce, codeChallenge string) string

	// Exchange exchanges an OIDC code for a User (oidc mode only).
	Exchange(ctx context.Context, code, codeVerifier, nonce string) (*User, error)

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
	// TokenVersion is the user's session version (users.token_version).
	TokenVersion int
}

// ProviderInfo is returned to the frontend via GET /auth/info.
type ProviderInfo struct {
	Mode          string `json:"mode"`          // "none" | "internal" | "oidc"
	LoginURL      string `json:"loginUrl"`      // "/auth/oidc/start" for oidc; "" otherwise
	SetupRequired bool   `json:"setupRequired"` // true when internal mode and no users exist
	// SetupTokenRequired is true while setup is open and JARVIS_SETUP_TOKEN is set; the token itself is never exposed.
	SetupTokenRequired bool   `json:"setupTokenRequired"`
	AuthMode           string `json:"authMode"`       // "none" | "write_protect" | "full_protect"
	RunbookBaseURL     string `json:"runbookBaseUrl"` // prepended to runbook label values when set
}

// ContextKey is used to store the authenticated user in Echo's context.
const ContextKey = "auth_user"
