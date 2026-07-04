package cluster

import (
	"sync"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/config"
)

// Member is one Alertmanager HA-cluster member.
type Member struct {
	Name    string // host:port, used for display/metrics/tags
	URL     string // internal polling URL
	LinkURL string // browser-visible URL (HOST_ALIAS-rewritten)
	Client  *alertmanager.Client
}

// Cluster holds a configured Alertmanager cluster — one or more HA members
// polled and merged into one logical alert/silence set.
type Cluster struct {
	Name          string
	PrometheusURL string
	Members       []*Member

	// AlertmanagerURL / AlertmanagerLinkURL / Client mirror the first member —
	// back-compat convenience for single-member call sites and tests.
	AlertmanagerURL     string
	AlertmanagerLinkURL string
	Client              *alertmanager.Client

	upMu sync.Mutex
	up   map[string]bool // member name -> last known up/down, from the last FetchAlerts
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
		cl := buildCluster(c)
		r.clusters = append(r.clusters, cl)
		r.byName[c.Name] = cl
	}
	return r
}

func buildCluster(c config.ClusterConfig) *Cluster {
	memberCfgs := c.Members
	if len(memberCfgs) == 0 && c.AlertmanagerURL != "" {
		linkURL := c.AlertmanagerLinkURL
		if linkURL == "" {
			linkURL = c.AlertmanagerURL
		}
		memberCfgs = []config.MemberConfig{{
			Name:    config.DeriveMemberName(c.AlertmanagerURL),
			URL:     c.AlertmanagerURL,
			LinkURL: linkURL,
		}}
	}

	auth := buildAuth(c.Auth)
	members := make([]*Member, 0, len(memberCfgs))
	for _, mc := range memberCfgs {
		members = append(members, &Member{
			Name:    mc.Name,
			URL:     mc.URL,
			LinkURL: mc.LinkURL,
			Client:  alertmanager.NewClientWithAuth(mc.URL, auth),
		})
	}

	cl := &Cluster{
		Name:          c.Name,
		PrometheusURL: c.PrometheusURL,
		Members:       members,
		up:            make(map[string]bool),
	}
	if len(members) > 0 {
		cl.AlertmanagerURL = members[0].URL
		cl.AlertmanagerLinkURL = members[0].LinkURL
		cl.Client = members[0].Client
	}
	return cl
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
