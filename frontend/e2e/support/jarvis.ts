/**
 * Jarvis API client for e2e orchestration: trigger a poll, reset state, and
 * seed resolved/history alerts via the e2e-only /api/v1/test/* endpoints.
 */

export interface SeedResolvedAlert {
  fingerprint: string
  alertname: string
  cluster: string
  alertmanagerUrl?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  /** ISO timestamp. */
  startsAt?: string
  /** ISO timestamp. */
  resolvedAt?: string
}

export class JarvisClient {
  constructor(private readonly baseURL: string) {}

  /** Forces an immediate poll of all Alertmanager clusters. */
  async poll(): Promise<void> {
    const res = await fetch(`${this.baseURL}/api/v1/poll`, { method: 'POST' })
    if (!res.ok) throw new Error(`poll failed: ${res.status} ${await res.text()}`)
  }

  /** Truncates all history tables and clears the in-memory store (e2e only). */
  async reset(): Promise<void> {
    const res = await fetch(`${this.baseURL}/api/v1/test/reset`, { method: 'POST' })
    if (!res.ok) throw new Error(`reset failed: ${res.status} ${await res.text()}`)
  }

  /** Seeds resolved-alert lifecycles directly into the DB (e2e only). */
  async seedResolved(resolved: SeedResolvedAlert[]): Promise<void> {
    const res = await fetch(`${this.baseURL}/api/v1/test/seed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved }),
    })
    if (!res.ok) throw new Error(`seed failed: ${res.status} ${await res.text()}`)
  }
}
