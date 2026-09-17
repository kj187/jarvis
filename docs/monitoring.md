# Set up Monitoring

Jarvis exposes a Prometheus-compatible `/metrics` endpoint so the alerting
stack it fronts can also monitor Jarvis itself. The endpoint is **public**
(like `/health`) — it bypasses `JARVIS_AUTH_MODE=full_protect` — and exposes
only aggregate counts and configured cluster names, never alert names,
labels, or annotations. The exported metrics themselves are documented in
[Metrics](metrics.md).

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
