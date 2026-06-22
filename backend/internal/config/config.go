package config

import (
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
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

// ClusterConfig holds configuration for a single Alertmanager cluster.
type ClusterConfig struct {
	Name            string
	AlertmanagerURL string
	// AlertmanagerLinkURL is the browser-visible URL (may differ from AlertmanagerURL
	// when HOST_ALIAS is set).
	AlertmanagerLinkURL string
	PrometheusURL       string
	Auth                ClusterAuth
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
		amURL := os.Getenv(prefix + "ALERTMANAGER_URL")
		if amURL == "" {
			return nil, fmt.Errorf("JARVIS_CLUSTER_%d_ALERTMANAGER_URL is required when NAME is set", i)
		}
		hostAlias := os.Getenv(prefix + "HOST_ALIAS")
		linkURL := resolveAlertmanagerLinkURL(amURL, hostAlias)

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
			AlertmanagerURL:     amURL,
			AlertmanagerLinkURL: linkURL,
			PrometheusURL:       os.Getenv(prefix + "PROMETHEUS_URL"),
			Auth:                auth,
		})
	}
	return clusters, nil
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
