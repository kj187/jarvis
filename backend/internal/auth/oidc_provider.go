package auth

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"slices"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/kj187/jarvis/backend/internal/users"
)

// OIDCProvider implements OIDC Authorization Code Flow with PKCE.
type OIDCProvider struct {
	verifier    *gooidc.IDTokenVerifier
	oauth2Cfg   oauth2.Config
	users       *users.Store
	groupsClaim string   // ID-token claim carrying the user's groups (e.g. "groups", "cognito:groups"); "" = not read
	adminGroups []string // groups inside groupsClaim that grant the admin role (e.g. "Administrator"); any one suffices
}

// NewOIDCProvider creates an OIDCProvider by discovering the OIDC issuer metadata.
func NewOIDCProvider(ctx context.Context, issuer, clientID, clientSecret, redirectURL string, scopes []string, store *users.Store, groupsClaim string, adminGroups []string) (*OIDCProvider, error) {
	provider, err := gooidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc discovery: %w", err)
	}

	oidcScopes := []string{gooidc.ScopeOpenID}
	for _, s := range scopes {
		if s != gooidc.ScopeOpenID {
			oidcScopes = append(oidcScopes, s)
		}
	}

	cfg := oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		Endpoint:     provider.Endpoint(),
		Scopes:       oidcScopes,
	}

	verifier := provider.Verifier(&gooidc.Config{ClientID: clientID})

	return &OIDCProvider{
		verifier:    verifier,
		oauth2Cfg:   cfg,
		users:       store,
		groupsClaim: groupsClaim,
		adminGroups: adminGroups,
	}, nil
}

func (p *OIDCProvider) Mode() string { return "oidc" }

// AuthURL returns the OIDC authorization URL with PKCE challenge and the
// nonce the ID token must echo back.
func (p *OIDCProvider) AuthURL(state, nonce, codeChallenge string) string {
	return p.oauth2Cfg.AuthCodeURL(state,
		gooidc.Nonce(nonce),
		oauth2.SetAuthURLParam("code_challenge", codeChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
}

// Exchange exchanges the authorization code for a User.
// The OIDC access/refresh tokens are never stored — only the derived user record.
func (p *OIDCProvider) Exchange(ctx context.Context, code, codeVerifier, nonce string) (*User, error) {
	tok, err := p.oauth2Cfg.Exchange(ctx, code,
		oauth2.SetAuthURLParam("code_verifier", codeVerifier),
	)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}

	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok {
		return nil, errors.New("id_token missing from token response")
	}

	idToken, err := p.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("id_token verification: %w", err)
	}

	// The nonce ties this ID token to the login this browser started; without
	// it a token issued for another session could be replayed into this one.
	if nonce == "" || subtle.ConstantTimeCompare([]byte(idToken.Nonce), []byte(nonce)) != 1 {
		return nil, errors.New("id_token nonce mismatch")
	}

	var rawClaims map[string]any
	if err := idToken.Claims(&rawClaims); err != nil {
		return nil, fmt.Errorf("claims parse: %w", err)
	}
	// Never log the token or its claim values: a bearer credential and personal
	// data. The claim names are enough to debug a missing groups claim.
	slog.Debug("oidc id_token received", "claim_names", sortedKeys(rawClaims))

	var claims struct {
		Sub               string `json:"sub"`
		PreferredUsername string `json:"preferred_username"`
		Email             string `json:"email"`
		Name              string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("claims parse: %w", err)
	}

	// An unverified e-mail is attacker-chosen: it is dropped, so it can neither
	// become the username nor be stored. The login itself stands on `sub`.
	if v, present := rawClaims["email_verified"]; present && !emailVerified(v) {
		claims.Email = ""
	}

	username := claims.PreferredUsername
	if username == "" {
		username = claims.Email
	}
	if username == "" {
		username = claims.Sub
	}

	groups := claimStrings(rawClaims, p.groupsClaim)
	role := p.resolveRole(groups)
	dbUser, err := p.users.UpsertOIDCUser(ctx, claims.Sub, username, claims.Email, role, groups)
	if err != nil {
		return nil, fmt.Errorf("upsert oidc user: %w", err)
	}
	_ = p.users.UpdateLastLogin(ctx, dbUser.ID)

	return &User{
		ID:           dbUser.ID,
		Username:     dbUser.Username,
		Email:        dbUser.Email,
		Role:         dbUser.Role,
		Provider:     dbUser.Provider,
		TokenVersion: dbUser.TokenVersion,
	}, nil
}

func (p *OIDCProvider) Authenticate(_ context.Context, _, _ string) (*User, error) {
	return nil, ErrLoginUnsupported
}

func (p *OIDCProvider) Info() ProviderInfo {
	return ProviderInfo{Mode: "oidc", LoginURL: "/auth/oidc/start"}
}

// emailVerified reports whether a present email_verified claim asserts a
// verified address. Providers send a bool, Cognito sends the strings
// "true"/"false"; anything else is treated as not verified. (An absent claim is
// the caller's case: the IdP simply does not assert it, the e-mail is kept.)
func emailVerified(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return x == "true"
	}
	return false
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

// resolveRole returns "admin" when the user is in at least one of the
// configured admin groups, otherwise "user".
func (p *OIDCProvider) resolveRole(groups []string) string {
	for _, g := range p.adminGroups {
		if slices.Contains(groups, g) {
			return "admin"
		}
	}
	return "user"
}

// claimStrings returns the string values of the named claim: a string claim
// yields one value, an array yields its string items (Keycloak groups, Cognito
// cognito:groups). Anything else, an absent claim and an unset name yield nil.
func claimStrings(claims map[string]any, name string) []string {
	if name == "" {
		return nil
	}
	switch v := claims[name].(type) {
	case string:
		return []string{v}
	case []any:
		var out []string
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
