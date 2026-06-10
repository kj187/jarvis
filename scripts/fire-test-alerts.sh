#!/usr/bin/env bash
# Fires a diverse set of Kubernetes-themed Jarvis test alerts against Alertmanager.
# All alerts share label test_suite=jarvis — run resolve-test-alerts.sh to clean up.

set -euo pipefail

AM="${ALERTMANAGER_URL:-https://alertmanager.lan.kj187.de}"
GRAFANA="https://grafana.lan.kj187.de"
PROM="https://prometheus.lan.kj187.de"
RUNBOOKS="https://runbooks.example.com/alerts"

post() {
  curl -sf -L -X POST "${AM}/api/v2/alerts" \
    -H "Content-Type: application/json" \
    -d "$1"
  echo " OK"
}

pause() {
  local s=$(( RANDOM % 8 + 1 ))
  printf "      sleeping ${s}s...\n"
  sleep "$s"
}

echo "==> Firing Kubernetes test alerts to ${AM} (randomized, ~1 min)"

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
    "description": "Pod has restarted 14 times in the last 15 minutes. Exit code: 137 (OOMKilled)."
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
    "description": "Job failed after 3/3 retries. Last successful run: 2 days ago. S3 export incomplete."
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
    "description": "Memory limit: 4Gi, actual peak RSS: 4.8Gi. Increase memory limit or reduce batch size."
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

echo ""
echo "==> Done. 10 Kubernetes test alerts active (test_suite=jarvis)."
echo "    Alertmanager auto-expires them after ~5 minutes without refresh."
echo "    Run 'make alerts-resolve' to resolve immediately."
