#!/usr/bin/env bash
# Fires a diverse set of Kubernetes-themed Jarvis test alerts against Alertmanager.
# All alerts share label test_suite=jarvis — run resolve-test-alerts.sh to clean up.

set -euo pipefail

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required but not installed."; exit 1; }

AM="${ALERTMANAGER_URL:-http://localhost:9094}"
GRAFANA="https://grafana.example.com"
PROM="https://prometheus.example.com"
RUNBOOKS="https://runbooks.example.com/alerts"

# Explicit startsAt=now + far-future endsAt keeps alerts alive.
# Without explicit startsAt, some Alertmanager versions copy endsAt into startsAt.
STARTS_AT="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
ENDS_AT="2099-12-31T23:59:59.000Z"

post() {
  local payload
  payload=$(printf '%s' "$1" | jq --arg s "$STARTS_AT" --arg e "$ENDS_AT" 'map(. + {startsAt: $s, endsAt: $e})')
  curl -sf -L -X POST "${AM}/api/v2/alerts" \
    -H "Content-Type: application/json" \
    -d "$payload"
  echo " OK"
}

pause() {
  local s=$(( RANDOM % 8 + 1 ))
  printf "      sleeping ${s}s...\n"
  sleep "$s"
}

echo "==> Firing Kubernetes test alerts to ${AM} (randomized, ~2 min)"

printf "  [1/10] KubePodCrashLooping (critical, payment-api, prod)..."
post '[{
  "labels": {
    "alertname": "KubePodCrashLooping",
    "severity": "critical",
    "namespace": "prod",
    "pod": "payment-api-7d9f6b8c4-xk2lp",
    "container": "payment-api",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "runbook": "'"${RUNBOOKS}"'/KubePodCrashLooping",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Pod payment-api-7d9f6b8c4-xk2lp is crash looping",
    "description": "Pod has restarted 14 times in the last 15 minutes. Exit code: 137 (OOMKilled). See troubleshooting guide: https://wiki.example.com/oom-killed-pods for known patterns.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-pods?var-namespace=prod&var-pod=payment-api-7d9f6b8c4-xk2lp&orgId=1",
    "link": "https://jira.example.com/browse/PLAT-4821"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_restarts_total%7Bnamespace%3D%22prod%22%7D"
}]'

pause
printf "  [2/10] KubeNodeNotReady (critical, worker-node-3, prod)..."
post '[{
  "labels": {
    "alertname": "KubeNodeNotReady",
    "severity": "critical",
    "node": "worker-node-03.eu-west-1.compute.internal",
    "cluster": "eu-west-1-prod",
    "team": "infrastructure",
    "runbook": "'"${RUNBOOKS}"'/KubeNodeNotReady",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Node worker-node-03 has been NotReady for >5 minutes",
    "description": "Node condition NotReady since 14:32 UTC. 12 pods evicted and rescheduled. Possible disk pressure or kubelet failure.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-nodes?var-node=worker-node-03&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_node_status_condition%7Bcondition%3D%22Ready%22%2Cstatus%3D%22false%22%7D"
}]'

pause
printf "  [3/10] KubeAPIServerErrorsHigh (critical, kube-system, prod)..."
post '[{
  "labels": {
    "alertname": "KubeAPIServerErrorsHigh",
    "severity": "critical",
    "namespace": "kube-system",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "runbook": "'"${RUNBOOKS}"'/KubeAPIServerErrorsHigh",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Kubernetes API server error rate above 3%",
    "description": "5xx responses: 4.7% over last 10 minutes. kubectl commands may be intermittently failing. Check etcd health.",
    "dashboard": "'"${GRAFANA}"'/d/kube-apiserver?orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=rate(apiserver_request_total%7Bcode%3D~%225..%22%7D%5B5m%5D)"
}]'

pause
printf "  [4/10] KubeJobFailed (critical, data-pipeline, prod)..."
post '[{
  "labels": {
    "alertname": "KubeJobFailed",
    "severity": "critical",
    "namespace": "prod",
    "job_name": "nightly-data-pipeline",
    "cluster": "eu-west-1-prod",
    "team": "data",
    "runbook": "'"${RUNBOOKS}"'/KubeJobFailed",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "CronJob nightly-data-pipeline failed",
    "description": "Job failed after 3/3 retries. Last successful run: 2 days ago. S3 export incomplete. Check AWS S3 status at https://status.aws.amazon.com/ and pipeline logs at https://grafana.lan.kj187.de/explore?orgId=1.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-jobs?var-namespace=prod&orgId=1",
    "link": "https://jira.example.com/browse/DATA-1192"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_job_status_failed%7Bnamespace%3D%22prod%22%7D"
}]'

pause
printf "  [5/10] KubeDeploymentReplicasMismatch (warning, frontend, staging)..."
post '[{
  "labels": {
    "alertname": "KubeDeploymentReplicasMismatch",
    "severity": "warning",
    "namespace": "staging",
    "deployment": "frontend",
    "cluster": "eu-west-1-staging",
    "team": "frontend",
    "runbook": "'"${RUNBOOKS}"'/KubeDeploymentReplicasMismatch",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Deployment frontend has 1/3 desired replicas available",
    "description": "2 pods pending due to insufficient CPU quota in staging namespace. HPA cannot scale.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-deployments?var-namespace=staging&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_deployment_status_replicas_available%7Bnamespace%3D%22staging%22%7D"
}]'

