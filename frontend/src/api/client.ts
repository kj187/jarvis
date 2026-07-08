import type {
  EnrichedAlert,
  AlertGroup,
  AlertEvent,
  AlertTimelineEntry,
  AlertStats,
  AlertHeatmapResponse,
  HeatmapRange,
  Comment,
  Claim,
  Silence,
  SilenceTemplate,
  SilenceEvent,
  ClusterInfo,
  AuthUser,
  ProviderInfo,
  AdminUser,
} from '@/types'

const BASE = '/api/v1'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export function fetchAlerts(params?: {
  cluster?: string
  severity?: string
  state?: string
}): Promise<EnrichedAlert[]> {
  const q = new URLSearchParams()
  if (params?.cluster) q.set('cluster', params.cluster)
  if (params?.severity) q.set('severity', params.severity)
  if (params?.state) q.set('state', params.state)
  const qs = q.toString()
  return request<EnrichedAlert[]>(`/alerts${qs ? `?${qs}` : ''}`)
}

export function fetchAlertGroups(): Promise<AlertGroup[]> {
  return request<AlertGroup[]>('/alerts/groups')
}

export function fetchAlertHistory(
  fingerprint: string,
  params?: { cluster?: string; limit?: number; offset?: number },
): Promise<{ events: AlertEvent[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.cluster) q.set('cluster', params.cluster)
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.offset) q.set('offset', String(params.offset))
  const qs = q.toString()
  return request(`/alerts/${fingerprint}/history${qs ? `?${qs}` : ''}`)
}

export function fetchAlertTimeline(
  fingerprint: string,
  params?: { cluster?: string; limit?: number; offset?: number },
): Promise<{ entries: AlertTimelineEntry[]; total: number }> {
  const q = new URLSearchParams()
  if (params?.cluster) q.set('cluster', params.cluster)
  if (params?.limit) q.set('limit', String(params.limit))
  if (params?.offset) q.set('offset', String(params.offset))
  const qs = q.toString()
  return request(`/alerts/${fingerprint}/timeline${qs ? `?${qs}` : ''}`)
}

export function fetchAlertStats(fingerprint: string, cluster?: string): Promise<AlertStats> {
  const q = new URLSearchParams()
  if (cluster) q.set('cluster', cluster)
  const qs = q.toString()
  return request<AlertStats>(`/alerts/${fingerprint}/stats${qs ? `?${qs}` : ''}`)
}

export function fetchAlertHeatmap(
  fingerprint: string,
  range: HeatmapRange,
  cluster?: string,
): Promise<AlertHeatmapResponse> {
  const q = new URLSearchParams({ range })
  if (cluster) q.set('cluster', cluster)
  return request<AlertHeatmapResponse>(`/alerts/${fingerprint}/heatmap?${q.toString()}`)
}

// ── Comments ─────────────────────────────────────────────────────────────────

export function fetchComments(fingerprint: string, clusterName: string): Promise<Comment[]> {
  const q = new URLSearchParams()
  if (clusterName) q.set('cluster', clusterName)
  const qs = q.toString()
  return request<Comment[]>(`/alerts/${fingerprint}/comments${qs ? `?${qs}` : ''}`)
}

