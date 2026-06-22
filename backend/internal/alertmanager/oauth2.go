package alertmanager

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// tokenRefreshBuffer is how long before expiry a token is proactively refreshed.
const tokenRefreshBuffer = 30 * time.Second

// tokenFallbackTTL is used when the token endpoint does not return expires_in.
const tokenFallbackTTL = 5 * time.Minute

// OAuth2ClientConfig holds OAuth2 client credentials for the client_credentials grant.
type OAuth2ClientConfig struct {
	ClientID     string
	ClientSecret string
	TokenURL     string
	Scopes       []string
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	TokenType   string `json:"token_type"`
}

// oauth2TokenSource fetches and caches access tokens via the client_credentials grant.
// It is safe for concurrent use.
type oauth2TokenSource struct {
	cfg        OAuth2ClientConfig
	httpClient *http.Client

	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

func newOAuth2TokenSource(cfg OAuth2ClientConfig) *oauth2TokenSource {
	return &oauth2TokenSource{
		cfg:        cfg,
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

// Token returns a valid access token, fetching a new one if the cached token is
// absent or within tokenRefreshBuffer of expiry.
func (s *oauth2TokenSource) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.accessToken != "" && time.Now().Before(s.expiresAt.Add(-tokenRefreshBuffer)) {
		return s.accessToken, nil
	}
	return s.fetch(ctx)
}

// invalidate clears the cached token, forcing the next Token() call to fetch a new one.
func (s *oauth2TokenSource) invalidate() {
	s.mu.Lock()
	s.accessToken = ""
	s.mu.Unlock()
}

func (s *oauth2TokenSource) fetch(ctx context.Context) (string, error) {
	vals := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {s.cfg.ClientID},
		"client_secret": {s.cfg.ClientSecret},
	}
	if len(s.cfg.Scopes) > 0 {
		vals.Set("scope", strings.Join(s.cfg.Scopes, " "))
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.TokenURL, strings.NewReader(vals.Encode()))
	if err != nil {
		return "", fmt.Errorf("oauth2: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("oauth2: token request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("oauth2: read token response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("oauth2: token endpoint returned %d: %s", resp.StatusCode, string(body))
	}

	var tr tokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", fmt.Errorf("oauth2: decode token response: %w", err)
	}
	if tr.AccessToken == "" {
		return "", fmt.Errorf("oauth2: token endpoint returned empty access_token")
	}

	s.accessToken = tr.AccessToken
	if tr.ExpiresIn > 0 {
		s.expiresAt = time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second)
	} else {
		s.expiresAt = time.Now().Add(tokenFallbackTTL)
	}
	return s.accessToken, nil
}

// oauth2RoundTripper injects a dynamically refreshed bearer token into every request.
// On a 401 response it invalidates the cached token and retries once with a fresh token.
type oauth2RoundTripper struct {
	base   http.RoundTripper
	source *oauth2TokenSource
}

func (r *oauth2RoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	token, err := r.source.Token(req.Context())
	if err != nil {
		return nil, err
	}

	clone := req.Clone(req.Context())
	clone.Header.Set("Authorization", "Bearer "+token)

	resp, err := r.base.RoundTrip(clone)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusUnauthorized {
		return resp, nil
	}

	// 401: cached token is stale. Invalidate, fetch a fresh one, retry once.
	_ = resp.Body.Close()
	r.source.invalidate()

	newToken, err := r.source.Token(req.Context())
	if err != nil {
		return nil, fmt.Errorf("oauth2: refresh token after 401: %w", err)
	}

	var retryReq *http.Request
	switch {
	case req.Body == nil:
		retryReq = req.Clone(req.Context())
	case req.GetBody != nil:
		newBody, err := req.GetBody()
		if err != nil {
			return nil, fmt.Errorf("oauth2: recreate body for retry: %w", err)
		}
		retryReq = req.Clone(req.Context())
		retryReq.Body = newBody
	default:
		// Body already consumed and cannot be recreated — return 401 as-is.
		return &http.Response{
			StatusCode: http.StatusUnauthorized,
			Body:       io.NopCloser(strings.NewReader("unauthorized")),
			Request:    req,
		}, nil
	}

	retryReq.Header.Set("Authorization", "Bearer "+newToken)
	return r.base.RoundTrip(retryReq)
}