pause
printf "  [6/10] KubePersistentVolumeFillingUp (warning, prometheus, prod)..."
post '[{
  "labels": {
    "alertname": "KubePersistentVolumeFillingUp",
    "severity": "warning",
    "namespace": "monitoring",
    "persistentvolumeclaim": "prometheus-data-0",
    "cluster": "eu-west-1-prod",
    "team": "observability",
    "runbook": "'"${RUNBOOKS}"'/KubePersistentVolumeFillingUp",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "PVC prometheus-data-0 is 82% full",
    "description": "At current ingestion rate volume will be full in ~36h. Consider increasing retention policy or expanding the PVC.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-pvc?var-namespace=monitoring&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kubelet_volume_stats_used_bytes%2Fkubelet_volume_stats_capacity_bytes"
}]'

pause
printf "  [7/10] KubeHpaMaxedOut (warning, auth-service, prod)..."
post '[{
  "labels": {
    "alertname": "KubeHpaMaxedOut",
    "severity": "warning",
    "namespace": "prod",
    "horizontalpodautoscaler": "auth-service",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "HPA auth-service is at maximum replica count (20/20)",
    "description": "HPA has been at maxReplicas for 25 minutes. CPU target: 70%, current: 94%. Consider raising maxReplicas or optimizing hot paths.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-hpa?var-namespace=prod&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_horizontalpodautoscaler_status_current_replicas%7Bnamespace%3D%22prod%22%7D"
}]'

pause
printf "  [8/10] KubePodOOMKilled (warning, ml-inference, prod)..."
post '[{
  "labels": {
    "alertname": "KubePodOOMKilled",
    "severity": "warning",
    "namespace": "prod",
    "pod": "ml-inference-6c8d9f7b5-p9nrq",
    "container": "inference-server",
    "cluster": "eu-west-1-prod",
    "team": "ml",
    "runbook": "'"${RUNBOOKS}"'/KubePodOOMKilled",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Container inference-server OOMKilled 3 times in 1h",
    "description": "Memory limit: 4Gi, actual peak RSS: 4.8Gi. Increase memory limit or reduce batch size. Memory profiling guide: https://wiki.example.com/ml-inference-memory-tuning",
    "dashboard": "'"${GRAFANA}"'/d/k8s-pods?var-namespace=prod&var-pod=ml-inference-6c8d9f7b5-p9nrq&orgId=1",
    "link": "https://jira.example.com/browse/ML-887"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_last_terminated_reason%7Breason%3D%22OOMKilled%22%7D"
}]'

pause
printf "  [9/10] KubeContainerWaiting (info, batch-worker, prod)..."
post '[{
  "labels": {
    "alertname": "KubeContainerWaiting",
    "severity": "info",
    "namespace": "prod",
    "pod": "batch-worker-5f7b9c2d8-r4mqx",
    "container": "batch-worker",
    "reason": "ImagePullBackOff",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Container batch-worker stuck in ImagePullBackOff",
    "description": "Image ghcr.io/acme/batch-worker:v2.4.1 cannot be pulled. Registry credentials may have expired or image tag does not exist."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_waiting_reason%7Breason%3D%22ImagePullBackOff%22%7D"
}]'

pause
printf " [10/10] KubeStatefulSetReplicasMismatch (info, kafka, prod)..."
post '[{
  "labels": {
    "alertname": "KubeStatefulSetReplicasMismatch",
    "severity": "info",
    "namespace": "prod",
    "statefulset": "kafka",
    "cluster": "eu-west-1-prod",
    "team": "data",
    "runbook": "'"${RUNBOOKS}"'/KubeStatefulSetReplicasMismatch",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "StatefulSet kafka has 2/3 ready replicas",
    "description": "kafka-2 pod is Pending — waiting for PVC kafka-data-kafka-2 to bind. Storage class may be throttled.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-statefulsets?var-namespace=prod&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_statefulset_status_replicas_ready%7Bnamespace%3D%22prod%22%7D"
}]'

pause
printf " [11/12] KubeServiceEndpointError (error, checkout-api, prod)..."
post '[{
  "labels": {
    "alertname": "KubeServiceEndpointError",
    "severity": "error",
    "namespace": "prod",
    "service": "checkout-api",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "runbook": "'"${RUNBOOKS}"'/KubeServiceEndpointError",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Service checkout-api has no healthy endpoints",
    "description": "All 3 endpoints for checkout-api are failing readiness checks. Last error: connection refused on port 8080. See incident runbook at https://runbooks.example.com/alerts/KubeServiceEndpointError and recent deploys at https://jira.example.com/browse/PLAT-5103.",
    "dashboard": "'"${GRAFANA}"'/d/k8s-services?var-namespace=prod&var-service=checkout-api&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_endpoint_address_available%7Bnamespace%3D%22prod%22%7D"
}]'

