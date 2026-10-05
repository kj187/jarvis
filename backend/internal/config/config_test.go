package config

import (
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestLoad_Defaults(t *testing.T) {
	// Ensure no JARVIS_ vars are set
	for _, key := range []string{
		"JARVIS_PORT", "JARVIS_LOG_LEVEL", "JARVIS_POLL_INTERVAL",
		"JARVIS_DB_PATH", "JARVIS_ALLOWED_ORIGINS", "JARVIS_PPROF_ADDR",
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
	if cfg.PprofAddr != "" {
		t.Errorf("PprofAddr = %q, want empty (disabled by default)", cfg.PprofAddr)
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

func TestLoad_PprofAddr_Custom(t *testing.T) {
	t.Setenv("JARVIS_PPROF_ADDR", "127.0.0.1:6060")
	t.Setenv("JARVIS_CLUSTER_1_NAME", "") // no clusters

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.PprofAddr != "127.0.0.1:6060" {
		t.Errorf("PprofAddr = %q, want 127.0.0.1:6060", cfg.PprofAddr)
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

func TestLoad_ClusterSingleMember(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://am:9093")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	members := cfg.Clusters[0].Members
	if len(members) != 1 {
		t.Fatalf("len(Members) = %d, want 1", len(members))
	}
	if members[0].Name != "am:9093" {
		t.Errorf("Members[0].Name = %q, want am:9093", members[0].Name)
	}
	if members[0].URL != "http://am:9093" {
		t.Errorf("Members[0].URL = %q", members[0].URL)
	}
	if members[0].LinkURL != "http://am:9093" {
		t.Errorf("Members[0].LinkURL = %q", members[0].LinkURL)
	}
}

func TestLoad_ClusterMultipleMembers(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "prod")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://am1:9093,http://am2:9093,http://am3:9093")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if len(c.Members) != 3 {
		t.Fatalf("len(Members) = %d, want 3", len(c.Members))
	}
	wantNames := []string{"am1:9093", "am2:9093", "am3:9093"}
	for i, want := range wantNames {
		if c.Members[i].Name != want {
			t.Errorf("Members[%d].Name = %q, want %q", i, c.Members[i].Name, want)
		}
	}
	// Back-compat single-URL fields mirror the first member.
	if c.AlertmanagerURL != "http://am1:9093" {
		t.Errorf("AlertmanagerURL = %q, want http://am1:9093 (first member)", c.AlertmanagerURL)
	}
}

func TestLoad_ClusterMultipleMembers_WhitespaceTolerant(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "prod")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", " http://am1:9093 , http://am2:9093 ")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if len(c.Members) != 2 {
		t.Fatalf("len(Members) = %d, want 2", len(c.Members))
	}
	if c.Members[0].URL != "http://am1:9093" || c.Members[1].URL != "http://am2:9093" {
		t.Errorf("Members URLs not trimmed: %+v", c.Members)
	}
}

func TestLoad_ClusterMultipleMembers_HostAliasAppliesToAll(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "prod")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://am1:9093,http://am2:9093")
	t.Setenv("JARVIS_CLUSTER_1_HOST_ALIAS", "https://am.example.com")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	for i, m := range c.Members {
		if m.LinkURL != "https://am.example.com" {
			t.Errorf("Members[%d].LinkURL = %q, want https://am.example.com", i, m.LinkURL)
		}
	}
}

func TestLoad_ClusterMultipleMembers_HostAliasPerMember(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "prod")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://test-alertmanager:9093,http://test-alertmanager-2:9093")
	t.Setenv("JARVIS_CLUSTER_1_HOST_ALIAS", "http://localhost:9094,http://localhost:9095")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	c := cfg.Clusters[0]
	if len(c.Members) != 2 {
		t.Fatalf("len(Members) = %d, want 2", len(c.Members))
	}
	if c.Members[0].LinkURL != "http://localhost:9094" {
		t.Errorf("Members[0].LinkURL = %q, want http://localhost:9094", c.Members[0].LinkURL)
	}
	if c.Members[1].LinkURL != "http://localhost:9095" {
		t.Errorf("Members[1].LinkURL = %q, want http://localhost:9095", c.Members[1].LinkURL)
	}
}

