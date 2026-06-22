package alertmanager

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client is a thin HTTP client for Alertmanager API v2.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a new Alertmanager API client without authentication.
func NewClient(baseURL string) *Client {
	return NewClientWithAuth(baseURL, Auth{})
}

// NewClientWithAuth creates a new Alertmanager API client with per-cluster authentication.
// When auth is empty (zero value) the client behaves identically to NewClient.
// Priority: OAuth2 (client_credentials) > BearerToken > BasicAuth > Headers.
func NewClientWithAuth(baseURL string, auth Auth) *Client {
	transport := http.DefaultTransport
	switch {
	case auth.OAuth2 != nil:
		transport = &oauth2RoundTripper{
			base:   http.DefaultTransport,
			source: newOAuth2TokenSource(*auth.OAuth2),
		}
	case auth.BearerToken != "" || auth.BasicUser != "" || len(auth.Headers) > 0:
		transport = &authRoundTripper{base: http.DefaultTransport, auth: auth}
	}
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout:   10 * time.Second,
			Transport: transport,
		},
	}
}

// GetAlerts fetches all alerts from Alertmanager.
func (c *Client) GetAlerts(ctx context.Context) ([]GettableAlert, error) {
	var alerts []GettableAlert
	if err := c.get(ctx, "/api/v2/alerts", &alerts); err != nil {
		return nil, fmt.Errorf("get alerts: %w", err)
	}
	return alerts, nil
}

// GetSilences fetches all silences from Alertmanager.
func (c *Client) GetSilences(ctx context.Context) ([]GettableSilence, error) {
	var silences []GettableSilence
	if err := c.get(ctx, "/api/v2/silences", &silences); err != nil {
		return nil, fmt.Errorf("get silences: %w", err)
	}
	return silences, nil
}

// CreateSilence creates or updates a silence, returning the silence ID.
func (c *Client) CreateSilence(ctx context.Context, s PostableSilence) (string, error) {
	body, err := json.Marshal(s)
	if err != nil {
		return "", fmt.Errorf("marshal silence: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/v2/silences", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("post silence: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("alertmanager returned %d: %s", resp.StatusCode, string(b))
	}

	var result PostSilenceResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decode silence response: %w", err)
	}
	return result.SilenceID, nil
}

// DeleteSilence deletes a silence by ID.
func (c *Client) DeleteSilence(ctx context.Context, id string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.baseURL+"/api/v2/silence/"+id, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("delete silence: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("alertmanager returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

// Ping checks the Alertmanager health by calling GET /api/v2/status.
func (c *Client) Ping(ctx context.Context) error {
	var status AMStatus
	return c.get(ctx, "/api/v2/status", &status)
}

// get is a helper for GET requests that decodes JSON into v.
func (c *Client) get(ctx context.Context, path string, v interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("alertmanager returned %d for %s: %s", resp.StatusCode, path, string(b))
	}

	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		return fmt.Errorf("decode response from %s: %w", path, err)
	}
	return nil
}
