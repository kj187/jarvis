package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
)

// recordingOIDCProvider stands in for the identity provider and records what
// the handlers hand it, so the wiring between the start handler, the state
// cookie and the callback can be asserted without a real IdP.
type recordingOIDCProvider struct {
	authState, authNonce, authChallenge string
	exchCode, exchVerifier, exchNonce   string
}

func (p *recordingOIDCProvider) Mode() string { return "oidc" }
func (p *recordingOIDCProvider) AuthURL(state, nonce, codeChallenge string) string {
	p.authState, p.authNonce, p.authChallenge = state, nonce, codeChallenge
	return "https://idp.example/authorize?" + url.Values{"state": {state}, "nonce": {nonce}}.Encode()
}
func (p *recordingOIDCProvider) Exchange(_ context.Context, code, verifier, nonce string) (*auth.User, error) {
	p.exchCode, p.exchVerifier, p.exchNonce = code, verifier, nonce
	return &auth.User{ID: "u1", Username: "dana", Role: "user", Provider: "oidc"}, nil
}
func (p *recordingOIDCProvider) Authenticate(context.Context, string, string) (*auth.User, error) {
	return nil, nil
}
func (p *recordingOIDCProvider) Info() auth.ProviderInfo { return auth.ProviderInfo{Mode: "oidc"} }

// The nonce that goes to the IdP, the one kept in the state cookie and the one
// the callback passes to Exchange must be the same value, and the verifier
// handed to Exchange must be the one behind the challenge sent to the IdP.
// Breaking any link makes every SSO login fail (or skip the check).
func TestOIDCLogin_NonceAndVerifierTravelThroughCookieToExchange(t *testing.T) {
	srv, _ := newAuthServer(t)
	idp := &recordingOIDCProvider{}
	srv.authProvider = idp
	e := echo.New()

	// Start: the browser is redirected to the IdP and receives the state cookie.
	startRec := httptest.NewRecorder()
	startReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/oidc/start", nil)
	if err := srv.getOIDCStart(e.NewContext(startReq, startRec)); err != nil {
		t.Fatalf("start: %v", err)
	}
	if startRec.Code != http.StatusFound {
		t.Fatalf("start status = %d, want 302", startRec.Code)
	}
	if idp.authNonce == "" || idp.authState == "" || idp.authChallenge == "" {
		t.Fatalf("AuthURL received an empty argument: %+v", idp)
	}
	var stateCookie *http.Cookie
	for _, c := range startRec.Result().Cookies() {
		if c.Name == auth.OIDCStateCookieName {
			stateCookie = c
		}
	}
	if stateCookie == nil {
		t.Fatal("no state cookie set")
	}
	cookieState, cookieVerifier, cookieNonce, _, ok := decodeOIDCState(stateCookie.Value)
	if !ok {
		t.Fatalf("state cookie %q does not decode", stateCookie.Value)
	}
	if cookieNonce != idp.authNonce {
		t.Errorf("cookie nonce %q != nonce sent to the IdP %q", cookieNonce, idp.authNonce)
	}
	if cookieState != idp.authState {
		t.Errorf("cookie state %q != state sent to the IdP %q", cookieState, idp.authState)
	}

	// Callback: the IdP returns code and state; the handler exchanges with the cookie's values.
	cbRec := httptest.NewRecorder()
	cbReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/oidc/callback?code=the-code&state="+url.QueryEscape(idp.authState), nil)
	cbReq.AddCookie(stateCookie)
	if err := srv.getOIDCCallback(e.NewContext(cbReq, cbRec)); err != nil {
		t.Fatalf("callback: %v", err)
	}
	if cbRec.Code != http.StatusFound {
		t.Fatalf("callback status = %d, want 302", cbRec.Code)
	}
	if idp.exchCode != "the-code" {
		t.Errorf("Exchange code = %q, want the-code", idp.exchCode)
	}
	if idp.exchNonce != idp.authNonce {
		t.Errorf("Exchange nonce %q != the nonce sent to the IdP %q", idp.exchNonce, idp.authNonce)
	}
	sum := sha256.Sum256([]byte(idp.exchVerifier))
	if got := base64.RawURLEncoding.EncodeToString(sum[:]); got != idp.authChallenge || idp.exchVerifier != cookieVerifier {
		t.Errorf("Exchange verifier does not match the PKCE challenge sent to the IdP")
	}
}

// Two logins never share a nonce.
func TestOIDCLogin_NonceIsFreshPerLogin(t *testing.T) {
	srv, _ := newAuthServer(t)
	idp := &recordingOIDCProvider{}
	srv.authProvider = idp
	e := echo.New()

	seen := map[string]bool{}
	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/oidc/start", nil)
		if err := srv.getOIDCStart(e.NewContext(req, rec)); err != nil {
			t.Fatalf("start: %v", err)
		}
		if seen[idp.authNonce] {
			t.Fatalf("nonce %q was issued twice", idp.authNonce)
		}
		seen[idp.authNonce] = true
	}
}

// hangingOIDCProvider blocks in Exchange until its context ends, like an IdP
// token endpoint that never answers.
type hangingOIDCProvider struct{ recordingOIDCProvider }

func (p *hangingOIDCProvider) Exchange(ctx context.Context, _, _, _ string) (*auth.User, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

// A hanging IdP must not hold the callback open: Exchange runs under a timeout
// and the browser gets a 401 (Workflow Rule 5).
func TestOIDCCallback_HangingIdPTimesOutWith401(t *testing.T) {
	prev := oidcExchangeTimeout
	oidcExchangeTimeout = 100 * time.Millisecond
	t.Cleanup(func() { oidcExchangeTimeout = prev })

	srv, _ := newAuthServer(t)
	srv.authProvider = &hangingOIDCProvider{}
	e := echo.New()

	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/oidc/start", nil)
	if err := srv.getOIDCStart(e.NewContext(req, rec)); err != nil {
		t.Fatalf("start: %v", err)
	}
	var stateCookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.OIDCStateCookieName {
			stateCookie = c
		}
	}
	state, _, _, _, _ := decodeOIDCState(stateCookie.Value)

	cbReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/oidc/callback?code=c&state="+url.QueryEscape(state), nil)
	cbReq.AddCookie(stateCookie)
	done := make(chan error, 1)
	go func() { done <- srv.getOIDCCallback(e.NewContext(cbReq, httptest.NewRecorder())) }()

	select {
	case err := <-done:
		var he *echo.HTTPError
		if !errors.As(err, &he) || he.Code != http.StatusUnauthorized {
			t.Fatalf("err = %v, want HTTP 401", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("callback did not return: Exchange has no timeout")
	}
}
