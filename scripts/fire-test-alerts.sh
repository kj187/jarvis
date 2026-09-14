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

printf "  [1/27] KubePodCrashLooping (critical, payment-api, prod)..."
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
printf "  [2/27] KubePodCrashLooping (critical, payment-api, prod) — 2nd pod (groups with #1)..."
post '[{
  "labels": {
    "alertname": "KubePodCrashLooping",
    "severity": "critical",
    "namespace": "prod",
    "pod": "payment-api-7d9f6b8c4-9m3qz",
    "container": "payment-api",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "runbook": "'"${RUNBOOKS}"'/KubePodCrashLooping",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Pod payment-api-7d9f6b8c4-9m3qz is crash looping",
    "description": "Pod has restarted 9 times in the last 15 minutes. Exit code: 137 (OOMKilled).",
    "dashboard": "'"${GRAFANA}"'/d/k8s-pods?var-namespace=prod&var-pod=payment-api-7d9f6b8c4-9m3qz&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_restarts_total%7Bnamespace%3D%22prod%22%7D"
}]'

pause
printf "  [3/27] KubePodCrashLooping (critical, payment-api, prod) — 3rd pod (groups with #1)..."
post '[{
  "labels": {
    "alertname": "KubePodCrashLooping",
    "severity": "critical",
    "namespace": "prod",
    "pod": "payment-api-7d9f6b8c4-p7wln",
    "container": "payment-api",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "runbook": "'"${RUNBOOKS}"'/KubePodCrashLooping",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Pod payment-api-7d9f6b8c4-p7wln is crash looping",
    "description": "Pod has restarted 22 times in the last 15 minutes. Exit code: 137 (OOMKilled).",
    "dashboard": "'"${GRAFANA}"'/d/k8s-pods?var-namespace=prod&var-pod=payment-api-7d9f6b8c4-p7wln&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_restarts_total%7Bnamespace%3D%22prod%22%7D"
}]'

pause
printf "  [4/27] KubeNodeNotReady (critical, worker-node-3, prod)..."
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
printf "  [5/27] KubeAPIServerErrorsHigh (critical, kube-system, prod)..."
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
printf "  [6/27] KubeJobFailed (critical, data-pipeline, prod)..."
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
printf "  [7/27] KubeDeploymentReplicasMismatch (warning, frontend, staging)..."
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
printf "  [8/27] KubePersistentVolumeFillingUp (warning, prometheus, prod)..."
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
printf "  [9/27] KubeHpaMaxedOut (warning, auth-service, prod)..."
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
printf " [10/27] KubePodOOMKilled (warning, ml-inference, prod)..."
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
printf " [11/27] KubePodOOMKilled (warning, ml-inference, prod) — 2nd pod (groups with #10)..."
post '[{
  "labels": {
    "alertname": "KubePodOOMKilled",
    "severity": "warning",
    "namespace": "prod",
    "pod": "ml-inference-6c8d9f7b5-h4dtx",
    "container": "inference-server",
    "cluster": "eu-west-1-prod",
    "team": "ml",
    "runbook": "'"${RUNBOOKS}"'/KubePodOOMKilled",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Container inference-server OOMKilled 2 times in 1h",
    "description": "Memory limit: 4Gi, actual peak RSS: 4.6Gi. Increase memory limit or reduce batch size."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_last_terminated_reason%7Breason%3D%22OOMKilled%22%7D"
}]'

pause
printf " [12/27] KubePodOOMKilled (warning, ml-inference, prod) — 3rd pod (groups with #10)..."
post '[{
  "labels": {
    "alertname": "KubePodOOMKilled",
    "severity": "warning",
    "namespace": "prod",
    "pod": "ml-inference-6c8d9f7b5-vw8kc",
    "container": "inference-server",
    "cluster": "eu-west-1-prod",
    "team": "ml",
    "runbook": "'"${RUNBOOKS}"'/KubePodOOMKilled",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Container inference-server OOMKilled 5 times in 1h",
    "description": "Memory limit: 4Gi, actual peak RSS: 5.1Gi. Increase memory limit or reduce batch size."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_last_terminated_reason%7Breason%3D%22OOMKilled%22%7D"
}]'

