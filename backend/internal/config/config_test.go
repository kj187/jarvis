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

// Ensure test cleanup resets env properly via t.Setenv.
var _ = os.Setenv
