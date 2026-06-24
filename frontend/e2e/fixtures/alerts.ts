import type { AlertInput } from '../support/alertmanager'

/**
 * Scenario fixtures — reusable sets of alerts for tests and screenshots.
 * Keep label/annotation shapes realistic (Kubernetes-themed) so screenshots
 * look production-like.
 */

const RUNBOOKS = 'https://runbooks.example.com/alerts'
const GRAFANA = 'https://grafana.example.com'
const PROM = 'https://prometheus.example.com'

/** A small, diverse set covering critical/warning/info severities. */
export const kubernetesAlerts: AlertInput[] = [
  {
    labels: {
      alertname: 'KubePodCrashLooping',
      severity: 'critical',
      namespace: 'prod',
      pod: 'payment-api-7d9f6b8c4-xk2lp',
      container: 'payment-api',
      cluster: 'e2e',
      team: 'platform',
      runbook: `${RUNBOOKS}/KubePodCrashLooping`,
    },
    annotations: {
      summary: 'Pod payment-api-7d9f6b8c4-xk2lp is crash looping',
      description:
        'Pod has restarted 14 times in the last 15 minutes. Exit code: 137 (OOMKilled).',
    },
  },
  {
    labels: {
      alertname: 'KubeNodeNotReady',
      severity: 'critical',
      node: 'worker-node-03',
      cluster: 'e2e',
      team: 'infrastructure',
      runbook: `${RUNBOOKS}/KubeNodeNotReady`,
    },
    annotations: {
      summary: 'Node worker-node-03 has been NotReady for >5 minutes',
      description: 'Node condition NotReady since 14:32 UTC. 12 pods evicted and rescheduled.',
    },
  },
  {
    labels: {
      alertname: 'KubeDeploymentReplicasMismatch',
      severity: 'warning',
      namespace: 'staging',
      deployment: 'checkout-service',
      cluster: 'e2e',
      team: 'checkout',
    },
    annotations: {
      summary: 'Deployment checkout-service has mismatched replicas',
      description: 'Desired 5, available 3 for more than 10 minutes.',
    },
  },
  {
    labels: {
      alertname: 'TargetDown',
      severity: 'info',
      namespace: 'monitoring',
      job: 'node-exporter',
      cluster: 'e2e',
      team: 'observability',
    },
    annotations: {
      summary: 'node-exporter target is down',
      description: '1 of 12 node-exporter targets has been unreachable for 5 minutes.',
    },
  },
]

/**
 * A larger, varied set (~14 alerts) so card/list screenshots look populated.
 * Spans multiple namespaces, teams, clusters and all severities.
 */
export const manyAlerts: AlertInput[] = [
  ...kubernetesAlerts,
  {
    labels: {
      alertname: 'KubeMemoryOvercommit',
      severity: 'warning',
      cluster: 'eu-west-1-prod',
      team: 'platform',
      runbook: `${RUNBOOKS}/KubeMemoryOvercommit`,
    },
    annotations: {
      summary: 'Cluster has overcommitted memory resource requests',
      description: 'Cannot tolerate node failure: memory requests exceed allocatable on 1 node down.',
      dashboard: `${GRAFANA}/d/k8s-resources`,
    },
  },
  {
    labels: {
      alertname: 'HighRequestLatency',
      severity: 'critical',
      namespace: 'prod',
      service: 'api-gateway',
      cluster: 'eu-west-1-prod',
      team: 'platform',
    },
    annotations: {
      summary: 'p99 latency on api-gateway is 2.4s',
      description: 'p99 request latency has exceeded the 1s SLO for 15 minutes.',
      generatorURL: `${PROM}/graph`,
    },
  },
  {
    labels: {
      alertname: 'PrometheusTargetMissing',
      severity: 'warning',
      namespace: 'monitoring',
      job: 'kube-state-metrics',
      cluster: 'e2e',
      team: 'observability',
    },
    annotations: {
      summary: 'kube-state-metrics target is missing',
      description: 'A Prometheus scrape target has disappeared for >10 minutes.',
    },
  },
  {
    labels: {
      alertname: 'CertManagerCertExpiry',
      severity: 'warning',
      namespace: 'cert-manager',
      cluster: 'e2e',
      team: 'security',
    },
    annotations: {
      summary: 'TLS certificate for api.example.com expires in 6 days',
      description: 'Renew the certificate before expiry to avoid an outage.',
    },
  },
  {
    labels: {
      alertname: 'PostgresReplicationLag',
      severity: 'critical',
      namespace: 'data',
      instance: 'postgres-primary-0',
      cluster: 'eu-west-1-prod',
      team: 'data',
    },
    annotations: {
      summary: 'Postgres replica lag is 142s',
      description: 'Streaming replication lag exceeds 60s threshold on postgres-replica-1.',
    },
  },
  {
    labels: {
      alertname: 'KafkaConsumerLag',
      severity: 'warning',
      namespace: 'streaming',
      topic: 'orders',
      cluster: 'eu-west-1-prod',
      team: 'checkout',
    },
    annotations: {
      summary: 'Consumer group order-processor lag is 48k messages',
      description: 'Lag on topic orders has grown steadily over the last 20 minutes.',
    },
  },
  {
    labels: {
      alertname: 'DiskWillFillIn4Hours',
      severity: 'critical',
      namespace: 'kube-system',
      instance: 'worker-node-07',
      cluster: 'us-east-1-prod',
      team: 'infrastructure',
    },
    annotations: {
      summary: 'Disk on worker-node-07 will fill in ~4 hours',
      description: 'Filesystem / on worker-node-07 is at 88% and rising.',
    },
  },
  {
    labels: {
      alertname: 'IngressHigh5xxRate',
      severity: 'critical',
      namespace: 'prod',
      ingress: 'storefront',
      cluster: 'us-east-1-prod',
      team: 'frontend',
    },
    annotations: {
      summary: 'storefront ingress is returning 7% 5xx',
      description: 'HTTP 5xx error rate on the storefront ingress exceeds 5% for 10 minutes.',
    },
  },
  {
    labels: {
      alertname: 'HPAMaxedOut',
      severity: 'warning',
      namespace: 'prod',
      hpa: 'recommendation-engine',
      cluster: 'us-east-1-prod',
      team: 'ml',
    },
    annotations: {
      summary: 'HPA recommendation-engine is at max replicas',
      description: 'Autoscaler has been pinned at 20/20 replicas for 30 minutes.',
    },
  },
  {
    labels: {
      alertname: 'BackupJobFailed',
      severity: 'info',
      namespace: 'data',
      job: 'nightly-backup',
      cluster: 'e2e',
      team: 'data',
    },
    annotations: {
      summary: 'Nightly backup job failed once',
      description: 'The nightly backup CronJob failed on its first attempt but will retry.',
    },
  },
]
