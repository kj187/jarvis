# Metrics

Jarvis exposes a Prometheus-compatible `/metrics` endpoint so the alerting
stack it fronts can also monitor Jarvis itself. The endpoint is **public**
(like `/health`) — it bypasses `JARVIS_AUTH_MODE=full_protect` — and exposes
only aggregate counts and configured cluster names, never alert names,
labels, or annotations.

## Scrape-time gauges

Computed from the in-memory alert store, the WebSocket hub, and the poller's
own state at every scrape — never from a counter, so they can't drift out of
sync with reality.

| Metric | Labels | Meaning |
|---|---|---|
| `jarvis_build_info` | `version` | Always `1`; join on `version` to track which build is running |
| `jarvis_alerts` | `cluster`, `state` | Current alert count by state (`active`, `suppressed`, `unprocessed`, `resolved`) |
| `jarvis_alerts_by_severity` | `cluster`, `severity` | Current alert count by severity label (`none` when unset) |
| `jarvis_alertmanager_up` | `cluster` | `1` if the last poll of that cluster succeeded, else `0` |
| `jarvis_ws_clients` | — | Number of currently connected WebSocket clients |
| `jarvis_clusters_configured` | — | Number of configured Alertmanager clusters |

## Event counters

| Metric | Labels | Incremented when |
|---|---|---|
| `jarvis_poll_cycles_total` | `cluster` | Every poll attempt of a cluster |
| `jarvis_poll_errors_total` | `cluster`, `endpoint` (`alerts`/`silences`) | A poll of a cluster's alerts or silences endpoint fails |
| `jarvis_poll_duration_seconds` | — | Histogram of the full poll cycle across all clusters, including DB persistence — use this to see whether Jarvis overall is keeping up with its poll interval |
| `jarvis_cluster_fetch_duration_seconds` | `cluster` | Histogram of a single cluster's Alertmanager response time (alerts + silences) — use this to find *which* cluster is slow |
| `jarvis_alert_events_total` | `cluster`, `status` (`firing`/`suppressed`/`expired`/`resolved`) | A genuine alert lifecycle transition is recorded |
| `jarvis_ws_broadcasts_total` | `type` | A WebSocket event is broadcast to clients |
| `jarvis_http_requests_total` | `method`, `path`, `status` | Every HTTP request (labeled by route pattern, not raw URL) |
| `jarvis_http_request_duration_seconds` | `method`, `path`, `status` | Histogram of HTTP request duration |

Runtime metrics (`go_*`, `process_*`) are included via the standard Prometheus
Go/process collectors.

## Scrape configuration

Plain `prometheus.yml` scrape config:

```yaml
scrape_configs:
  - job_name: jarvis
    static_configs:
      - targets: ["jarvis:8080"]
```

## Helm

Two opt-in ways to let a cluster-wide Prometheus discover the endpoint (see
the [chart README](../charts/jarvis/README.md) for the full values reference):

```yaml
# Prometheus Operator (requires the monitoring.coreos.com/v1 CRDs)
metrics:
  serviceMonitor:
    enabled: true
    labels:
      release: kube-prometheus-stack   # match your Prometheus's serviceMonitorSelector

# Annotation-based scraping instead
metrics:
  podAnnotations: true
```

## Example PromQL

```promql
# Jarvis lost contact to a cluster
jarvis_alertmanager_up == 0

# Poll error rate
rate(jarvis_poll_errors_total[5m]) > 0

# Alert volume by cluster and state
sum by (cluster, state) (jarvis_alerts)

# Which cluster's Alertmanager is slow
histogram_quantile(0.95, sum by (le, cluster) (rate(jarvis_cluster_fetch_duration_seconds_bucket[5m])))

# API latency p95
histogram_quantile(0.95, sum by (le, path) (rate(jarvis_http_request_duration_seconds_bucket[5m])))
```
