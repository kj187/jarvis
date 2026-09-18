# Set up Monitoring

Jarvis exposes a Prometheus-compatible `/metrics` endpoint so the alerting
stack it fronts can also monitor Jarvis itself. The endpoint is **public**
(like `/health`) — it bypasses `JARVIS_AUTH_MODE=full_protect` — and exposes
only aggregate counts and configured cluster names, never alert names,
labels, or annotations. The exported metrics themselves are documented in
[Metrics](metrics.md).

Monitoring Jarvis closes an otherwise easy blind spot: the UI can still be
reachable while one Alertmanager cluster is no longer being polled, history
writes are failing, a PostgreSQL follower has stopped receiving snapshots, or
retention sweeps are failing. The endpoint provides request, WebSocket,
upstream polling, database, leader-election, snapshot/fanout, authentication,
and retention metrics. Together with `/health` and `GET /api/v1/status`, these
let you distinguish “the process is up” from “Jarvis is current and recording
the alert lifecycle correctly.”

At minimum, alert on sustained cluster fetch failures and history write
failures. PostgreSQL HA installations should additionally watch that exactly
one leader exists and that follower snapshot age remains bounded; installations
with retention enabled should watch failed sweeps. The concrete metric names
and labels are in [Metrics](metrics.md), and retention-specific behavior is in
[Data retention](retention.md#observability).

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
the [Helm values reference](../charts/jarvis/README.md) for the full values reference):

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
