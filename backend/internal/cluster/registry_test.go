package cluster

import (
	"testing"

	"github.com/kj187/jarvis/backend/internal/config"
)

func TestNewRegistry_Empty(t *testing.T) {
	r := NewRegistry(nil)
	if len(r.All()) != 0 {
		t.Errorf("expected 0 clusters, got %d", len(r.All()))
	}
	if r.Get("anything") != nil {
		t.Error("Get on empty registry must return nil")
	}
}

func TestNewRegistry_SingleCluster(t *testing.T) {
	r := NewRegistry([]config.ClusterConfig{
		{
			Name:                "homelab",
			AlertmanagerURL:     "http://am:9093",
			AlertmanagerLinkURL: "http://am.lan.example.com",
			PrometheusURL:       "http://prom:9090",
		},
	})

	if len(r.All()) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(r.All()))
	}

	cl := r.Get("homelab")
	if cl == nil {
		t.Fatal("expected cluster homelab, got nil")
	}
	if cl.Name != "homelab" {
		t.Errorf("Name = %q, want homelab", cl.Name)
	}
	if cl.AlertmanagerURL != "http://am:9093" {
		t.Errorf("AlertmanagerURL = %q", cl.AlertmanagerURL)
	}
	if cl.AlertmanagerLinkURL != "http://am.lan.example.com" {
		t.Errorf("AlertmanagerLinkURL = %q", cl.AlertmanagerLinkURL)
	}
	if cl.PrometheusURL != "http://prom:9090" {
		t.Errorf("PrometheusURL = %q", cl.PrometheusURL)
	}
	if cl.Client == nil {
		t.Error("Client must not be nil")
	}
}

func TestNewRegistry_MultipleClusters(t *testing.T) {
	r := NewRegistry([]config.ClusterConfig{
		{Name: "prod", AlertmanagerURL: "http://prod-am:9093"},
		{Name: "staging", AlertmanagerURL: "http://staging-am:9093"},
		{Name: "dev", AlertmanagerURL: "http://dev-am:9093"},
	})

	if len(r.All()) != 3 {
		t.Fatalf("expected 3 clusters, got %d", len(r.All()))
	}

	for _, name := range []string{"prod", "staging", "dev"} {
		cl := r.Get(name)
		if cl == nil {
			t.Errorf("cluster %q not found", name)
			continue
		}
		if cl.Name != name {
			t.Errorf("Name = %q, want %q", cl.Name, name)
		}
	}
}

func TestGet_NotFound(t *testing.T) {
	r := NewRegistry([]config.ClusterConfig{
		{Name: "homelab", AlertmanagerURL: "http://am:9093"},
	})

	cl := r.Get("nonexistent")
	if cl != nil {
		t.Errorf("expected nil for nonexistent cluster, got %+v", cl)
	}
}

func TestAll_ReturnsSlice(t *testing.T) {
	r := NewRegistry([]config.ClusterConfig{
		{Name: "a", AlertmanagerURL: "http://a:9093"},
		{Name: "b", AlertmanagerURL: "http://b:9093"},
	})

	all := r.All()
	if len(all) != 2 {
		t.Fatalf("All() = %d, want 2", len(all))
	}
	// Verify each has a non-nil client
	for _, cl := range all {
		if cl.Client == nil {
			t.Errorf("cluster %q has nil client", cl.Name)
		}
	}
}
