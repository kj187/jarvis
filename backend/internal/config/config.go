package config

import (
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// Config holds all application configuration.
type Config struct {
	Port           string
	LogLevel       string
	PollInterval   time.Duration
	// DBDSN is the database connection string. Starts with "postgres://" or
	// "postgresql://" for PostgreSQL; anything else is treated as a SQLite file path.
	DBDSN          string
	RunbookBaseURL string
	AllowedOrigins []string
	Clusters       []ClusterConfig

	LogRequests bool

	// Auth
	AuthProvider     string // "none" | "internal" | "oidc"
	AuthMode         string // "none" | "write_protect" | "full_protect"
	SecretKey        []byte // HMAC key for JWTs; required when AuthProvider != "none"
	OIDCIssuer       string
	OIDCClientID     string
	OIDCClientSecret string
	OIDCRedirectURL  string
	OIDCScopes       []string
	OIDCAdminClaim   string // claim name that controls admin role (e.g. "groups", "cognito:groups")
	OIDCAdminValue   string // value inside that claim that grants admin (e.g. "Administrator")

	Retention RetentionConfig
}

// RetentionConfig holds the data-retention sweep settings. All Days fields
// are 0 by default — retention is opt-in, an upgrade must never silently
// delete data. See EffectiveEventsDays/EffectiveClaimsDays/
// EffectiveSilenceEventsDays/EffectiveCommentsDays for override semantics.
type RetentionConfig struct {
	// Days is the global default retention in days. 0 disables retention
	// entirely unless a per-domain override below is set.
	Days int
	// EventsDays/ClaimsDays/SilenceEventsDays override Days for their
	// domain when > 0; 0/unset inherits Days.
	EventsDays        int
	ClaimsDays        int
	SilenceEventsDays int
	// CommentsDays is deliberately NOT inherited from Days — comments carry
	// user-written context that should survive a re-firing alert. Only an
	// explicit value > 0 enables comment deletion.
	CommentsDays int
	// SweepInterval is how often the background sweeper runs.
	SweepInterval time.Duration
}

func effectiveRetentionDays(global, override int) int {
	if override > 0 {
		return override
	}
	return global
}

// EffectiveEventsDays returns the retention window for alert_events —
// EventsDays if set, else the global Days.
func (r RetentionConfig) EffectiveEventsDays() int {
	return effectiveRetentionDays(r.Days, r.EventsDays)
}

// EffectiveClaimsDays returns the retention window for released alert_claims
// — ClaimsDays if set, else the global Days.
func (r RetentionConfig) EffectiveClaimsDays() int {
	return effectiveRetentionDays(r.Days, r.ClaimsDays)
}

// EffectiveSilenceEventsDays returns the retention window for silence_events
// — SilenceEventsDays if set, else the global Days.
func (r RetentionConfig) EffectiveSilenceEventsDays() int {
	return effectiveRetentionDays(r.Days, r.SilenceEventsDays)
}

// EffectiveCommentsDays returns the retention window for alert_comments.
// Unlike the other domains it never inherits the global Days — only an
// explicit CommentsDays > 0 enables comment deletion.
func (r RetentionConfig) EffectiveCommentsDays() int {
	if r.CommentsDays > 0 {
		return r.CommentsDays
	}
	return 0
}

// Enabled reports whether any domain has an effective retention configured,
// i.e. whether the sweeper has any work to do at all.
func (r RetentionConfig) Enabled() bool {
	return r.EffectiveEventsDays() > 0 ||
		r.EffectiveClaimsDays() > 0 ||
		r.EffectiveSilenceEventsDays() > 0 ||
		r.EffectiveCommentsDays() > 0
}

// OAuth2Config holds OAuth2 client credentials for per-cluster Alertmanager authentication.
type OAuth2Config struct {
	ClientID     string
	ClientSecret string
	TokenURL     string
	Scopes       []string
}

// ClusterAuth holds per-cluster authentication options for outgoing Alertmanager requests.
type ClusterAuth struct {
	BearerToken string
	BasicUser   string
	BasicPass   string
	// Headers contains arbitrary HTTP headers sent with every request.
	// Key is the header name, value is the header value.
	Headers map[string]string
	// OAuth2 enables dynamic token fetching via client_credentials grant.
	// When set, it takes priority over BearerToken, BasicUser/BasicPass and Headers.
	OAuth2 *OAuth2Config
}

// MemberConfig holds one Alertmanager HA-cluster member. A ClusterConfig
// with a single member is exactly today's one-cluster-one-URL setup.
type MemberConfig struct {
	Name    string // host:port, used for display/metrics/tags
	URL     string // internal polling URL
	LinkURL string // browser-visible URL (HOST_ALIAS-rewritten)
}

// ClusterConfig holds configuration for a single Alertmanager cluster. A
// cluster may have multiple Members when it is an Alertmanager HA gossip
// cluster — see Members.
type ClusterConfig struct {
	Name string
	// AlertmanagerURL / AlertmanagerLinkURL mirror the first member (Members[0])
	// for single-member back-compat call sites. Always set when Members is set.
	AlertmanagerURL     string
	AlertmanagerLinkURL string
	PrometheusURL       string
	Auth                ClusterAuth
	// Members holds every HA member parsed from a comma-separated
	// ALERTMANAGER_URL. Len 1 for a classic single-URL cluster.
	Members []MemberConfig
}

// Load reads configuration from environment variables, optionally loading a
// .env file first (no-op if the file does not exist).
func Load() (*Config, error) {
	// godotenv.Load is a no-op when .env is absent — that's intentional.
	_ = godotenv.Load()

	pollInterval, err := time.ParseDuration(getEnv("JARVIS_POLL_INTERVAL", "15s"))
	if err != nil {
		return nil, fmt.Errorf("invalid JARVIS_POLL_INTERVAL: %w", err)
	}

	allowedOriginsRaw := getEnv("JARVIS_ALLOWED_ORIGINS", "")
	var allowedOrigins []string
	if allowedOriginsRaw != "" {
		for _, o := range strings.Split(allowedOriginsRaw, ",") {
			if trimmed := strings.TrimSpace(o); trimmed != "" {
				allowedOrigins = append(allowedOrigins, trimmed)
			}
		}
	}

	clusters, err := parseClusters()
	if err != nil {
		return nil, err
	}

	authProvider := getEnv("JARVIS_AUTH_PROVIDER", "none")
	secretKey, err := parseSecretKey(getEnv("JARVIS_SECRET_KEY", ""))
	if err != nil {
		return nil, err
	}
	if authProvider != "none" && len(secretKey) < 32 {
		return nil, fmt.Errorf("JARVIS_SECRET_KEY must be at least 32 bytes when JARVIS_AUTH_PROVIDER=%q", authProvider)
	}

	authMode := getEnv("JARVIS_AUTH_MODE", "")
	if authProvider == "none" {
		authMode = "none"
	} else {
		switch authMode {
		case "write_protect", "full_protect":
			// valid
		case "":
			authMode = "write_protect"
		default:
			return nil, fmt.Errorf("invalid JARVIS_AUTH_MODE=%q: must be write_protect or full_protect", authMode)
		}
	}

	oidcScopes := []string{"openid", "profile", "email"}
	if raw := getEnv("JARVIS_AUTH_OIDC_SCOPES", ""); raw != "" {
		oidcScopes = strings.Split(raw, ",")
	}

	retention, err := parseRetention()
	if err != nil {
		return nil, err
	}

	return &Config{
		Port:             getEnv("JARVIS_PORT", "8080"),
		LogLevel:         getEnv("JARVIS_LOG_LEVEL", "info"),
		LogRequests:      getEnvBool("JARVIS_LOG_REQUESTS", false),
		PollInterval:     pollInterval,
		DBDSN:            getEnv("JARVIS_DB_DSN", "/data/jarvis.db"),
		RunbookBaseURL:   getEnv("JARVIS_RUNBOOK_BASE_URL", ""),
		AllowedOrigins:   allowedOrigins,
		Clusters:         clusters,
		AuthProvider:     authProvider,
		AuthMode:         authMode,
		SecretKey:        secretKey,
		OIDCIssuer:       getEnv("JARVIS_AUTH_OIDC_ISSUER", ""),
		OIDCClientID:     getEnv("JARVIS_AUTH_OIDC_CLIENT_ID", ""),
		OIDCClientSecret: getEnv("JARVIS_AUTH_OIDC_CLIENT_SECRET", ""),
		OIDCRedirectURL:  getEnv("JARVIS_AUTH_OIDC_REDIRECT_URL", ""),
		OIDCScopes:       oidcScopes,
		OIDCAdminClaim:   getEnv("JARVIS_OIDC_ADMIN_CLAIM", ""),
		OIDCAdminValue:   getEnv("JARVIS_OIDC_ADMIN_VALUE", ""),
		Retention:        retention,
	}, nil
}

// parseRetentionDays reads a non-negative integer env var (days), defaulting
// to 0 (disabled). Negative values are a startup error.
func parseRetentionDays(key string) (int, error) {
	raw := getEnv(key, "0")
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("invalid %s: must be an integer, got %q", key, raw)
	}
	if v < 0 {
		return 0, fmt.Errorf("invalid %s: must be >= 0, got %d", key, v)
	}
	return v, nil
}