pause
printf " [12/12] KubeDNSErrors (error, kube-dns, prod)..."
post '[{
  "labels": {
    "alertname": "KubeDNSErrors",
    "severity": "error",
    "namespace": "kube-system",
    "pod": "coredns-5d78c9869d-7lqvk",
    "cluster": "eu-west-1-prod",
    "team": "infrastructure",
    "runbook": "'"${RUNBOOKS}"'/KubeDNSErrors",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "CoreDNS error rate above 5% for 10 minutes",
    "description": "SERVFAIL responses: 6.2% over last 10 minutes. Upstream resolver 8.8.8.8 may be unreachable. DNS troubleshooting guide: https://wiki.example.com/coredns-errors",
    "dashboard": "'"${GRAFANA}"'/d/coredns?orgId=1",
    "link": "https://jira.example.com/browse/INFRA-2047"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=rate(coredns_dns_responses_total%7Brcode%3D%22SERVFAIL%22%7D%5B5m%5D)"
}]'

pause
printf " [13/16] LinkRichAlert — many link labels + annotations..."
post '[{
  "labels": {
    "alertname": "LinkRichAlert",
    "severity": "warning",
    "namespace": "prod",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "runbook": "'"${RUNBOOKS}"'/LinkRichAlert",
    "wiki": "https://wiki.example.com/alerts/link-rich",
    "docs": "https://docs.example.com/platform/alerts/link-rich",
    "source_code": "https://github.com/example/platform/blob/main/alerts/link-rich.yml",
    "playbook": "https://playbooks.example.com/oncall/link-rich",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Alert with many link-type labels and annotations",
    "description": "This alert tests that all URL-valued labels and annotations are rendered as link buttons.",
    "dashboard": "'"${GRAFANA}"'/d/platform-overview?orgId=1",
    "link": "https://jira.example.com/browse/PLAT-9000",
    "logs": "'"${GRAFANA}"'/explore?orgId=1&left=%7B%22datasource%22%3A%22loki%22%7D",
    "tracing": "https://jaeger.example.com/search?service=payment-api&limit=20"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bjob%3D%22platform%22%7D"
}]'

pause
printf " [14/16] InlineUrlsAlert — multiple URLs embedded in description prose..."
post '[{
  "labels": {
    "alertname": "InlineUrlsAlert",
    "severity": "info",
    "namespace": "monitoring",
    "cluster": "eu-west-1-prod",
    "team": "observability",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Alert with inline URLs scattered across description text",
    "description": "Scrape target unreachable since 03:14 UTC. Check the target health at https://prometheus.lan.kj187.de/targets and compare against last known good state at https://grafana.lan.kj187.de/d/prometheus-targets?orgId=1. If the issue persists, follow the escalation guide at https://wiki.example.com/oncall/escalation and open a ticket at https://jira.example.com/projects/OBS.",
    "dashboard": "'"${GRAFANA}"'/d/prometheus-overview?orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bjob%3D%22prometheus%22%7D"
}]'

pause
printf " [15/16] LabelOnlyLinksAlert — all links in labels, no annotation links..."
post '[{
  "labels": {
    "alertname": "LabelOnlyLinksAlert",
    "severity": "info",
    "namespace": "staging",
    "cluster": "eu-west-1-staging",
    "team": "frontend",
    "runbook": "'"${RUNBOOKS}"'/LabelOnlyLinksAlert",
    "wiki": "https://wiki.example.com/alerts/label-only",
    "grafana": "'"${GRAFANA}"'/d/frontend-overview?orgId=1",
    "github_issue": "https://github.com/example/frontend/issues/42",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Alert with links exclusively in labels",
    "description": "Checks that URL-valued labels are picked up as link buttons even when no annotation carries a URL."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=http_requests_total%7Benv%3D%22staging%22%7D"
}]'

pause
printf " [16/16] AnnotationOnlyLinksAlert — all links in annotations, no label links..."
post '[{
  "labels": {
    "alertname": "AnnotationOnlyLinksAlert",
    "severity": "warning",
    "namespace": "prod",
    "cluster": "eu-west-1-prod",
    "team": "data",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Alert with links exclusively in annotations",
    "description": "S3 export job exceeded expected duration. Raw error: RequestTimeout after 300s. Check storage quota at https://aws.amazon.com/console and pipeline status at https://grafana.lan.kj187.de/d/data-pipelines?orgId=1 before re-triggering.",
    "dashboard": "'"${GRAFANA}"'/d/data-pipelines?var-namespace=prod&orgId=1",
    "runbook": "'"${RUNBOOKS}"'/AnnotationOnlyLinksAlert",
    "link": "https://jira.example.com/browse/DATA-2200",
    "docs": "https://docs.example.com/data/s3-export-troubleshooting"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=job_duration_seconds%7Bjob%3D%22s3-export%22%7D"
}]'

echo ""
echo "==> Done. 16 Kubernetes test alerts active (test_suite=jarvis)."
echo "    Alerts persist until you run 'make alerts-resolve' (endsAt: ${ENDS_AT})."
