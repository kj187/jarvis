// Package metrics exposes Jarvis's Prometheus metrics on its own registry —
// never the global default one, so parallel Go tests never hit a duplicate
// registration panic.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics holds the injected registry and all instrumented (event-driven)
// metrics. Scrape-time gauges are computed by a separate prometheus.Collector
// (see collector.go) registered via MustRegister.
type Metrics struct {
	reg *prometheus.Registry

	PollCyclesTotal             *prometheus.CounterVec
	PollErrorsTotal             *prometheus.CounterVec
	PollDurationSeconds         prometheus.Histogram
	ClusterFetchDurationSeconds *prometheus.HistogramVec
	AlertEventsTotal            *prometheus.CounterVec
	WSBroadcastsTotal           *prometheus.CounterVec
	HTTPRequestsTotal           *prometheus.CounterVec
	HTTPRequestDuration         *prometheus.HistogramVec
}

// New creates a Metrics instance on a fresh registry, including the standard
// Go runtime and process collectors.
func New(version string) *Metrics {
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewGoCollector())
	reg.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))

	f := promauto.With(reg)

	buildInfo := f.NewGauge(prometheus.GaugeOpts{
		Name:        "jarvis_build_info",
		Help:        "Build information. Value is always 1.",
		ConstLabels: prometheus.Labels{"version": version},
	})
	buildInfo.Set(1)

	return &Metrics{
		reg: reg,
		PollCyclesTotal: f.NewCounterVec(prometheus.CounterOpts{
			Name: "jarvis_poll_cycles_total",
			Help: "Total number of Alertmanager poll cycles, per cluster.",
		}, []string{"cluster"}),
		PollErrorsTotal: f.NewCounterVec(prometheus.CounterOpts{
			Name: "jarvis_poll_errors_total",
			Help: "Total number of poll errors, per cluster and endpoint.",
		}, []string{"cluster", "endpoint"}),
		PollDurationSeconds: f.NewHistogram(prometheus.HistogramOpts{
			Name:    "jarvis_poll_duration_seconds",
			Help:    "Duration of a full poll cycle across all clusters, including DB persistence.",
			Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
		}),
		ClusterFetchDurationSeconds: f.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "jarvis_cluster_fetch_duration_seconds",
			Help:    "Duration of fetching alerts and silences from a single cluster's Alertmanager.",
			Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
		}, []string{"cluster"}),
		AlertEventsTotal: f.NewCounterVec(prometheus.CounterOpts{
			Name: "jarvis_alert_events_total",
			Help: "Total number of alert lifecycle events recorded, by cluster and status.",
		}, []string{"cluster", "status"}),
		WSBroadcastsTotal: f.NewCounterVec(prometheus.CounterOpts{
			Name: "jarvis_ws_broadcasts_total",
			Help: "Total number of WebSocket broadcasts, by event type.",
		}, []string{"type"}),
		HTTPRequestsTotal: f.NewCounterVec(prometheus.CounterOpts{
			Name: "jarvis_http_requests_total",
			Help: "Total number of HTTP requests, by method, route pattern and status.",
		}, []string{"method", "path", "status"}),
		HTTPRequestDuration: f.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "jarvis_http_request_duration_seconds",
			Help:    "HTTP request duration in seconds, by method, route pattern and status.",
			Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5},
		}, []string{"method", "path", "status"}),
	}
}

// MustRegister registers an additional collector (the scrape-time
// storeCollector) on the same registry. Panics on duplicate registration.
func (m *Metrics) MustRegister(c prometheus.Collector) {
	m.reg.MustRegister(c)
}

// Handler returns the HTTP handler exposing all metrics registered on m.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{})
}