func TestLoad_ClusterMultipleMembers_HostAliasCountMismatch(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "prod")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://am1:9093,http://am2:9093,http://am3:9093")
	t.Setenv("JARVIS_CLUSTER_1_HOST_ALIAS", "http://localhost:9094,http://localhost:9095")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	_, err := Load()
	if err == nil {
		t.Error("expected error when HOST_ALIAS count matches neither 1 nor member count")
	}
}

func TestLoad_ClusterDuplicateMemberURL(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "prod")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://am1:9093,http://am1:9093")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	_, err := Load()
	if err == nil {
		t.Error("expected error for duplicate member URL, got nil")
	}
}

func TestLoad_ClusterAuthAppliesToAllMembers(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "prod")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://am1:9093,http://am2:9093")
	t.Setenv("JARVIS_CLUSTER_1_BEARER_TOKEN", "tok")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	// Auth lives on ClusterConfig, not per-member — applies to all members alike.
	if cfg.Clusters[0].Auth.BearerToken != "tok" {
		t.Errorf("BearerToken = %q, want tok", cfg.Clusters[0].Auth.BearerToken)
	}
	if len(cfg.Clusters[0].Members) != 2 {
		t.Fatalf("len(Members) = %d, want 2", len(cfg.Clusters[0].Members))
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

func TestLoad_DBMaxOpenConns_Default(t *testing.T) {
	t.Setenv("JARVIS_DB_MAX_OPEN_CONNS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.DBMaxOpenConns != 10 {
		t.Errorf("DBMaxOpenConns = %d, want 10", cfg.DBMaxOpenConns)
	}
}

func TestLoad_DBMaxOpenConns_Custom(t *testing.T) {
	t.Setenv("JARVIS_DB_MAX_OPEN_CONNS", "25")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.DBMaxOpenConns != 25 {
		t.Errorf("DBMaxOpenConns = %d, want 25", cfg.DBMaxOpenConns)
	}
}

func TestLoad_DBMaxOpenConns_Invalid(t *testing.T) {
	for _, raw := range []string{"0", "-3", "ten"} {
		t.Setenv("JARVIS_DB_MAX_OPEN_CONNS", raw)
		if _, err := Load(); err == nil {
			t.Errorf("Load() with JARVIS_DB_MAX_OPEN_CONNS=%q: expected error, got nil", raw)
		}
	}
}

// Ensure test cleanup resets env properly via t.Setenv.
var _ = os.Setenv

func TestLoad_OIDCGroupsClaim(t *testing.T) {
	t.Setenv("JARVIS_OIDC_GROUPS_CLAIM", "cognito:groups")
	t.Setenv("JARVIS_OIDC_ADMIN_VALUE", "Operator")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.OIDCGroupsClaim != "cognito:groups" {
		t.Errorf("OIDCGroupsClaim = %q, want cognito:groups", cfg.OIDCGroupsClaim)
	}
	if !reflect.DeepEqual(cfg.OIDCAdminGroups, []string{"Operator"}) {
		t.Errorf("OIDCAdminGroups = %v, want [Operator]", cfg.OIDCAdminGroups)
	}
}

func TestLoad_OIDCAdminValueList(t *testing.T) {
	cases := []struct {
		name string
		env  string
		want []string
	}{
		{"unset", "", nil},
		{"single value", "admin_a", []string{"admin_a"}},
		{"two values", "admin_a,admin_b", []string{"admin_a", "admin_b"}},
		{"whitespace trimmed", " admin_a , admin_b ", []string{"admin_a", "admin_b"}},
		{"empty entries dropped", "admin_a,,admin_b,", []string{"admin_a", "admin_b"}},
		{"only separators", " , ,", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("JARVIS_OIDC_ADMIN_VALUE", tc.env)
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load() error: %v", err)
			}
			if !reflect.DeepEqual(cfg.OIDCAdminGroups, tc.want) {
				t.Fatalf("OIDCAdminGroups = %#v, want %#v", cfg.OIDCAdminGroups, tc.want)
			}
		})
	}
}

