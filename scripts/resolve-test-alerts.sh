#!/usr/bin/env bash
# Resolves all Kubernetes-themed test alerts created by fire-test-alerts.sh.
# Posts each alert with endsAt in the past — Alertmanager marks them resolved immediately.

set -euo pipefail

AM="${ALERTMANAGER_URL:-http://localhost:9094}"
GRAFANA="https://grafana.example.com"
PROM="https://prometheus.example.com"
RUNBOOKS="https://runbooks.example.com/alerts"

ENDS_AT="$(date -u -d '1 minute ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
  || date -u -v-1M '+%Y-%m-%dT%H:%M:%SZ')"

resolve() {
  local payload="$1"
  local with_ends
  with_ends="$(echo "$payload" | sed 's/}]$/,"endsAt":"'"${ENDS_AT}"'"}]/')"
  curl -sf -L -X POST "${AM}/api/v2/alerts" \
    -H "Content-Type: application/json" \
    -d "$with_ends"
  echo " resolved"
}

echo "==> Resolving Kubernetes test alerts (test_suite=jarvis) via ${AM}"
echo "    endsAt: ${ENDS_AT}"
echo ""

printf "  [1/23] KubePodCrashLooping..."
resolve '[{
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
  "annotations": {"summary": "Pod payment-api-7d9f6b8c4-xk2lp is crash looping"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_restarts_total"
}]'

printf "  [2/23] KubePodCrashLooping (2nd pod)..."
resolve '[{
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
  "annotations": {"summary": "Pod payment-api-7d9f6b8c4-9m3qz is crash looping"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_restarts_total"
}]'

printf "  [3/23] KubePodCrashLooping (3rd pod)..."
resolve '[{
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
  "annotations": {"summary": "Pod payment-api-7d9f6b8c4-p7wln is crash looping"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_restarts_total"
}]'

printf "  [4/23] KubeNodeNotReady..."
resolve '[{
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
    "dashboard": "'"${GRAFANA}"'/d/k8s-nodes?var-node=worker-node-03&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_node_status_condition"
}]'

printf "  [5/23] KubeAPIServerErrorsHigh..."
resolve '[{
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
    "dashboard": "'"${GRAFANA}"'/d/kube-apiserver?orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=rate(apiserver_request_total%7Bcode%3D~%225..%22%7D%5B5m%5D)"
}]'

printf "  [6/23] KubeJobFailed..."
resolve '[{
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
  "annotations": {"summary": "CronJob nightly-data-pipeline failed"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_job_status_failed"
}]'

printf "  [7/23] KubeDeploymentReplicasMismatch..."
resolve '[{
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
    "dashboard": "'"${GRAFANA}"'/d/k8s-deployments?var-namespace=staging&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_deployment_status_replicas_available"
}]'

printf "  [8/23] KubePersistentVolumeFillingUp..."
resolve '[{
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
    "dashboard": "'"${GRAFANA}"'/d/k8s-pvc?var-namespace=monitoring&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kubelet_volume_stats_used_bytes"
}]'

printf "  [9/23] KubeHpaMaxedOut..."
resolve '[{
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
    "dashboard": "'"${GRAFANA}"'/d/k8s-hpa?var-namespace=prod&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_horizontalpodautoscaler_status_current_replicas"
}]'

printf " [10/23] KubePodOOMKilled..."
resolve '[{
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
  "annotations": {"summary": "Container inference-server OOMKilled 3 times in 1h"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_last_terminated_reason"
}]'

printf " [11/23] KubePodOOMKilled (2nd pod)..."
resolve '[{
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
  "annotations": {"summary": "Container inference-server OOMKilled 2 times in 1h"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_last_terminated_reason"
}]'

printf " [12/23] KubePodOOMKilled (3rd pod)..."
resolve '[{
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
  "annotations": {"summary": "Container inference-server OOMKilled 5 times in 1h"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_last_terminated_reason"
}]'

printf " [13/23] KubeContainerWaiting..."
resolve '[{
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
  "annotations": {"summary": "Container batch-worker stuck in ImagePullBackOff"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_waiting_reason"
}]'

printf " [14/23] KubeContainerWaiting (2nd pod)..."
resolve '[{
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
  "annotations": {"summary": "Container batch-worker stuck in ImagePullBackOff"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_waiting_reason"
}]'

printf " [15/23] KubeContainerWaiting (3rd pod)..."
resolve '[{
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
  "annotations": {"summary": "Container batch-worker stuck in ImagePullBackOff"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_pod_container_status_waiting_reason"
}]'

printf " [16/23] KubeStatefulSetReplicasMismatch..."
resolve '[{
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
    "dashboard": "'"${GRAFANA}"'/d/k8s-statefulsets?var-namespace=prod&orgId=1"
  },
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_statefulset_status_replicas_ready"
}]'

printf " [17/23] KubeServiceEndpointError..."
resolve '[{
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
  "annotations": {"summary": "Service checkout-api has no healthy endpoints"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=kube_endpoint_address_available"
}]'

printf " [18/23] KubeDNSErrors..."
resolve '[{
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
  "annotations": {"summary": "CoreDNS error rate above 5% for 10 minutes"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=rate(coredns_dns_responses_total%7Brcode%3D%22SERVFAIL%22%7D%5B5m%5D)"
}]'

printf " [19/23] LinkRichAlert..."
resolve '[{
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
  "annotations": {"summary": "Alert with many link-type labels and annotations"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bjob%3D%22platform%22%7D"
}]'

printf " [20/23] InlineUrlsAlert..."
resolve '[{
  "labels": {
    "alertname": "InlineUrlsAlert",
    "severity": "info",
    "namespace": "monitoring",
    "cluster": "eu-west-1-prod",
    "team": "observability",
    "test_suite": "jarvis"
  },
  "annotations": {"summary": "Alert with inline URLs scattered across description text"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bjob%3D%22prometheus%22%7D"
}]'

printf " [21/23] LabelOnlyLinksAlert..."
resolve '[{
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
  "annotations": {"summary": "Alert with links exclusively in labels"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=http_requests_total%7Benv%3D%22staging%22%7D"
}]'

printf " [22/23] AnnotationOnlyLinksAlert..."
resolve '[{
  "labels": {
    "alertname": "AnnotationOnlyLinksAlert",
    "severity": "warning",
    "namespace": "prod",
    "cluster": "eu-west-1-prod",
    "team": "data",
    "test_suite": "jarvis"
  },
  "annotations": {"summary": "Alert with links exclusively in annotations"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=job_duration_seconds%7Bjob%3D%22s3-export%22%7D"
}]'

printf " [23/23] SpecialCharLabelAlert..."
resolve '[{
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
  "annotations": {"summary": "Alert with special characters in label values"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bjob%3D%22platform%22%7D"
}]'

echo ""
echo "==> All 23 Kubernetes test alerts resolved."
