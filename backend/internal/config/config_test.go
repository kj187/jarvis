package config

import (
	"os"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	// Ensure no JARVIS_ vars are set
	for _, key := range []string{
		"JARVIS_PORT", "JARVIS_LOG_LEVEL", "JARVIS_POLL_INTERVAL",
		"JARVIS_DB_PATH", "JARVIS_ALLOWED_ORIGINS",
	} {
		t.Setenv(key, "")
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Port != "8080" {
		t.Errorf("Port = %q, want 8080", cfg.Port)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", cfg.LogLevel)
	}
	if cfg.PollInterval != 15*time.Second {
		t.Errorf("PollInterval = %v, want 15s", cfg.PollInterval)
	}
	if cfg.DBDSN != "/data/jarvis.db" {
		t.Errorf("DBPath = %q, want /data/jarvis.db", cfg.DBDSN)
	}
	if len(cfg.AllowedOrigins) != 0 {
		t.Errorf("AllowedOrigins = %v, want empty", cfg.AllowedOrigins)
	}
}

func TestLoad_AllowedOrigins(t *testing.T) {
	t.Setenv("JARVIS_ALLOWED_ORIGINS", "http://localhost:5173, http://localhost:8080")
	// no clusters
	t.Setenv("JARVIS_CLUSTER_1_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if len(cfg.AllowedOrigins) != 2 {
		t.Fatalf("len(AllowedOrigins) = %d, want 2", len(cfg.AllowedOrigins))
	}
	if cfg.AllowedOrigins[0] != "http://localhost:5173" {
		t.Errorf("AllowedOrigins[0] = %q", cfg.AllowedOrigins[0])
	}
}

func TestLoad_ClusterParsing(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_PROMETHEUS_URL", "http://prometheus:9090")
	t.Setenv("JARVIS_CLUSTER_1_HOST_ALIAS", "")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "") // stop iteration

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if len(cfg.Clusters) != 1 {
		t.Fatalf("len(Clusters) = %d, want 1", len(cfg.Clusters))
	}
	c := cfg.Clusters[0]
	if c.Name != "homelab" {
		t.Errorf("Name = %q", c.Name)
	}
	if c.AlertmanagerURL != "http://alertmanager:9093" {
		t.Errorf("AlertmanagerURL = %q", c.AlertmanagerURL)
	}
	if c.AlertmanagerLinkURL != "http://alertmanager:9093" {
		t.Errorf("AlertmanagerLinkURL = %q (expected same as AlertmanagerURL when no HOST_ALIAS)", c.AlertmanagerLinkURL)
	}
}

func TestLoad_HostAlias(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_HOST_ALIAS", "https://alertmanager.lan.example.com")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if c.AlertmanagerLinkURL != "https://alertmanager.lan.example.com" {
		t.Errorf("AlertmanagerLinkURL = %q", c.AlertmanagerLinkURL)
	}
	// Internal polling URL must remain unchanged
	if c.AlertmanagerURL != "http://alertmanager:9093" {
		t.Errorf("AlertmanagerURL = %q", c.AlertmanagerURL)
	}
}

func TestLoad_InvalidPollInterval(t *testing.T) {
	t.Setenv("JARVIS_POLL_INTERVAL", "notaduration")
	_, err := Load()
	if err == nil {
		t.Error("expected error for invalid poll interval, got nil")
	}
}

func TestLoad_MissingAlertmanagerURL(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")
	_, err := Load()
	if err == nil {
		t.Error("expected error when ALERTMANAGER_URL is missing, got nil")
	}
}

func TestResolveAlertmanagerLinkURL(t *testing.T) {
	tests := []struct {
		amURL    string
		alias    string
		expected string
	}{
		{"http://am:9093", "", "http://am:9093"},
		{"http://am:9093", "https://am.example.com", "https://am.example.com"},
		{"http://am:9093/path", "https://am.example.com", "https://am.example.com/path"},
		{"http://am:9093", "not-a-url", "http://am:9093"},
	}

	for _, tt := range tests {
		got := resolveAlertmanagerLinkURL(tt.amURL, tt.alias)
		if got != tt.expected {
			t.Errorf("resolveAlertmanagerLinkURL(%q, %q) = %q, want %q", tt.amURL, tt.alias, got, tt.expected)
		}
	}
}

func TestLoad_AuthMode_NoneProvider(t *testing.T) {
	t.Setenv("JARVIS_AUTH_PROVIDER", "none")
	t.Setenv("JARVIS_AUTH_MODE", "full_protect") // ignored when provider=none
	t.Setenv("JARVIS_CLUSTER_1_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.AuthMode != "none" {
		t.Errorf("AuthMode = %q, want none (forced when provider=none)", cfg.AuthMode)
	}
}

func TestLoad_AuthMode_DefaultWriteProtect(t *testing.T) {
	t.Setenv("JARVIS_AUTH_PROVIDER", "internal")
	t.Setenv("JARVIS_AUTH_MODE", "")
	t.Setenv("JARVIS_SECRET_KEY", "aaaabbbbccccddddeeeeffffgggghhhh")
	t.Setenv("JARVIS_CLUSTER_1_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.AuthMode != "write_protect" {
		t.Errorf("AuthMode = %q, want write_protect (default when provider!=none)", cfg.AuthMode)
	}
}

func TestLoad_AuthMode_FullProtect(t *testing.T) {
	t.Setenv("JARVIS_AUTH_PROVIDER", "internal")
	t.Setenv("JARVIS_AUTH_MODE", "full_protect")
	t.Setenv("JARVIS_SECRET_KEY", "aaaabbbbccccddddeeeeffffgggghhhh")
	t.Setenv("JARVIS_CLUSTER_1_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.AuthMode != "full_protect" {
		t.Errorf("AuthMode = %q, want full_protect", cfg.AuthMode)
	}
}

