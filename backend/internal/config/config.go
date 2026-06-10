package config

import (
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
}

// ClusterConfig holds configuration for a single Alertmanager cluster.
type ClusterConfig struct {
	Name            string
	AlertmanagerURL string
	// AlertmanagerLinkURL is the browser-visible URL (may differ from AlertmanagerURL
	// when HOST_ALIAS is set).
	AlertmanagerLinkURL string
	PrometheusURL       string
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

	return &Config{
		Port:           getEnv("JARVIS_PORT", "8080"),
		LogLevel:       getEnv("JARVIS_LOG_LEVEL", "info"),
		PollInterval:   pollInterval,
		DBDSN:          getEnv("JARVIS_DB_DSN", "/data/jarvis.db"),
		RunbookBaseURL: getEnv("JARVIS_RUNBOOK_BASE_URL", ""),
		AllowedOrigins: allowedOrigins,
		Clusters:       clusters,
	}, nil
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

		clusters = append(clusters, ClusterConfig{
			Name:                name,
			AlertmanagerURL:     amURL,
			AlertmanagerLinkURL: linkURL,
			PrometheusURL:       os.Getenv(prefix + "PROMETHEUS_URL"),
		})
	}
	return clusters, nil
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
