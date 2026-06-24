import type { AMSilenceMatcher, SilenceMatcher } from '../support/jarvis'

/**
 * Silence fixtures for testing silence creation, grouping, templates.
 */

/** Silence matcher for alertname == "KubePodCrashLooping" */
export const matchPodCrashLooping: AMSilenceMatcher = {
  name: 'alertname',
  value: 'KubePodCrashLooping',
  isRegex: false,
  isEqual: true,
}

/** Silence matcher for severity == "critical" */
export const matchCritical: AMSilenceMatcher = {
  name: 'severity',
  value: 'critical',
  isRegex: false,
  isEqual: true,
}

/** Silence matcher for namespace =~ "prod|staging" (regex) */
export const matchProdStaging: AMSilenceMatcher = {
  name: 'namespace',
  value: 'prod|staging',
  isRegex: true,
  isEqual: true,
}

/** Silence matcher for pod label != present (negation) */
export const matchNoPod: AMSilenceMatcher = {
  name: 'pod',
  value: '',
  isRegex: false,
  isEqual: false, // !=
}

/** Template matcher for DB alerts */
export const dbAlertMatchers: SilenceMatcher[] = [
  {
    name: 'alertname',
    value: 'Postgres.*',
    operator: '=~',
  },
]

/** Template matcher for anything related to kube-system namespace */
export const kubeSystemMatchers: SilenceMatcher[] = [
  {
    name: 'namespace',
    value: 'kube-system',
    operator: '=',
  },
]