pause
printf " [13/27] KubeContainerWaiting (info, batch-worker, prod)..."
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
printf " [14/27] KubeContainerWaiting (info, batch-worker, prod) — 2nd pod (groups with #13)..."
post '[{
  "labels": {
    "alertname": "KubeContainerWaiting",
    "severity": "info",
    "namespace": "prod",
    "pod": "batch-worker-5f7b9c2d8-x9zzt",
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
printf " [15/27] KubeContainerWaiting (info, batch-worker, prod) — 3rd pod (groups with #13)..."
post '[{
  "labels": {
    "alertname": "KubeContainerWaiting",
    "severity": "info",
    "namespace": "prod",
    "pod": "batch-worker-5f7b9c2d8-p3kjm",
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
printf " [16/27] KubeStatefulSetReplicasMismatch (info, kafka, prod)..."
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
printf " [17/27] KubeServiceEndpointError (error, checkout-api, prod)..."
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
printf " [18/27] KubeDNSErrors (error, kube-dns, prod)..."
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
printf " [19/27] LinkRichAlert — many link labels + annotations..."
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
printf " [20/27] InlineUrlsAlert — multiple URLs embedded in description prose..."
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
printf " [21/27] LabelOnlyLinksAlert — all links in labels, no annotation links..."
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
printf " [22/27] AnnotationOnlyLinksAlert — all links in annotations, no label links..."
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

pause
printf " [23/27] SpecialCharLabelAlert — label value with dots + label value with hyphens..."
post '[{
  "labels": {
    "alertname": "SpecialCharLabelAlert",
    "severity": "warning",
    "namespace": "prod",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "kubernetes_version": "v1.28.4",
    "image_tag": "payment-api-v2-3-1-rc",
    "secret_path": "v1/b2b/cert/web-tuadev",
    "runbook": "'"${RUNBOOKS}"'/SpecialCharLabelAlert",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Alert with special characters in label values",
    "description": "Tests label rendering and silence-recreate filtering for values containing dots (kubernetes_version=v1.28.4), hyphens (image_tag=payment-api-v2-3-1-rc) and slashes+hyphens in a path (secret_path=v1/b2b/cert/web-tuadev). To reproduce the recreate bug: silence this alert with a regex (=~) matcher on secret_path, then recreate the silence and confirm the chip stays v1/b2b/cert/web-tuadev (no backslashes) and still matches 1 alert.",
    "dashboard": "'"${GRAFANA}"'/d/platform-overview?orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bjob%3D%22platform%22%7D"
}]'

pause
printf " [24/27] KubePodExcessiveLabelsAlert — pod carrying the full label surface (k8s/helm/argocd/istio/cost tags)..."
post '[{
  "labels": {
    "alertname": "KubePodExcessiveLabelsAlert",
    "severity": "warning",
    "namespace": "prod",
    "pod": "recommendation-engine-8f6d7c9b5-4tzxq",
    "container": "recommendation-engine",
    "cluster": "eu-west-1-prod",
    "team": "ml-platform",
    "app_name": "recommendation-engine",
    "app_instance": "recommendation-engine-prod",
    "app_version": "4.12.3",
    "app_component": "backend",
    "app_part_of": "recommendation-platform",
    "app_managed_by": "argocd",
    "helm_chart": "recommendation-engine-2.7.1",
    "helm_release": "recommendation-engine-prod",
    "argocd_application": "recommendation-engine-prod",
    "argocd_project": "ml-platform",
    "istio_revision": "default",
    "istio_canonical_name": "recommendation-engine",
    "istio_canonical_revision": "v4",
    "istio_tls_mode": "istio",
    "pod_template_hash": "8f6d7c9b5",
    "topology_region": "eu-west-1",
    "topology_zone": "eu-west-1a",
    "node_instance_type": "m6i_2xlarge",
    "node_lifecycle": "on_demand",
    "cost_center": "CC-4471",
    "business_unit": "personalization",
    "owner_team": "ml-platform",
    "environment": "production",
    "data_classification": "internal",
    "runbook": "'"${RUNBOOKS}"'/KubePodExcessiveLabelsAlert",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Pod recommendation-engine-8f6d7c9b5-4tzxq carries an unusually large label set",
    "description": "Tests label-heavy rendering: filter bar cardinality, label chip wrapping/overflow, and silence-matcher UX against 30+ labels on a single alert."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bnamespace%3D%22prod%22%2Cpod%3D%22recommendation-engine%22%7D"
}]'

pause
printf " [25/27] CIPipelineBuildMetadataAlert — CI/CD build/git/docker metadata heavy..."
post '[{
  "labels": {
    "alertname": "CIPipelineBuildMetadataAlert",
    "severity": "info",
    "namespace": "ci",
    "cluster": "eu-west-1-prod",
    "team": "platform",
    "pipeline_name": "recommendation-engine-deploy",
    "pipeline_id": "48213",
    "pipeline_stage": "deploy_prod",
    "pipeline_status": "failed",
    "git_repo": "github_com_acme_recommendation_engine",
    "git_branch": "release_4_12",
    "git_commit_sha": "a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3",
    "git_commit_short": "a1b2c3d",
    "git_author": "jkleinhans",
    "git_pr_number": "482",
    "build_number": "1847",
    "build_agent": "ci_runner_07",
    "build_duration_seconds": "312",
    "build_triggered_by": "push",
    "docker_image": "ghcr_io_acme_recommendation_engine",
    "docker_tag": "v4_12_3_rc2",
    "docker_digest_short": "sha256_9f8e7d",
    "test_coverage_percent": "87",
    "artifact_registry": "ghcr_io",
    "deploy_target": "eks_prod_eu_west_1",
    "deploy_strategy": "rolling",
    "approval_required": "true",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Deploy stage failed for recommendation-engine build #1847",
    "description": "Tests label-heavy rendering with CI/CD-flavored keys (git, docker, pipeline metadata) rather than Kubernetes object labels."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=ci_pipeline_status%7Bpipeline%3D%22recommendation-engine-deploy%22%7D"
}]'