// JARVIS_OIDC_ADMIN_CLAIM was renamed to JARVIS_OIDC_GROUPS_CLAIM without an
// alias: the old variable is ignored, never read as a fallback.
func TestLoad_OIDCAdminClaimIsNoLongerRead(t *testing.T) {
	t.Setenv("JARVIS_OIDC_GROUPS_CLAIM", "")
	t.Setenv("JARVIS_OIDC_ADMIN_CLAIM", "groups")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.OIDCGroupsClaim != "" {
		t.Errorf("OIDCGroupsClaim = %q, want empty (old variable must not act as an alias)", cfg.OIDCGroupsClaim)
	}
}

func TestWarnings_AdminGroupWithoutClaim(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
		want int
	}{
		{"oidc, admin group but no claim: nobody can become admin", Config{AuthProvider: "oidc", OIDCAdminGroups: []string{"Operator"}}, 1},
		{"oidc, claim and admin group", Config{AuthProvider: "oidc", OIDCGroupsClaim: "groups", OIDCAdminGroups: []string{"Operator"}}, 0},
		{"oidc, no admin group", Config{AuthProvider: "oidc", OIDCGroupsClaim: "groups"}, 0},
		{"admin group set but provider is not oidc", Config{AuthProvider: "internal", OIDCAdminGroups: []string{"Operator"}}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.cfg.Warnings(); len(got) != tc.want {
				t.Fatalf("Warnings() = %v, want %d entries", got, tc.want)
			}
		})
	}
}

func TestWarnings_AuthProviderNone(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
		want int
	}{
		{"none: anonymous writes are possible", Config{AuthProvider: "none"}, 1},
		{"internal", Config{AuthProvider: "internal"}, 0},
		{"oidc", Config{AuthProvider: "oidc", OIDCGroupsClaim: "groups"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.cfg.Warnings()
			if len(got) != tc.want {
				t.Fatalf("Warnings() = %v, want %d entries", got, tc.want)
			}
			if tc.want == 1 {
				for _, token := range []string{"JARVIS_AUTH_PROVIDER", "JARVIS_AUTH_MODE=full_protect"} {
					if !strings.Contains(got[0], token) {
						t.Errorf("warning %q does not mention %q", got[0], token)
					}
				}
			}
		})
	}
}

func TestLoad_ResolvedBufferTTL(t *testing.T) {
	cases := []struct {
		name    string
		env     string
		want    time.Duration
		wantErr bool
	}{
		{"unset defaults to 20m", "", 20 * time.Minute, false},
		{"custom value", "45m", 45 * time.Minute, false},
		{"minimum 1m", "1m", time.Minute, false},
		{"maximum 24h", "24h", 24 * time.Hour, false},
		{"below minimum", "59s", 0, true},
		{"zero", "0", 0, true},
		{"negative", "-5m", 0, true},
		{"above maximum", "25h", 0, true},
		{"not a duration", "soon", 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("JARVIS_CLUSTER_1_NAME", "")
			t.Setenv("JARVIS_RESOLVED_BUFFER_TTL", tc.env)
			cfg, err := Load()
			if tc.wantErr {
				if err == nil {
					t.Fatalf("Load() = nil error, want an error for %q", tc.env)
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error: %v", err)
			}
			if cfg.ResolvedBufferTTL != tc.want {
				t.Fatalf("ResolvedBufferTTL = %v, want %v", cfg.ResolvedBufferTTL, tc.want)
			}
		})
	}
}

func TestWarnings_ResolvedBufferTTL(t *testing.T) {
	cases := []struct {
		name string
		ttl  time.Duration
		want int
	}{
		{"default", 20 * time.Minute, 0},
		{"exactly 1h", time.Hour, 0},
		{"above 1h", time.Hour + time.Minute, 1},
		{"24h", 24 * time.Hour, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{ResolvedBufferTTL: tc.ttl}
			if got := cfg.Warnings(); len(got) != tc.want {
				t.Fatalf("Warnings() = %v, want %d entries", got, tc.want)
			}
		})
	}
}

