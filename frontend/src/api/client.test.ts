import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchAlerts,
  fetchAlertGroups,
  fetchAlertHistory,
  fetchAlertStats,
  fetchComments,
  addComment,
  deleteComment,
  fetchActiveClaim,
  setClaim,
  releaseClaim,
  fetchClaimHistory,
  fetchSilenceEvents,
  fetchSilences,
  upsertSilence,
  deleteSilence,
  triggerPoll,
  fetchClusters,
  fetchStatus,
} from './client'

// ── Fetch mock helpers ──────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(String(body)),
    }),
  )
}

function mockFetch204() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      json: () => Promise.resolve(null),
      text: () => Promise.resolve(''),
    }),
  )
}

function mockFetchError(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText: 'Error',
      json: () => Promise.reject(new Error('json parse error')),
      text: () => Promise.resolve('error body'),
    }),
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

// ── Alerts ──────────────────────────────────────────────────────────────────

describe('fetchAlerts', () => {
  it('fetches all alerts', async () => {
    const alerts = [{ fingerprint: 'abc123' }]
    mockFetch(200, alerts)
    const result = await fetchAlerts()
    expect(result).toEqual(alerts)
  })

  it('passes cluster filter in query', async () => {
    mockFetch(200, [])
    await fetchAlerts({ cluster: 'homelab' })
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('cluster=homelab')
  })

  it('passes severity filter in query', async () => {
    mockFetch(200, [])
    await fetchAlerts({ severity: 'critical' })
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('severity=critical')
  })

  it('passes state filter in query', async () => {
    mockFetch(200, [])
    await fetchAlerts({ state: 'active' })
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('state=active')
  })

  it('throws on HTTP error', async () => {
    mockFetchError(500)
    await expect(fetchAlerts()).rejects.toThrow('500')
  })
})

describe('fetchAlertGroups', () => {
  it('fetches alert groups', async () => {
    const groups = [{ alertname: 'TestAlert', severity: 'critical', count: 1, alerts: [] }]
    mockFetch(200, groups)
    const result = await fetchAlertGroups()
    expect(result).toEqual(groups)
  })

  it('throws on HTTP error', async () => {
    mockFetchError(500)
    await expect(fetchAlertGroups()).rejects.toThrow('500')
  })
})

describe('fetchAlertHistory', () => {
  it('fetches history for fingerprint', async () => {
    const data = { events: [], total: 0 }
    mockFetch(200, data)
    const result = await fetchAlertHistory('abc123')
    expect(result).toEqual(data)
  })

  it('passes limit and offset', async () => {
    mockFetch(200, { events: [], total: 0 })
    await fetchAlertHistory('abc123', { limit: 50, offset: 10 })
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('limit=50')
    expect(url).toContain('offset=10')
  })
})

describe('fetchAlertStats', () => {
  it('fetches stats for fingerprint', async () => {
    const stats = { fingerprint: 'abc123', occurrenceCount: 3 }
    mockFetch(200, stats)
    const result = await fetchAlertStats('abc123')
    expect(result).toEqual(stats)
  })
})

// ── Comments ─────────────────────────────────────────────────────────────────

describe('fetchComments', () => {
  it('fetches comments for fingerprint', async () => {
    const comments = [{ id: 1, authorName: 'alice', body: 'test' }]
    mockFetch(200, comments)
    const result = await fetchComments('abc123')
    expect(result).toEqual(comments)
  })
})

describe('addComment', () => {
  it('posts a comment', async () => {
    const comment = { id: 1, authorName: 'alice', body: 'test' }
    mockFetch(201, comment)
    const result = await addComment('abc123', { authorName: 'alice', body: 'test' })
    expect(result).toEqual(comment)

    const fetchArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchArgs[1].method).toBe('POST')
    const body = JSON.parse(fetchArgs[1].body)
    expect(body.authorName).toBe('alice')
  })
})

describe('deleteComment', () => {
  it('sends DELETE request', async () => {
    mockFetch204()
    await deleteComment('abc123', 42)
    const fetchArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchArgs[1].method).toBe('DELETE')
    expect(fetchArgs[0]).toContain('/comments/42')
  })
})

// ── Claims ────────────────────────────────────────────────────────────────────

