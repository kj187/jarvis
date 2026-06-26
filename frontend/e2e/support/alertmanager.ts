/**
 * Alertmanager API v2 client — fires and clears real alerts in the e2e
 * Alertmanager so Jarvis polls them like production traffic.
 */

export interface AlertInput {
  labels: Record<string, string>
  annotations?: Record<string, string>
  generatorURL?: string
  /** ISO timestamp; defaults to now. */
  startsAt?: string
  /** ISO timestamp; defaults to far future so the alert stays firing. */
  endsAt?: string
}

const FAR_FUTURE = '2099-12-31T23:59:59.000Z'

export class AlertmanagerClient {
  constructor(private readonly baseURL: string) {}

  /** Posts alerts to Alertmanager. All gain test_suite=jarvis for easy cleanup. */
  async fire(alerts: AlertInput[]): Promise<void> {
    const now = new Date().toISOString()
    const payload = alerts.map((a) => ({
      labels: { test_suite: 'jarvis', ...a.labels },
      annotations: a.annotations ?? {},
      ...(a.generatorURL ? { generatorURL: a.generatorURL } : {}),
      startsAt: a.startsAt ?? now,
      endsAt: a.endsAt ?? FAR_FUTURE,
    }))

    const res = await fetch(`${this.baseURL}/api/v2/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new Error(`AM fire failed: ${res.status} ${await res.text()}`)
    }
  }

  /** Expires all currently active alerts by re-posting them with endsAt=now. */
  async clearAll(): Promise<void> {
    await Promise.all([this.clearAlerts(), this.clearSilences()])
  }

  private async clearAlerts(): Promise<void> {
    const res = await fetch(
      `${this.baseURL}/api/v2/alerts?active=true&silenced=true&inhibited=true`,
    )
    if (!res.ok) return
    const active = (await res.json()) as Array<{
      labels: Record<string, string>
      annotations?: Record<string, string>
    }>
    if (active.length === 0) return
    const now = new Date().toISOString()
    const expired = active.map((a) => ({
      labels: a.labels,
      annotations: a.annotations ?? {},
      startsAt: now,
      endsAt: now,
    }))
    await fetch(`${this.baseURL}/api/v2/alerts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expired),
    })
  }

  /** Expires (deletes) all non-expired silences in Alertmanager. */
  async clearSilences(): Promise<void> {
    const res = await fetch(`${this.baseURL}/api/v2/silences`)
    if (!res.ok) return
    const silences = (await res.json()) as Array<{ id: string; status?: { state?: string } }>
    await Promise.all(
      silences
        .filter((s) => s.status?.state !== 'expired')
        .map((s) => fetch(`${this.baseURL}/api/v2/silence/${s.id}`, { method: 'DELETE' })),
    )
  }
}
