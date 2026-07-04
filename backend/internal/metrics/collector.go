package metrics

import (
	"github.com/prometheus/client_golang/prometheus"

	"github.com/kj187/jarvis/backend/internal/models"
)

// alertSource is the minimal interface needed from the in-memory alert store.
type alertSource interface {
	Get() []models.EnrichedAlert
}

// clientCounter is the minimal interface needed from the WS hub.
type clientCounter interface {
	ClientCount() int
}

var (
	alertsDesc = prometheus.NewDesc(
		"jarvis_alerts", "Number of alerts, by cluster and state.",
		[]string{"cluster", "state"}, nil)
	alertsBySeverityDesc = prometheus.NewDesc(
		"jarvis_alerts_by_severity", "Number of alerts, by cluster and severity.",
		[]string{"cluster", "severity"}, nil)
	alertmanagerUpDesc = prometheus.NewDesc(
		"jarvis_alertmanager_up", "Whether the last poll of a cluster member succeeded (1) or failed (0).",
		[]string{"cluster", "member"}, nil)
	wsClientsDesc = prometheus.NewDesc(
		"jarvis_ws_clients", "Number of currently connected WebSocket clients.", nil, nil)
	clustersConfiguredDesc = prometheus.NewDesc(
		"jarvis_clusters_configured", "Number of configured Alertmanager clusters.", nil, nil)
)

// storeCollector computes gauge values at scrape time from the in-memory
// alert store, the WS hub, and the recorder's last-poll-success state. There
// are no counters to keep in sync, so these gauges can never drift from
// reality. Collect must never perform upstream HTTP calls — clusterUp reads
// the recorder's cached last-poll-result map, it does not ping Alertmanager.
type storeCollector struct {
	alerts      alertSource
	clients     clientCounter
	clusterUp   func() map[string]map[string]bool
	numClusters int
}

// NewCollector creates the scrape-time collector. clusterUp may be nil (no
// jarvis_alertmanager_up samples emitted) until the recorder wires it in.
// clusterUp maps cluster name -> member name -> up.
func NewCollector(alerts alertSource, clients clientCounter, clusterUp func() map[string]map[string]bool, numClusters int) prometheus.Collector {
	return &storeCollector{alerts: alerts, clients: clients, clusterUp: clusterUp, numClusters: numClusters}
}

func (c *storeCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- alertsDesc
	ch <- alertsBySeverityDesc
	ch <- alertmanagerUpDesc
	ch <- wsClientsDesc
	ch <- clustersConfiguredDesc
}

func (c *storeCollector) Collect(ch chan<- prometheus.Metric) {
	type stateKey struct{ cluster, state string }
	byState := make(map[stateKey]int)
	type severityKey struct{ cluster, severity string }
	bySeverity := make(map[severityKey]int)

	for _, a := range c.alerts.Get() {
		byState[stateKey{a.ClusterName, a.Status.State}]++
		severity := a.Labels["severity"]
		if severity == "" {
			severity = "none"
		}
		bySeverity[severityKey{a.ClusterName, severity}]++
	}
	for k, v := range byState {
		ch <- prometheus.MustNewConstMetric(alertsDesc, prometheus.GaugeValue, float64(v), k.cluster, k.state)
	}
	for k, v := range bySeverity {
		ch <- prometheus.MustNewConstMetric(alertsBySeverityDesc, prometheus.GaugeValue, float64(v), k.cluster, k.severity)
	}

	if c.clusterUp != nil {
		for cluster, members := range c.clusterUp() {
			for member, up := range members {
				value := 0.0
				if up {
					value = 1.0
				}
				ch <- prometheus.MustNewConstMetric(alertmanagerUpDesc, prometheus.GaugeValue, value, cluster, member)
			}
		}
	}

	ch <- prometheus.MustNewConstMetric(wsClientsDesc, prometheus.GaugeValue, float64(c.clients.ClientCount()))
	ch <- prometheus.MustNewConstMetric(clustersConfiguredDesc, prometheus.GaugeValue, float64(c.numClusters))
}