describe('fetchActiveClaim', () => {
  it('returns claim on 200', async () => {
    const claim = { id: 1, claimedBy: 'alice' }
    mockFetch(200, claim)
    const result = await fetchActiveClaim('abc123')
    expect(result).toEqual(claim)
  })

  it('returns null on 404', async () => {
    mockFetchError(404)
    const result = await fetchActiveClaim('abc123')
    expect(result).toBeNull()
  })

  it('rethrows non-404 errors', async () => {
    mockFetchError(500)
    await expect(fetchActiveClaim('abc123')).rejects.toThrow('500')
  })
})

describe('setClaim', () => {
  it('posts claim data', async () => {
    const claim = { id: 1, claimedBy: 'alice', note: 'investigating' }
    mockFetch(201, claim)
    const result = await setClaim('abc123', { claimedBy: 'alice', note: 'investigating' })
    expect(result).toEqual(claim)

    const fetchArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchArgs[1].method).toBe('POST')
  })
})

describe('releaseClaim', () => {
  it('sends DELETE with by param', async () => {
    mockFetch204()
    await releaseClaim('abc123', 'alice')
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('by=alice')
    const fetchArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchArgs[1].method).toBe('DELETE')
  })
})

describe('fetchClaimHistory', () => {
  it('fetches claim history', async () => {
    const claims = [{ id: 1, claimedBy: 'alice' }]
    mockFetch(200, claims)
    const result = await fetchClaimHistory('abc123')
    expect(result).toEqual(claims)
  })
})

describe('fetchSilenceEvents', () => {
  it('fetches silence events', async () => {
    const events = [{ id: 1, action: 'created' }]
    mockFetch(200, events)
    const result = await fetchSilenceEvents('abc123')
    expect(result).toEqual(events)
  })
})

// ── Silences ──────────────────────────────────────────────────────────────────

describe('fetchSilences', () => {
  it('fetches silences without cluster', async () => {
    const silences = [{ id: 'silence-1' }]
    mockFetch(200, silences)
    const result = await fetchSilences()
    expect(result).toEqual(silences)
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).not.toContain('cluster=')
  })

  it('includes cluster in query when provided', async () => {
    mockFetch(200, [])
    await fetchSilences('homelab')
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('cluster=homelab')
  })
})

describe('upsertSilence', () => {
  it('posts silence body', async () => {
    mockFetch(201, { id: 'new-silence' })
    const result = await upsertSilence({
      cluster: 'homelab',
      matchers: [],
      startsAt: '2024-01-01T00:00:00Z',
      endsAt: '2024-01-01T01:00:00Z',
      createdBy: 'alice',
      comment: 'test silence',
    })
    expect(result).toEqual({ id: 'new-silence' })

    const fetchArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchArgs[1].method).toBe('POST')
  })
})

describe('deleteSilence', () => {
  it('sends DELETE with cluster param', async () => {
    mockFetch204()
    await deleteSilence('silence-1', 'homelab')
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('silence-1')
    expect(url).toContain('cluster=homelab')
    const fetchArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchArgs[1].method).toBe('DELETE')
  })

  it('includes optional fingerprint and by params', async () => {
    mockFetch204()
    await deleteSilence('silence-1', 'homelab', { fingerprint: 'abc123', by: 'alice' })
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('fingerprint=abc123')
    expect(url).toContain('by=alice')
  })
})

// ── Misc ──────────────────────────────────────────────────────────────────────

describe('triggerPoll', () => {
  it('sends POST to /poll', async () => {
    mockFetch204()
    await triggerPoll()
    const fetchArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(fetchArgs[0]).toContain('/poll')
    expect(fetchArgs[1].method).toBe('POST')
  })
})

describe('fetchClusters', () => {
  it('fetches cluster list', async () => {
    const clusters = [{ name: 'homelab', healthy: true }]
    mockFetch(200, clusters)
    const result = await fetchClusters()
    expect(result).toEqual(clusters)
  })
})

describe('fetchStatus', () => {
  it('fetches status', async () => {
    const status = { status: 'ok', clusters: 1, alerts: 5, ws_clients: 2 }
    mockFetch(200, status)
    const result = await fetchStatus()
    expect(result).toEqual(status)
  })
})