// parseRetention reads all JARVIS_RETENTION_* env vars into a RetentionConfig.
func parseRetention() (RetentionConfig, error) {
	days, err := parseRetentionDays("JARVIS_RETENTION_DAYS")
	if err != nil {
		return RetentionConfig{}, err
	}
	eventsDays, err := parseRetentionDays("JARVIS_RETENTION_EVENTS_DAYS")
	if err != nil {
		return RetentionConfig{}, err
	}
	claimsDays, err := parseRetentionDays("JARVIS_RETENTION_CLAIMS_DAYS")
	if err != nil {
		return RetentionConfig{}, err
	}
	silenceEventsDays, err := parseRetentionDays("JARVIS_RETENTION_SILENCE_EVENTS_DAYS")
	if err != nil {
		return RetentionConfig{}, err
	}
	commentsDays, err := parseRetentionDays("JARVIS_RETENTION_COMMENTS_DAYS")
	if err != nil {
		return RetentionConfig{}, err
	}
	sweepInterval, err := time.ParseDuration(getEnv("JARVIS_RETENTION_SWEEP_INTERVAL", "12h"))
	if err != nil {
		return RetentionConfig{}, fmt.Errorf("invalid JARVIS_RETENTION_SWEEP_INTERVAL: %w", err)
	}
	return RetentionConfig{
		Days:              days,
		EventsDays:        eventsDays,
		ClaimsDays:        claimsDays,
		SilenceEventsDays: silenceEventsDays,
		CommentsDays:      commentsDays,
		SweepInterval:     sweepInterval,
	}, nil
}

