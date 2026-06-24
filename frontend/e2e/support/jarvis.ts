/**
 * Jarvis API client for e2e orchestration: trigger a poll, reset state, seed
 * resolved/history alerts, and create test fixtures (silences, comments, claims,
 * templates) via the e2e-only /api/v1/test/* endpoints.
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

export interface AMSilenceMatcher {
  name: string
  value: string
  isRegex: boolean
  isEqual: boolean
}

export interface SilenceTemplate {
  id: string
  name: string
  matchers: SilenceMatcher[]
  reason?: string
  createdAt: string
}

export interface SilenceMatcher {
  name: string
  value: string
  operator: '=' | '!=' | '=~' | '!~'
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

  /** Creates a silence in the specified cluster (e2e only). */
  async createSilence(cluster: string, matchers: AMSilenceMatcher[], opts: {
    startsAt?: Date
    endsAt?: Date
    createdBy?: string
    comment?: string
  } = {}): Promise<string> {
    const now = new Date()
    const res = await fetch(`${this.baseURL}/api/v1/test/silence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cluster,
        matchers,
        startsAt: opts.startsAt ?? now,
        endsAt: opts.endsAt ?? new Date(now.getTime() + 1 * 60 * 60 * 1000), // +1h default
        createdBy: opts.createdBy ?? 'e2e-test',
        comment: opts.comment ?? 'Test silence',
      }),
    })
    if (!res.ok) throw new Error(`createSilence failed: ${res.status} ${await res.text()}`)
    const data = await res.json()
    return data.silenceID
  }

  /** Adds a comment to an alert (e2e only). */
  async addComment(fingerprint: string, body: string, authorName?: string): Promise<void> {
    const res = await fetch(`${this.baseURL}/api/v1/test/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fingerprint,
        body,
        authorName: authorName ?? 'e2e-tester',
      }),
    })
    if (!res.ok) throw new Error(`addComment failed: ${res.status} ${await res.text()}`)
  }

  /** Sets a claim on an alert (e2e only). */
  async setClaim(fingerprint: string, claimedBy?: string, note?: string): Promise<void> {
    const res = await fetch(`${this.baseURL}/api/v1/test/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fingerprint,
        claimedBy: claimedBy ?? 'e2e-tester',
        note: note ?? '',
      }),
    })
    if (!res.ok) throw new Error(`setClaim failed: ${res.status} ${await res.text()}`)
  }

  /** Creates a silence template (e2e only). */
  async createTemplate(name: string, matchers: SilenceMatcher[], reason?: string): Promise<SilenceTemplate> {
    const res = await fetch(`${this.baseURL}/api/v1/test/template`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, matchers, reason: reason ?? '' }),
    })
    if (!res.ok) throw new Error(`createTemplate failed: ${res.status} ${await res.text()}`)
    return res.json()
  }
}
