#!/usr/bin/env bash
# Resolves all Kubernetes-themed test alerts created by fire-test-alerts.sh.
# Posts each alert with endsAt in the past — Alertmanager marks them resolved immediately.
#
# Takes the same --profile flag as fire-test-alerts.sh, so a demo run is torn down
# with exactly the alerts it created:
#   demo (18 alerts)  the realistic Kubernetes incidents
#   full (27 alerts)  demo set plus the edge cases. Default.
#
# Resolving is not removing: Alertmanager drops the alerts from its active list,
# but Jarvis keeps the lifecycle events it already recorded. See docs/demo.md.

set -euo pipefail

usage() {
  echo "usage: $0 [--profile demo|full]"
}

PROFILE="${FIXTURE_PROFILE:-full}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done
case "$PROFILE" in
  demo) TOTAL=18 ;;
  full) TOTAL=27 ;;
  *) echo "ERROR: unknown profile: $PROFILE" >&2; usage >&2; exit 2 ;;
esac

AM="${ALERTMANAGER_URL:-http://localhost:9094}"
GRAFANA="https://grafana.example.com"
PROM="https://prometheus.example.com"
RUNBOOKS="https://runbooks.example.com/alerts"

ENDS_AT="$(date -u -d '1 minute ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null \
  || date -u -v-1M '+%Y-%m-%dT%H:%M:%SZ')"

STEP=0
step() {
  STEP=$(( STEP + 1 ))
  printf "  [%2d/%2d] %s..." "$STEP" "$TOTAL" "$1"
}

resolve() {
  local payload="$1"
  local with_ends
  with_ends="$(echo "$payload" | sed 's/}]$/,"endsAt":"'"${ENDS_AT}"'"}]/')"
  curl -sf -L -X POST "${AM}/api/v2/alerts" \
    -H "Content-Type: application/json" \
    -d "$with_ends"
  echo " resolved"
}

echo "==> Resolving ${TOTAL} Kubernetes test alerts (profile: ${PROFILE}, test_suite=jarvis) via ${AM}"
echo "    endsAt: ${ENDS_AT}"
echo ""

step "KubePodCrashLooping"
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

step "KubePodCrashLooping (2nd pod)"
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

step "KubePodCrashLooping (3rd pod)"
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

step "KubeNodeNotReady"
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

step "KubeAPIServerErrorsHigh"
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

step "KubeJobFailed"
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

step "KubeDeploymentReplicasMismatch"
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

step "KubePersistentVolumeFillingUp"
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

step "KubeHpaMaxedOut"
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

step "KubePodOOMKilled"
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

step "KubePodOOMKilled (2nd pod)"
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

step "KubePodOOMKilled (3rd pod)"
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

step "KubeContainerWaiting"
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

step "KubeContainerWaiting (2nd pod)"
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

step "KubeContainerWaiting (3rd pod)"
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

step "KubeStatefulSetReplicasMismatch"
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

step "KubeServiceEndpointError"
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

step "KubeDNSErrors"
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

# Mirrors the profile split in fire-test-alerts.sh — the demo set ends here.
if [[ "$PROFILE" == "demo" ]]; then
  echo ""
  echo "==> All 18 demo alerts resolved in Alertmanager."
  echo "    Jarvis keeps their history: the alerts move to the Resolved view and stay"
  echo "    in the database. Only deleting the database removes them."
  exit 0
fi

step "LinkRichAlert"
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

step "InlineUrlsAlert"
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

step "LabelOnlyLinksAlert"
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

step "AnnotationOnlyLinksAlert"
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

step "SpecialCharLabelAlert"
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

step "KubePodExcessiveLabelsAlert"
resolve '[{
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
  "annotations": {"summary": "Pod recommendation-engine-8f6d7c9b5-4tzxq carries an unusually large label set"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=up%7Bnamespace%3D%22prod%22%2Cpod%3D%22recommendation-engine%22%7D"
}]'

step "CIPipelineBuildMetadataAlert"
resolve '[{
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
  "annotations": {"summary": "Deploy stage failed for recommendation-engine build #1847"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=ci_pipeline_status%7Bpipeline%3D%22recommendation-engine-deploy%22%7D"
}]'

step "CloudResourceTaggingAlert"
resolve '[{
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
  "annotations": {"summary": "RDS instance prod-orders-db-primary approaching storage threshold"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=aws_rds_free_storage_space_average%7Bresource_id%3D%22prod-orders-db-primary%22%7D"
}]'

step "FeatureFlagRolloutAlert"
resolve '[{
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
  "annotations": {"summary": "Elevated checkout error rate during canary rollout of new-checkout-flow"},
  "generatorURL": "'"${PROM}"'/graph?g0.expr=rate(checkout_errors_total%7Bexperiment_id%3D%22exp_2026_checkout_redesign%22%7D%5B5m%5D)"
}]'

echo ""
echo "==> All 27 Kubernetes test alerts resolved in Alertmanager."
echo "    Jarvis keeps their history: the alerts move to the Resolved view and stay"
echo "    in the database. Only deleting the database removes them."
