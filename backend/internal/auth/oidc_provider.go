package auth

import (
	"context"
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
	groupsClaim string // ID-token claim carrying the user's groups (e.g. "groups", "cognito:groups"); "" = not read
	adminValue  string // group inside groupsClaim that grants the admin role (e.g. "Administrator")
}

// NewOIDCProvider creates an OIDCProvider by discovering the OIDC issuer metadata.
func NewOIDCProvider(ctx context.Context, issuer, clientID, clientSecret, redirectURL string, scopes []string, store *users.Store, groupsClaim, adminValue string) (*OIDCProvider, error) {
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
		adminValue:  adminValue,
	}, nil
}

func (p *OIDCProvider) Mode() string { return "oidc" }

// AuthURL returns the OIDC authorization URL with PKCE challenge.
func (p *OIDCProvider) AuthURL(state, codeChallenge string) string {
	return p.oauth2Cfg.AuthCodeURL(state,
		oauth2.SetAuthURLParam("code_challenge", codeChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
}

// Exchange exchanges the authorization code for a User.
// The OIDC access/refresh tokens are never stored — only the derived user record.
func (p *OIDCProvider) Exchange(ctx context.Context, code, codeVerifier string) (*User, error) {
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

	var rawClaims map[string]any
	if err := idToken.Claims(&rawClaims); err != nil {
		return nil, fmt.Errorf("claims parse: %w", err)
	}
	slog.Debug("oidc id_token claims", "claims", rawClaims)

	var claims struct {
		Sub               string `json:"sub"`
		PreferredUsername string `json:"preferred_username"`
		Email             string `json:"email"`
		Name              string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("claims parse: %w", err)
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
		ID:       dbUser.ID,
		Username: dbUser.Username,
		Email:    dbUser.Email,
		Role:     dbUser.Role,
		Provider: dbUser.Provider,
	}, nil
}

func (p *OIDCProvider) Authenticate(_ context.Context, _, _ string) (*User, error) {
	return nil, errors.New("authenticate not supported in oidc mode")
}

func (p *OIDCProvider) Info() ProviderInfo {
	return ProviderInfo{Mode: "oidc", LoginURL: "/auth/oidc/start"}
}

// resolveRole returns "admin" when adminValue is configured and the user is in
// that group, otherwise "user".
func (p *OIDCProvider) resolveRole(groups []string) string {
	if p.adminValue == "" {
		return "user"
	}
	if slices.Contains(groups, p.adminValue) {
		return "admin"
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
