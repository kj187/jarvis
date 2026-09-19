# Monitoring and metrics

Jarvis exposes a Prometheus-compatible `/metrics` endpoint so the alerting
stack it fronts can also monitor Jarvis itself. The endpoint is **public**
(like `/health`) — it bypasses `JARVIS_AUTH_MODE=full_protect` — and exposes
only aggregate counts and configured cluster names, never alert names,
labels, or annotations.

Monitoring Jarvis closes an easy blind spot: the UI can remain reachable while
an Alertmanager member is no longer being polled, a PostgreSQL follower has a
stale snapshot, or retention sweeps have stopped. The metrics below cover HTTP
requests, WebSockets, upstream polling, alert lifecycle events, leader
election, snapshot freshness, and retention. There are currently no dedicated
database, authentication, fanout, or history-write-error metrics.

## Scrape configuration

Plain `prometheus.yml` configuration:

```yaml
scrape_configs:
  - job_name: jarvis
    static_configs:
      - targets: ["jarvis:8080"]
```

For Kubernetes, the Helm chart supports Prometheus Operator discovery or pod
annotations:

```yaml
# Prometheus Operator (requires monitoring.coreos.com/v1 CRDs)
metrics:
  serviceMonitor:
    enabled: true
    labels:
      release: kube-prometheus-stack

# Alternatively, annotation-based scraping
metrics:
  podAnnotations: true
```

See the [Helm values reference](../charts/jarvis/README.md) for all related
values.

## Scrape-time gauges

Computed from the in-memory alert store, the WebSocket hub, and the poller's
own state at every scrape — never from a counter, so they can't drift out of
sync with reality.

| Metric | Labels | Meaning |
|---|---|---|
| `jarvis_build_info` | `version` | Always `1`; join on `version` to track which build is running |
| `jarvis_alerts` | `cluster`, `state` | Current alert count by state (`active`, `suppressed`, `unprocessed`, `resolved`) |
| `jarvis_alerts_by_severity` | `cluster`, `severity` | Current alert count by severity label (`none` when unset) |
| `jarvis_alertmanager_up` | `cluster`, `member` | `1` if the last poll of that Alertmanager HA member succeeded, else `0`. Single-member clusters emit their one member; a cluster stays healthy overall as long as at least one member is up |
| `jarvis_ws_clients` | — | Number of currently connected WebSocket clients |
| `jarvis_clusters_configured` | — | Number of configured Alertmanager clusters |
| `jarvis_leader` | — | `1` if this pod currently holds Alertmanager-polling/history-write leadership, else `0`. Always `1` on SQLite (single replica by design) |
| `jarvis_snapshot_stale` | — | `1` if a follower's consumed poll snapshot is older than 3× `JARVIS_POLL_INTERVAL` (a missed/delayed `pg_notify` and periodic resync both not having landed yet), else `0`. Always `0` while leader or on SQLite |

## Event counters

| Metric | Labels | Incremented when |
|---|---|---|
| `jarvis_poll_cycles_total` | `cluster` | Every poll attempt of a cluster |
| `jarvis_poll_errors_total` | `cluster`, `endpoint` (`alerts`/`silences`) | A poll of a cluster's alerts or silences endpoint fails |
| `jarvis_poll_duration_seconds` | — | Histogram of the full poll cycle across all clusters, including DB persistence — use this to see whether Jarvis overall is keeping up with its poll interval |
| `jarvis_cluster_fetch_duration_seconds` | `cluster`, `member` | Histogram of a single Alertmanager HA member's response time (alerts or silences) — use this to find *which* member is slow |
| `jarvis_alert_events_total` | `cluster`, `status` (`firing`/`suppressed`/`expired`/`resolved`) | A genuine alert lifecycle transition is recorded |
| `jarvis_ws_broadcasts_total` | `type` | A WebSocket event is broadcast to clients |
| `jarvis_http_requests_total` | `method`, `path`, `status` | Every HTTP request (labeled by route pattern, not raw URL) |
| `jarvis_http_request_duration_seconds` | `method`, `path`, `status` | Histogram of HTTP request duration |
| `jarvis_retention_sweeps_total` | — | A data-retention sweep completes (see [docs/retention.md](retention.md)). Only increments while retention is enabled — stays 0 forever on a default install |
| `jarvis_retention_deleted_rows_total` | `table` | Rows deleted by the retention sweeper, by table (`alert_events`, `alert_claims`, `alert_comments`, `silence_events`, `alert_fingerprints`) |
| `jarvis_retention_sweep_duration_seconds` | — | Histogram of a full sweep's duration across all tables |

Runtime metrics (`go_*`, `process_*`) are included via the standard Prometheus
Go/process collectors.

## Example PromQL

```promql
# Jarvis lost contact to a cluster
jarvis_alertmanager_up == 0

# Poll error rate
rate(jarvis_poll_errors_total[5m]) > 0

# Alert volume by cluster and state
sum by (cluster, state) (jarvis_alerts)

# Which Alertmanager member is slow
histogram_quantile(0.95, sum by (le, cluster, member) (rate(jarvis_cluster_fetch_duration_seconds_bucket[5m])))

# API latency p95
histogram_quantile(0.95, sum by (le, path) (rate(jarvis_http_request_duration_seconds_bucket[5m])))
```

## Prometheus alert rules

The following starting point covers the signals Jarvis actually exports.
Adjust `job`, durations, and thresholds to match your scrape configuration and
poll interval. The leader rules intentionally aggregate across pods; checking
`jarvis_leader == 1` per series cannot detect zero leaders or split brain.

```yaml
groups:
  - name: jarvis
    rules:
      - alert: JarvisNoLeader
        expr: sum(jarvis_leader{job="jarvis"}) == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: No Jarvis pod is the polling leader

      - alert: JarvisMultipleLeaders
        expr: sum(jarvis_leader{job="jarvis"}) > 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: More than one Jarvis pod reports leadership

      - alert: JarvisAlertmanagerClusterDown
        expr: max by (cluster) (jarvis_alertmanager_up{job="jarvis"}) == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: Jarvis cannot reach any member of Alertmanager cluster {{ $labels.cluster }}

      - alert: JarvisSnapshotStale
        expr: max by (instance) (jarvis_snapshot_stale{job="jarvis"}) == 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: Jarvis follower {{ $labels.instance }} has a stale snapshot

      - alert: JarvisPollErrors
        expr: sum by (cluster) (rate(jarvis_poll_errors_total{job="jarvis"}[5m])) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: Jarvis polling cluster {{ $labels.cluster }} is failing

      # Enable only when retention is configured. Set the window comfortably
      # above JARVIS_RETENTION_SWEEP_INTERVAL (12h by default).
      - alert: JarvisRetentionSweepMissing
        expr: sum(increase(jarvis_retention_sweeps_total{job="jarvis"}[25h])) < 1
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: Jarvis retention has not completed a sweep in 25 hours
```

`jarvis_alertmanager_up` is per member, so `max by (cluster)` alerts only when
every member of a cluster is down. `JarvisRetentionSweepMissing` cannot infer
whether retention is enabled; omit that rule on installations where it is
disabled. Prometheus should also alert on the Jarvis scrape target itself
being absent, because an absent target produces no `jarvis_*` series for these
rules to evaluate.
