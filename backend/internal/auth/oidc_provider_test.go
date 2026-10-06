package auth_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/users"
)

const (
	idpClientID = "jarvis-test"
	idpKeyID    = "test-key"
)

// mockIdP is a minimal OIDC provider: discovery, JWKS and a token endpoint that
// returns an ID token with whatever claims the test configured.
type mockIdP struct {
	srv *httptest.Server
	key *rsa.PrivateKey

	// claims overrides/extends the default ID-token claims for the next exchange.
	claims map[string]any
	// issued records the last raw id_token the token endpoint handed out.
	issued string
}

func newMockIdP(t *testing.T) *mockIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa key: %v", err)
	}
	idp := &mockIdP{key: key, claims: map[string]any{}}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                idp.srv.URL,
			"authorization_endpoint":                idp.srv.URL + "/authorize",
			"token_endpoint":                        idp.srv.URL + "/token",
			"jwks_uri":                              idp.srv.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		e := big.NewInt(int64(key.E)).Bytes()
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "use": "sig", "alg": "RS256", "kid": idpKeyID,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(e),
		}}})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, _ *http.Request) {
		c := jwt.MapClaims{
			"iss": idp.srv.URL, "aud": idpClientID, "sub": "sub-1",
			"iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
			"preferred_username": "dana", "email": "dana@example.com", "name": "Dana",
		}
		for k, v := range idp.claims {
			if v == nil {
				delete(c, k)
			} else {
				c[k] = v
			}
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, c)
		tok.Header["kid"] = idpKeyID
		raw, err := tok.SignedString(key)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		idp.issued = raw
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer", "id_token": raw})
	})
	idp.srv = httptest.NewServer(mux)
	t.Cleanup(idp.srv.Close)
	return idp
}

func newOIDC(t *testing.T, idp *mockIdP) *auth.OIDCProvider {
	t.Helper()
	database, dialect, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := db.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	p, err := auth.NewOIDCProvider(context.Background(), idp.srv.URL, idpClientID, "secret", "http://localhost/cb", nil, users.NewStore(database, dialect), "", nil)
	if err != nil {
		t.Fatalf("provider: %v", err)
	}
	return p
}

func TestOIDC_AuthURLCarriesTheNonce(t *testing.T) {
	p := newOIDC(t, newMockIdP(t))
	u := p.AuthURL("state-1", "nonce-1", "challenge-1")
	if !strings.Contains(u, "nonce=nonce-1") {
		t.Errorf("authorization URL has no nonce: %s", u)
	}
}

func TestOIDC_Exchange_Nonce(t *testing.T) {
	cases := []struct {
		name    string
		claims  map[string]any
		wantErr bool
	}{
		{"matching nonce", map[string]any{"nonce": "n-1"}, false},
		{"wrong nonce", map[string]any{"nonce": "attacker"}, true},
		{"nonce missing from the id_token", map[string]any{"nonce": nil}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			idp := newMockIdP(t)
			idp.claims = tc.claims
			p := newOIDC(t, idp)
			_, err := p.Exchange(context.Background(), "code", "verifier", "n-1")
			if (err != nil) != tc.wantErr {
				t.Errorf("err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// An e-mail the IdP does not vouch for (Keycloak without "Trust Email") must
// not block the login; it is dropped and never becomes the username. The
// identity hangs on `sub`.
func TestOIDC_Exchange_EmailVerified(t *testing.T) {
	cases := []struct {
		name      string
		value     any // nil = claim absent
		wantEmail string
	}{
		{"absent (IdP does not send it)", nil, "dana@example.com"},
		{"true", true, "dana@example.com"},
		{`"true" as string (Cognito)`, "true", "dana@example.com"},
		{"false", false, ""},
		{`"false" as string (Cognito)`, "false", ""},
		{`"False" capitalised`, "False", ""},
		{"number 0", 0, ""},
		{"number 1 is not an assertion of true", 1, ""},
		{"non-bool object", map[string]any{"x": 1}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			idp := newMockIdP(t)
			idp.claims = map[string]any{"nonce": "n-1", "email_verified": tc.value}
			p := newOIDC(t, idp)
			u, err := p.Exchange(context.Background(), "code", "verifier", "n-1")
			if err != nil {
				t.Fatalf("login must not be refused: %v", err)
			}
			if u.Email != tc.wantEmail {
				t.Errorf("email = %q, want %q", u.Email, tc.wantEmail)
			}
		})
	}
}

// Without preferred_username an unverified e-mail must not become the
// username; the fallback is sub. A verified one still may.
func TestOIDC_Exchange_UnverifiedEmailIsNotTheUsername(t *testing.T) {
	cases := []struct {
		name     string
		verified any
		want     string
	}{
		{"unverified", false, "sub-1"},
		{"verified", true, "dana@example.com"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			idp := newMockIdP(t)
			idp.claims = map[string]any{"nonce": "n-1", "email_verified": tc.verified, "preferred_username": nil}
			p := newOIDC(t, idp)
			u, err := p.Exchange(context.Background(), "code", "verifier", "n-1")
			if err != nil {
				t.Fatalf("exchange: %v", err)
			}
			if u.Username != tc.want {
				t.Errorf("username = %q, want %q", u.Username, tc.want)
			}
		})
	}
}

// An empty expected nonce must never validate, even for a token without one.
func TestOIDC_Exchange_EmptyExpectedNonceIsRefused(t *testing.T) {
	idp := newMockIdP(t)
	idp.claims = map[string]any{"nonce": nil}
	p := newOIDC(t, idp)
	if _, err := p.Exchange(context.Background(), "code", "verifier", ""); err == nil {
		t.Fatal("empty expected nonce with a nonce-less token was accepted")
	}
}

// The ID token is a bearer credential and its claims are personal data: even
// at debug level neither may reach the log.
func TestOIDC_Exchange_DoesNotLogTokenOrClaims(t *testing.T) {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	idp := newMockIdP(t)
	idp.claims = map[string]any{"nonce": "n-1"}
	p := newOIDC(t, idp)
	if _, err := p.Exchange(context.Background(), "code", "verifier", "n-1"); err != nil {
		t.Fatalf("exchange: %v", err)
	}

	logged := buf.String()
	for _, secret := range []string{idp.issued, "dana@example.com", "sub-1"} {
		if secret != "" && strings.Contains(logged, secret) {
			t.Errorf("log output contains %q:\n%s", secret, logged)
		}
	}
}