func TestLoad_SetupToken(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "c1")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://am:9093")
	t.Setenv("JARVIS_AUTH_PROVIDER", "internal")
	t.Setenv("JARVIS_SECRET_KEY", "aaaabbbbccccddddeeeeffffgggghhhh")
	t.Setenv("JARVIS_SETUP_TOKEN", "first-run-token")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.SetupToken != "first-run-token" {
		t.Errorf("SetupToken = %q, want %q", cfg.SetupToken, "first-run-token")
	}
}

func TestWarnings_SetupTokenWithoutInternalAuth(t *testing.T) {
	cases := []struct {
		name string
		cfg  Config
		want int
	}{
		{"internal provider uses the token", Config{AuthProvider: "internal", SetupToken: "t"}, 0},
		{"oidc provider ignores the token", Config{AuthProvider: "oidc", SetupToken: "t"}, 1},
		{"no token", Config{AuthProvider: "oidc"}, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.cfg.Warnings(); len(got) != tc.want {
				t.Fatalf("Warnings() = %v, want %d entries", got, tc.want)
			}
		})
	}
}

func TestLoad_CookieSecure(t *testing.T) {
	for _, tc := range []struct {
		env     string
		want    string
		wantErr bool
	}{
		{"", "auto", false},
		{"auto", "auto", false},
		{"true", "true", false},
		{"false", "", true},
		{"yes", "", true},
	} {
		t.Run(tc.env, func(t *testing.T) {
			t.Setenv("JARVIS_AUTH_PROVIDER", "none")
			t.Setenv("JARVIS_CLUSTER_1_NAME", "")
			t.Setenv("JARVIS_COOKIE_SECURE", tc.env)
			cfg, err := Load()
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected an error for an invalid JARVIS_COOKIE_SECURE")
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error: %v", err)
			}
			if cfg.CookieSecure != tc.want {
				t.Errorf("CookieSecure = %q, want %q", cfg.CookieSecure, tc.want)
			}
		})
	}
}