// parseSecretKey decodes a hex or base64 secret key string into raw bytes.
// Returns nil (no error) when the string is empty.
func parseSecretKey(raw string) ([]byte, error) {
	if raw == "" {
		return nil, nil
	}
	// Try hex first, then fall back to treating as raw bytes.
	if b, err := hex.DecodeString(raw); err == nil {
		return b, nil
	}
	return []byte(raw), nil
}

// parseClusters reads JARVIS_CLUSTER_N_* env vars in a loop until NAME is empty.
func parseClusters() ([]ClusterConfig, error) {
	var clusters []ClusterConfig
	for i := 1; ; i++ {
		prefix := fmt.Sprintf("JARVIS_CLUSTER_%d_", i)
		name := os.Getenv(prefix + "NAME")
		if name == "" {
			break
		}
		amURLRaw := os.Getenv(prefix + "ALERTMANAGER_URL")
		if amURLRaw == "" {
			return nil, fmt.Errorf("JARVIS_CLUSTER_%d_ALERTMANAGER_URL is required when NAME is set", i)
		}
		hostAlias := os.Getenv(prefix + "HOST_ALIAS")
		members, err := parseMembers(amURLRaw, hostAlias, i)
		if err != nil {
			return nil, err
		}

		auth := ClusterAuth{
			BearerToken: os.Getenv(prefix + "BEARER_TOKEN"),
			BasicUser:   os.Getenv(prefix + "BASIC_AUTH_USER"),
			BasicPass:   os.Getenv(prefix + "BASIC_AUTH_PASSWORD"),
			Headers:     parseClusterHeaders(prefix),
		}
		if clientID := os.Getenv(prefix + "OAUTH2_CLIENT_ID"); clientID != "" {
			tokenURL := os.Getenv(prefix + "OAUTH2_TOKEN_URL")
			if tokenURL == "" {
				return nil, fmt.Errorf("JARVIS_CLUSTER_%d_OAUTH2_TOKEN_URL is required when OAUTH2_CLIENT_ID is set", i)
			}
			var scopes []string
			if raw := os.Getenv(prefix + "OAUTH2_SCOPES"); raw != "" {
				for _, s := range strings.Split(raw, ",") {
					if t := strings.TrimSpace(s); t != "" {
						scopes = append(scopes, t)
					}
				}
			}
			auth.OAuth2 = &OAuth2Config{
				ClientID:     clientID,
				ClientSecret: os.Getenv(prefix + "OAUTH2_CLIENT_SECRET"),
				TokenURL:     tokenURL,
				Scopes:       scopes,
			}
		}

		clusters = append(clusters, ClusterConfig{
			Name:                name,
			AlertmanagerURL:     members[0].URL,
			AlertmanagerLinkURL: members[0].LinkURL,
			PrometheusURL:       os.Getenv(prefix + "PROMETHEUS_URL"),
			Auth:                auth,
			Members:             members,
		})
	}
	return clusters, nil
}