pause
printf " [26/27] CloudResourceTaggingAlert — AWS/Terraform cost-allocation tags heavy..."
post '[{
  "labels": {
    "alertname": "CloudResourceTaggingAlert",
    "severity": "warning",
    "namespace": "prod",
    "cluster": "eu-west-1-prod",
    "team": "infrastructure",
    "resource_type": "rds_instance",
    "resource_id": "prod-orders-db-primary",
    "resource_arn": "arn_aws_rds_eu_west_1_123456789012_db_prod_orders_db_primary",
    "aws_account_id": "123456789012",
    "aws_region": "eu-west-1",
    "aws_availability_zone": "eu-west-1b",
    "cost_center": "CC-1029",
    "budget_code": "BUD-2026-Q3-INFRA",
    "owner": "data-platform-team",
    "project": "orders-service",
    "application": "orders-api",
    "environment": "production",
    "tier": "critical",
    "compliance_scope": "pci_dss",
    "data_classification": "confidential",
    "backup_policy": "daily_30d_retention",
    "provisioned_by": "terraform",
    "terraform_workspace": "prod-eu-west-1",
    "terraform_module": "rds-postgres-ha",
    "terraform_version": "1_9_2",
    "managed_by": "platform-engineering",
    "lifecycle_stage": "steady_state",
    "disaster_recovery_tier": "tier1",
    "runbook": "'"${RUNBOOKS}"'/CloudResourceTaggingAlert",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "RDS instance prod-orders-db-primary approaching storage threshold",
    "description": "Tests label-heavy rendering with cloud cost-allocation/compliance tag keys instead of Kubernetes labels."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=aws_rds_free_storage_space_average%7Bresource_id%3D%22prod-orders-db-primary%22%7D"
}]'

pause
printf " [27/27] FeatureFlagRolloutAlert — many per-flag/experiment labels..."
post '[{
  "labels": {
    "alertname": "FeatureFlagRolloutAlert",
    "severity": "info",
    "namespace": "prod",
    "cluster": "eu-west-1-prod",
    "team": "growth",
    "service": "checkout-api",
    "flag_new_checkout_flow": "enabled",
    "flag_express_pay": "rollout_25pct",
    "flag_saved_cards_v2": "enabled",
    "flag_dynamic_pricing": "disabled",
    "flag_loyalty_points_v3": "rollout_10pct",
    "flag_one_click_upsell": "enabled",
    "flag_ab_test_banner_color": "variant_b",
    "flag_guest_checkout_v2": "enabled",
    "flag_apple_pay_eu": "enabled",
    "flag_klarna_integration": "rollout_50pct",
    "flag_fraud_check_v4": "enabled",
    "experiment_id": "exp_2026_checkout_redesign",
    "experiment_variant": "treatment",
    "experiment_cohort": "eu_mobile_users",
    "rollout_percentage": "25",
    "rollout_phase": "canary",
    "feature_owner": "growth-team",
    "test_suite": "jarvis"
  },
  "annotations": {
    "summary": "Elevated checkout error rate during canary rollout of new-checkout-flow",
    "description": "Tests label-heavy rendering where most labels are feature-flag/experiment state rather than infra identifiers."
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=rate(checkout_errors_total%7Bexperiment_id%3D%22exp_2026_checkout_redesign%22%7D%5B5m%5D)"
}]'

echo ""
echo "==> Done. 27 Kubernetes test alerts active (test_suite=jarvis)."
echo "    KubePodCrashLooping, KubePodOOMKilled and KubeContainerWaiting each fired as"
echo "    3 alerts (same alertname/cluster/namespace, different pod) — Alertmanager"
echo "    groups them (group_by: alertname, cluster, namespace) into 3-alert groups."
echo "    #24-27 (KubePodExcessiveLabelsAlert, CIPipelineBuildMetadataAlert,"
echo "    CloudResourceTaggingAlert, FeatureFlagRolloutAlert) each carry 25-30 labels"
echo "    to exercise label-heavy rendering (filter bar, chip wrapping, silence matchers)."
echo "    Alerts persist until you run 'make alerts-resolve' (endsAt: ${ENDS_AT})."
