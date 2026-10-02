import { describe, expect, it } from 'vitest'
import { staleClusterNotices } from './dataStatus'
import type { ClusterInfo } from '@/types'

const now = new Date('2026-10-02T10:00:00Z').getTime()

function cluster(partial: Partial<ClusterInfo> & { name: string }): ClusterInfo {
  return { alertmanagerUrl: '', prometheusUrl: '', healthy: true, alertCount: 0, stale: false, ...partial }
}

describe('staleClusterNotices', () => {
  it('lists only stale clusters, naming the cluster and the age of its data', () => {
    const notices = staleClusterNotices(
      [
        cluster({ name: 'prod', stale: true, lastSuccessfulPollAt: '2026-10-02T09:50:00Z' }),
        cluster({ name: 'dev', lastSuccessfulPollAt: '2026-10-02T09:59:50Z' }),
      ],
      now,
    )
    expect(notices).toEqual([{ cluster: 'prod', age: '10 min ago' }])
  })

  it('says "no data yet" for a cluster that never answered', () => {
    expect(staleClusterNotices([cluster({ name: 'new', stale: true })], now)).toEqual([
      { cluster: 'new', age: 'no data yet' },
    ])
  })

  it('returns nothing while every cluster is fresh', () => {
    expect(staleClusterNotices([cluster({ name: 'a' })], now)).toEqual([])
  })
})
