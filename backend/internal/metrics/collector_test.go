package metrics

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"

	"github.com/kj187/jarvis/backend/internal/models"
)

type fakeAlertSource struct{ alerts []models.EnrichedAlert }

func (f fakeAlertSource) Get() []models.EnrichedAlert { return f.alerts }

type fakeClientCounter struct{ count int }

func (f fakeClientCounter) ClientCount() int { return f.count }

func TestStoreCollector_Collect(t *testing.T) {
	alerts := fakeAlertSource{alerts: []models.EnrichedAlert{
		{ClusterName: "prod", Status: models.AlertStatus{State: "active"}, Labels: map[string]string{"severity": "critical"}},
		{ClusterName: "prod", Status: models.AlertStatus{State: "active"}, Labels: map[string]string{"severity": "critical"}},
		{ClusterName: "prod", Status: models.AlertStatus{State: "suppressed"}, Labels: map[string]string{}},
	}}
	clients := fakeClientCounter{count: 3}
	clusterUp := func() map[string]map[string]bool {
		return map[string]map[string]bool{
			"prod":    {"am1:9093": true},
			"staging": {"am2:9093": false},
		}
	}

	c := NewCollector(alerts, clients, clusterUp, 2)

	want := `
		# HELP jarvis_alerts Number of alerts, by cluster and state.
		# TYPE jarvis_alerts gauge
		jarvis_alerts{cluster="prod",state="active"} 2
		jarvis_alerts{cluster="prod",state="suppressed"} 1
		# HELP jarvis_alerts_by_severity Number of alerts, by cluster and severity.
		# TYPE jarvis_alerts_by_severity gauge
		jarvis_alerts_by_severity{cluster="prod",severity="critical"} 2
		jarvis_alerts_by_severity{cluster="prod",severity="none"} 1
		# HELP jarvis_alertmanager_up Whether the last poll of a cluster member succeeded (1) or failed (0).
		# TYPE jarvis_alertmanager_up gauge
		jarvis_alertmanager_up{cluster="prod",member="am1:9093"} 1
		jarvis_alertmanager_up{cluster="staging",member="am2:9093"} 0
		# HELP jarvis_clusters_configured Number of configured Alertmanager clusters.
		# TYPE jarvis_clusters_configured gauge
		jarvis_clusters_configured 2
		# HELP jarvis_ws_clients Number of currently connected WebSocket clients.
		# TYPE jarvis_ws_clients gauge
		jarvis_ws_clients 3
	`
	if err := testutil.CollectAndCompare(c, strings.NewReader(want),
		"jarvis_alerts", "jarvis_alerts_by_severity", "jarvis_alertmanager_up",
		"jarvis_clusters_configured", "jarvis_ws_clients"); err != nil {
		t.Fatalf("unexpected collector output: %v", err)
	}
}

func TestStoreCollector_NilClusterUp(t *testing.T) {
	c := NewCollector(fakeAlertSource{}, fakeClientCounter{}, nil, 0)

	if err := testutil.CollectAndCompare(c, strings.NewReader(`
		# HELP jarvis_alertmanager_up Whether the last poll of a cluster member succeeded (1) or failed (0).
		# TYPE jarvis_alertmanager_up gauge
	`), "jarvis_alertmanager_up"); err != nil {
		t.Fatalf("expected no jarvis_alertmanager_up samples when clusterUp is nil: %v", err)
	}
}

func TestMetrics_New_ExposesBuildInfo(t *testing.T) {
	m := New("v1.2.3-test")

	want := `
		# HELP jarvis_build_info Build information. Value is always 1.
		# TYPE jarvis_build_info gauge
		jarvis_build_info{version="v1.2.3-test"} 1
	`
	if err := testutil.GatherAndCompare(m.reg, strings.NewReader(want), "jarvis_build_info"); err != nil {
		t.Fatalf("unexpected jarvis_build_info output: %v", err)
	}
}

func TestMetrics_MustRegister_PanicsOnDuplicate(t *testing.T) {
	m := New("dev")
	c := NewCollector(fakeAlertSource{}, fakeClientCounter{}, nil, 1)
	m.MustRegister(c)

	defer func() {
		if recover() == nil {
			t.Fatal("expected panic on duplicate collector registration")
		}
	}()
	m.MustRegister(c)
}
