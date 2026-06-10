#!/usr/bin/env bash
# Resolves all Kubernetes-themed test alerts created by fire-test-alerts.sh.
# Posts each alert with endsAt in the past — Alertmanager marks them resolved immediately.

set -euo pipefail

AM="${ALERTMANAGER_URL:-https://alertmanager.lan.kj187.de}"
GRAFANA="https://grafana.lan.kj187.de"
PROM="https://prometheus.lan.kj187.de"
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

printf "  [1/10] KubePodCrashLooping..."
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

printf "  [2/10] KubeNodeNotReady..."
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

printf "  [3/10] KubeAPIServerErrorsHigh..."
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

printf "  [4/10] KubeJobFailed..."
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

printf "  [5/10] KubeDeploymentReplicasMismatch..."
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

printf "  [6/10] KubePersistentVolumeFillingUp..."
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

printf "  [7/10] KubeHpaMaxedOut..."
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

printf "  [8/10] KubePodOOMKilled..."
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

printf "  [9/10] KubeContainerWaiting..."
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

printf " [10/10] KubeStatefulSetReplicasMismatch..."
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

echo ""
echo "==> All 10 Kubernetes test alerts resolved."
