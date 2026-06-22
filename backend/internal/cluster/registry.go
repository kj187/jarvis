package cluster

import (
	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/config"
)

// Cluster holds a configured Alertmanager cluster.
type Cluster struct {
	Name                string
	AlertmanagerURL     string
	AlertmanagerLinkURL string
	PrometheusURL       string
	Client              *alertmanager.Client
}

// Registry holds all configured clusters.
type Registry struct {
	clusters []*Cluster
	byName   map[string]*Cluster
}

// NewRegistry builds a Registry from the given cluster configs.
func NewRegistry(cfgs []config.ClusterConfig) *Registry {
	r := &Registry{
		byName: make(map[string]*Cluster, len(cfgs)),
	}
	for _, c := range cfgs {
		cl := &Cluster{
			Name:                c.Name,
			AlertmanagerURL:     c.AlertmanagerURL,
			AlertmanagerLinkURL: c.AlertmanagerLinkURL,
			PrometheusURL:       c.PrometheusURL,
			Client: alertmanager.NewClientWithAuth(c.AlertmanagerURL, buildAuth(c.Auth)),
		}
		r.clusters = append(r.clusters, cl)
		r.byName[c.Name] = cl
	}
	return r
}

// buildAuth maps a config.ClusterAuth to an alertmanager.Auth.
func buildAuth(cfg config.ClusterAuth) alertmanager.Auth {
	auth := alertmanager.Auth{
		BearerToken: cfg.BearerToken,
		BasicUser:   cfg.BasicUser,
		BasicPass:   cfg.BasicPass,
		Headers:     cfg.Headers,
	}
	if cfg.OAuth2 != nil {
		auth.OAuth2 = &alertmanager.OAuth2ClientConfig{
			ClientID:     cfg.OAuth2.ClientID,
			ClientSecret: cfg.OAuth2.ClientSecret,
			TokenURL:     cfg.OAuth2.TokenURL,
			Scopes:       cfg.OAuth2.Scopes,
		}
	}
	return auth
}

// All returns all clusters.
func (r *Registry) All() []*Cluster {
	return r.clusters
}

// Get returns the cluster with the given name, or nil if not found.
func (r *Registry) Get(name string) *Cluster {
	return r.byName[name]
}