func TestLoad_AuthMode_Invalid(t *testing.T) {
	t.Setenv("JARVIS_AUTH_PROVIDER", "internal")
	t.Setenv("JARVIS_AUTH_MODE", "read_only")
	t.Setenv("JARVIS_SECRET_KEY", "aaaabbbbccccddddeeeeffffgggghhhh")
	t.Setenv("JARVIS_CLUSTER_1_NAME", "")

	_, err := Load()
	if err == nil {
		t.Error("expected error for invalid JARVIS_AUTH_MODE, got nil")
	}
}

func TestLoad_ClusterBearerToken(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_BEARER_TOKEN", "mysecrettoken")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if c.Auth.BearerToken != "mysecrettoken" {
		t.Errorf("BearerToken = %q, want mysecrettoken", c.Auth.BearerToken)
	}
	if c.Auth.BasicUser != "" || c.Auth.BasicPass != "" {
		t.Errorf("unexpected basic auth: user=%q pass=%q", c.Auth.BasicUser, c.Auth.BasicPass)
	}
}

func TestLoad_ClusterBasicAuth(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_BASIC_AUTH_USER", "jarvis")
	t.Setenv("JARVIS_CLUSTER_1_BASIC_AUTH_PASSWORD", "s3cr3t")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if c.Auth.BasicUser != "jarvis" {
		t.Errorf("BasicUser = %q, want jarvis", c.Auth.BasicUser)
	}
	if c.Auth.BasicPass != "s3cr3t" {
		t.Errorf("BasicPass = %q, want s3cr3t", c.Auth.BasicPass)
	}
	if c.Auth.BearerToken != "" {
		t.Errorf("unexpected BearerToken = %q", c.Auth.BearerToken)
	}
}

func TestLoad_ClusterCustomHeaders(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_HEADER_X-Scope-OrgID", "tenant1")
	t.Setenv("JARVIS_CLUSTER_1_HEADER_X-Custom", "value")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if c.Auth.Headers["X-Scope-OrgID"] != "tenant1" {
		t.Errorf("Header X-Scope-OrgID = %q, want tenant1", c.Auth.Headers["X-Scope-OrgID"])
	}
	if c.Auth.Headers["X-Custom"] != "value" {
		t.Errorf("Header X-Custom = %q, want value", c.Auth.Headers["X-Custom"])
	}
}

func TestLoad_ClusterNoAuth(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_BEARER_TOKEN", "")
	t.Setenv("JARVIS_CLUSTER_1_BASIC_AUTH_USER", "")
	t.Setenv("JARVIS_CLUSTER_1_BASIC_AUTH_PASSWORD", "")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if c.Auth.BearerToken != "" || c.Auth.BasicUser != "" || c.Auth.BasicPass != "" || len(c.Auth.Headers) != 0 {
		t.Errorf("expected empty auth, got %+v", c.Auth)
	}
}

func TestLoad_ClusterOAuth2(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID", "jarvis-service")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_CLIENT_SECRET", "s3cr3t")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL", "https://keycloak.example.com/realms/homelab/protocol/openid-connect/token")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_SCOPES", "openid,profile")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if c.Auth.OAuth2 == nil {
		t.Fatal("Auth.OAuth2 is nil, want non-nil")
	}
	if c.Auth.OAuth2.ClientID != "jarvis-service" {
		t.Errorf("ClientID = %q, want jarvis-service", c.Auth.OAuth2.ClientID)
	}
	if c.Auth.OAuth2.ClientSecret != "s3cr3t" {
		t.Errorf("ClientSecret = %q, want s3cr3t", c.Auth.OAuth2.ClientSecret)
	}
	if c.Auth.OAuth2.TokenURL != "https://keycloak.example.com/realms/homelab/protocol/openid-connect/token" {
		t.Errorf("TokenURL = %q", c.Auth.OAuth2.TokenURL)
	}
	if len(c.Auth.OAuth2.Scopes) != 2 || c.Auth.OAuth2.Scopes[0] != "openid" || c.Auth.OAuth2.Scopes[1] != "profile" {
		t.Errorf("Scopes = %v, want [openid profile]", c.Auth.OAuth2.Scopes)
	}
}

func TestLoad_ClusterOAuth2_MissingTokenURL(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID", "jarvis-service")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL", "")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	_, err := Load()
	if err == nil {
		t.Error("expected error when OAUTH2_TOKEN_URL is missing, got nil")
	}
}

func TestLoad_ClusterOAuth2_NoScopesDefaultsToNil(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID", "jarvis-service")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL", "https://keycloak.example.com/token")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_SCOPES", "")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if c := cfg.Clusters[0]; c.Auth.OAuth2 != nil && len(c.Auth.OAuth2.Scopes) != 0 {
		t.Errorf("Scopes = %v, want empty when OAUTH2_SCOPES is unset", c.Auth.OAuth2.Scopes)
	}
}

func TestLoad_ClusterOAuth2_AbsentWhenClientIDEmpty(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://alertmanager:9093")
	t.Setenv("JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID", "")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.Clusters[0].Auth.OAuth2 != nil {
		t.Error("Auth.OAuth2 should be nil when OAUTH2_CLIENT_ID is not set")
	}
}

// Ensure test cleanup resets env properly via t.Setenv.
var _ = os.Setenv