func TestLoad_AllowedHosts(t *testing.T) {
	t.Setenv("JARVIS_AUTH_PROVIDER", "none")
	t.Setenv("JARVIS_CLUSTER_1_NAME", "")

	t.Setenv("JARVIS_ALLOWED_HOSTS", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if len(cfg.AllowedHosts) != 0 {
		t.Errorf("AllowedHosts = %v, want empty by default", cfg.AllowedHosts)
	}

	t.Setenv("JARVIS_ALLOWED_HOSTS", " Jarvis.Corp , jarvis.internal:8443,,")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	want := []string{"jarvis.corp", "jarvis.internal:8443"}
	if !slices.Equal(cfg.AllowedHosts, want) {
		t.Errorf("AllowedHosts = %v, want %v", cfg.AllowedHosts, want)
	}
}

func TestLoad_TrustedProxies(t *testing.T) {
	for _, tc := range []struct {
		name    string
		env     string
		want    []string
		wantErr bool
	}{
		{"empty", "", nil, false},
		{"cidr", "10.0.0.0/8", []string{"10.0.0.0/8"}, false},
		{"plain IPv4 becomes /32", "192.0.2.7", []string{"192.0.2.7/32"}, false},
		{"plain IPv6 becomes /128", "2001:db8::1", []string{"2001:db8::1/128"}, false},
		{"list with spaces", "10.0.0.0/8, 172.16.0.0/12", []string{"10.0.0.0/8", "172.16.0.0/12"}, false},
		{"garbage", "not-an-ip", nil, true},
		{"bad prefix", "10.0.0.0/99", nil, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("JARVIS_AUTH_PROVIDER", "none")
			t.Setenv("JARVIS_CLUSTER_1_NAME", "")
			t.Setenv("JARVIS_TRUSTED_PROXIES", tc.env)
			cfg, err := Load()
			if tc.wantErr {
				if err == nil {
					t.Fatal("expected an error for an invalid JARVIS_TRUSTED_PROXIES")
				}
				return
			}
			if err != nil {
				t.Fatalf("Load() error: %v", err)
			}
			var got []string
			for _, n := range cfg.TrustedProxies {
				got = append(got, n.String())
			}
			if !slices.Equal(got, tc.want) {
				t.Errorf("TrustedProxies = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestStripUserinfo(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"http://am:9093", "http://am:9093"},
		{"http://user:s3cretpw@am:9093", "http://am:9093"},
		{"https://token@am.example.com/path?x=1", "https://am.example.com/path?x=1"},
		{"", ""},
		{"not a url %%", "not a url %%"},
	} {
		if got := StripUserinfo(tc.in); got != tc.want {
			t.Errorf("StripUserinfo(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
	if !HasUserinfo("http://u:p@am:9093") || HasUserinfo("http://am:9093") {
		t.Error("HasUserinfo does not tell URLs with and without credentials apart")
	}
}

func TestLoad_ClusterURLUserinfoNeverBrowserVisible(t *testing.T) {
	t.Setenv("JARVIS_CLUSTER_1_NAME", "homelab")
	t.Setenv("JARVIS_CLUSTER_1_ALERTMANAGER_URL", "http://user:s3cretpw@am:9093")
	t.Setenv("JARVIS_CLUSTER_1_PROMETHEUS_URL", "http://pu:ppw@prom:9090")
	t.Setenv("JARVIS_CLUSTER_2_NAME", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	cl := cfg.Clusters[0]
	if cl.Members[0].URL != "http://user:s3cretpw@am:9093" {
		t.Errorf("Members[0].URL = %q, the polling URL must keep its credentials", cl.Members[0].URL)
	}
	for name, got := range map[string]string{
		"Members[0].LinkURL":  cl.Members[0].LinkURL,
		"AlertmanagerLinkURL": cl.AlertmanagerLinkURL,
		"PrometheusURL":       cl.PrometheusURL,
	} {
		if strings.Contains(got, "s3cretpw") || strings.Contains(got, "ppw") || strings.Contains(got, "@") {
			t.Errorf("%s = %q leaks credentials", name, got)
		}
	}
	if cl.Members[0].LinkURL != "http://am:9093" {
		t.Errorf("Members[0].LinkURL = %q, want http://am:9093", cl.Members[0].LinkURL)
	}
}

func TestLoad_MetricsToken(t *testing.T) {
	t.Setenv("JARVIS_AUTH_PROVIDER", "none")
	t.Setenv("JARVIS_CLUSTER_1_NAME", "")
	t.Setenv("JARVIS_METRICS_TOKEN", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.MetricsToken != "" {
		t.Errorf("MetricsToken = %q, want empty by default", cfg.MetricsToken)
	}
	t.Setenv("JARVIS_METRICS_TOKEN", "scrape-me")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.MetricsToken != "scrape-me" {
		t.Errorf("MetricsToken = %q, want scrape-me", cfg.MetricsToken)
	}
}

func TestLoad_WSMaxConnections(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want int
	}{
		{"", 500},
		{"25", 25},
		{"0", 0},
	} {
		t.Setenv("JARVIS_WS_MAX_CONNECTIONS", tc.raw)
		cfg, err := Load()
		if err != nil {
			t.Fatalf("Load() with %q: %v", tc.raw, err)
		}
		if cfg.WSMaxConnections != tc.want {
			t.Errorf("WSMaxConnections with %q = %d, want %d", tc.raw, cfg.WSMaxConnections, tc.want)
		}
	}
}

func TestLoad_WSMaxConnections_Invalid(t *testing.T) {
	for _, raw := range []string{"-1", "many", "1.5"} {
		t.Setenv("JARVIS_WS_MAX_CONNECTIONS", raw)
		if _, err := Load(); err == nil {
			t.Errorf("Load() with JARVIS_WS_MAX_CONNECTIONS=%q: expected error, got nil", raw)
		}
	}
}