export function addComment(
  fingerprint: string,
  clusterName: string,
  body: { authorName: string; body: string; eventId?: number },
): Promise<Comment> {
  const q = new URLSearchParams()
  if (clusterName) q.set('cluster', clusterName)
  const qs = q.toString()
  return request<Comment>(`/alerts/${fingerprint}/comments${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteComment(fingerprint: string, id: number, clusterName: string): Promise<void> {
  const q = new URLSearchParams()
  if (clusterName) q.set('cluster', clusterName)
  const qs = q.toString()
  return request<void>(`/alerts/${fingerprint}/comments/${id}${qs ? `?${qs}` : ''}`, {
    method: 'DELETE',
  })
}

// ── Claims ────────────────────────────────────────────────────────────────────

export function fetchActiveClaim(fingerprint: string, clusterName: string): Promise<Claim | null> {
  return request<Claim | null>(`/alerts/${fingerprint}/claim?cluster=${encodeURIComponent(clusterName)}`)
}

export function setClaim(
  fingerprint: string,
  clusterName: string,
  body: { claimedBy: string; note?: string; eventId?: number },
): Promise<Claim> {
  return request<Claim>(`/alerts/${fingerprint}/claim?cluster=${encodeURIComponent(clusterName)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function releaseClaim(fingerprint: string, clusterName: string, by: string): Promise<void> {
  return request<void>(
    `/alerts/${fingerprint}/claim?cluster=${encodeURIComponent(clusterName)}&by=${encodeURIComponent(by)}`,
    {
      method: 'DELETE',
    },
  )
}

export function updateClaimNote(
  fingerprint: string,
  clusterName: string,
  body: { claimedBy: string; note: string },
): Promise<Claim> {
  return request<Claim>(`/alerts/${fingerprint}/claim/note?cluster=${encodeURIComponent(clusterName)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function fetchClaimHistory(fingerprint: string, clusterName: string): Promise<Claim[]> {
  return request<Claim[]>(`/alerts/${fingerprint}/claims/history?cluster=${encodeURIComponent(clusterName)}`)
}

export function fetchSilenceEvents(fingerprint: string, cluster?: string): Promise<SilenceEvent[]> {
  const q = new URLSearchParams()
  if (cluster) q.set('cluster', cluster)
  const qs = q.toString()
  return request<SilenceEvent[]>(`/alerts/${fingerprint}/silence-events${qs ? `?${qs}` : ''}`)
}

// ── Silences ──────────────────────────────────────────────────────────────────

export function fetchSilences(cluster?: string): Promise<Silence[]> {
  const q = cluster ? `?cluster=${encodeURIComponent(cluster)}` : ''
  return request<Silence[]>(`/silences${q}`)
}

export interface UpsertSilenceBody {
  cluster: string
  matchers: Array<{ isEqual: boolean; isRegex: boolean; name: string; value: string }>
  startsAt: string
  endsAt: string
  createdBy: string
  comment: string
  id?: string
  fingerprint?: string
  performedBy?: string
}

export function upsertSilence(body: UpsertSilenceBody): Promise<{ id: string }> {
  return request<{ id: string }>('/silences', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function deleteSilence(id: string, cluster: string, params?: { fingerprint?: string; by?: string }): Promise<void> {
  const q = new URLSearchParams({ cluster })
  if (params?.fingerprint) q.set('fingerprint', params.fingerprint)
  if (params?.by) q.set('by', params.by)
  return request<void>(`/silences/${id}?${q.toString()}`, { method: 'DELETE' })
}

// ── Poll trigger ─────────────────────────────────────────────────────────────

export function triggerPoll(): Promise<void> {
  return request<void>('/poll', { method: 'POST' })
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function fetchAuthInfo(): Promise<ProviderInfo> {
  return fetch('/auth/info', { headers: { Accept: 'application/json' } })
    .then((r) => {
      if (!r.ok) throw new Error(`auth/info: ${r.status}`)
      return r.json() as Promise<ProviderInfo>
    })
}

export function fetchAuthMe(): Promise<AuthUser | null> {
  return fetch('/auth/me', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<AuthUser>) : null))
    .catch(() => null)
}

export function postLogin(username: string, password: string): Promise<{ user: AuthUser }> {
  return fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then(async (r) => {
    if (!r.ok) throw new Error('invalid credentials')
    return r.json() as Promise<{ user: AuthUser }>
  })
}

export function postLogout(): Promise<void> {
  return fetch('/auth/logout', { method: 'POST' }).then(() => undefined)
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export function fetchAdminUsers(): Promise<AdminUser[]> {
  return request<AdminUser[]>('/admin/users')
}

export function createAdminUser(body: { username: string; password: string; role: string }): Promise<AdminUser> {
  return request<AdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(body) })
}

export function updateAdminUser(id: string, role: string): Promise<AdminUser> {
  return request<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) })
}

export function deleteAdminUser(id: string): Promise<void> {
  return request<void>(`/admin/users/${id}`, { method: 'DELETE' })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

export function postSetup(username: string, password: string): Promise<{ ok: boolean }> {
  return fetch('/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  }).then((r) => {
    if (!r.ok) throw new Error('setup failed')
    return r.json() as Promise<{ ok: boolean }>
  })
}

// ── Clusters ──────────────────────────────────────────────────────────────────

export function fetchClusters(): Promise<ClusterInfo[]> {
  return request<ClusterInfo[]>('/clusters')
}

export function fetchStatus(): Promise<{
  status: string
  clusters: number
  alerts: number
  ws_clients: number
}> {
  return request('/status')
}

// ── Info ──────────────────────────────────────────────────────────────────────

export function fetchInfo(): Promise<{ version: string }> {
  return request('/info')
}

// ── Silence Templates ─────────────────────────────────────────────────────────

export function fetchSilenceTemplates(): Promise<SilenceTemplate[]> {
  return request<SilenceTemplate[]>('/silence-templates')
}

export function createSilenceTemplate(body: {
  name: string
  matchers: SilenceTemplate['matchers']
  reason: string
}): Promise<SilenceTemplate> {
  return request<SilenceTemplate>('/silence-templates', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateSilenceTemplate(
  id: string,
  body: { name: string; matchers: SilenceTemplate['matchers']; reason: string },
): Promise<SilenceTemplate> {
  return request<SilenceTemplate>(`/silence-templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteSilenceTemplate(id: string): Promise<void> {
  return request<void>(`/silence-templates/${id}`, {
    method: 'DELETE',
  })
}