// parseMembers splits a (possibly comma-separated) ALERTMANAGER_URL into one
// MemberConfig per HA member. A single URL (no comma) produces exactly one
// member — today's behavior, unchanged. Whitespace around each URL is
// trimmed; empty parts are skipped. Duplicate member URLs are a startup error.
func parseMembers(rawURLs, rawHostAliases string, clusterIdx int) ([]MemberConfig, error) {
	seen := make(map[string]bool)
	var urls []string
	for _, part := range strings.Split(rawURLs, ",") {
		u := strings.TrimSpace(part)
		if u == "" {
			continue
		}
		if seen[u] {
			return nil, fmt.Errorf("JARVIS_CLUSTER_%d_ALERTMANAGER_URL: duplicate member URL %q", clusterIdx, u)
		}
		seen[u] = true
		urls = append(urls, u)
	}
	if len(urls) == 0 {
		return nil, fmt.Errorf("JARVIS_CLUSTER_%d_ALERTMANAGER_URL is required when NAME is set", clusterIdx)
	}

	aliases, err := splitHostAliases(rawHostAliases, len(urls), clusterIdx)
	if err != nil {
		return nil, err
	}

	members := make([]MemberConfig, len(urls))
	for i, u := range urls {
		members[i] = MemberConfig{
			Name:    DeriveMemberName(u),
			URL:     u,
			LinkURL: resolveAlertmanagerLinkURL(u, aliases[i]),
		}
	}
	return members, nil
}

// splitHostAliases parses HOST_ALIAS into one alias per member. Empty input
// means no alias for any member. A single value applies to every member —
// today's single-member behavior, and a convenient default for an HA
// cluster fronted by one shared alias/load balancer. A comma-separated list
// must match the member count exactly, index for index, so each member can
// get its own browser-visible URL (e.g. distinct ports on localhost).
func splitHostAliases(raw string, memberCount, clusterIdx int) ([]string, error) {
	if raw == "" {
		return make([]string, memberCount), nil
	}
	var aliases []string
	for _, part := range strings.Split(raw, ",") {
		aliases = append(aliases, strings.TrimSpace(part))
	}
	if len(aliases) == 1 {
		out := make([]string, memberCount)
		for i := range out {
			out[i] = aliases[0]
		}
		return out, nil
	}
	if len(aliases) != memberCount {
		return nil, fmt.Errorf(
			"JARVIS_CLUSTER_%d_HOST_ALIAS: %d alias(es) for %d member(s) — must be 1 (applies to all) or exactly %d (one per member)",
			clusterIdx, len(aliases), memberCount, memberCount,
		)
	}
	return aliases, nil
}

// DeriveMemberName returns the display name for an Alertmanager member URL —
// its host:port. Falls back to the raw URL if it fails to parse.
func DeriveMemberName(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil || u.Host == "" {
		return rawURL
	}
	return u.Host
}

// parseClusterHeaders scans os.Environ for JARVIS_CLUSTER_N_HEADER_<name>=<value> entries
// and returns them as a map. The substring after HEADER_ is used as the header name verbatim.
func parseClusterHeaders(prefix string) map[string]string {
	headerPrefix := prefix + "HEADER_"
	headers := make(map[string]string)
	for _, env := range os.Environ() {
		if !strings.HasPrefix(env, headerPrefix) {
			continue
		}
		rest := strings.TrimPrefix(env, headerPrefix)
		idx := strings.Index(rest, "=")
		if idx < 1 {
			continue
		}
		headers[rest[:idx]] = rest[idx+1:]
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}

// resolveAlertmanagerLinkURL returns the browser-visible Alertmanager URL.
// When hostAlias is set its host/scheme replaces those of alertmanagerURL.
func resolveAlertmanagerLinkURL(alertmanagerURL, hostAlias string) string {
	if hostAlias == "" {
		return alertmanagerURL
	}
	alias, err := url.Parse(hostAlias)
	if err != nil || alias.Host == "" {
		return alertmanagerURL
	}
	base, err := url.Parse(alertmanagerURL)
	if err != nil {
		return alertmanagerURL
	}
	base.Scheme = alias.Scheme
	base.Host = alias.Host
	return base.String()
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		return fallback
	}
}
