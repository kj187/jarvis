import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/store/uiStore'
import type {
  WSEvent,
  AlertsUpdatePayload,
  ClaimSetPayload,
  ClaimReleasedPayload,
  CommentAddedPayload,
} from '@/types'

// Reconnect delay is jittered (3000-6000ms), not a fixed 3s: many browser
// tabs disconnected by the same event (a backend rollout, a network blip)
// would otherwise all retry in lockstep on every subsequent attempt too.
function getReconnectDelay(): number {
  return 3_000 + Math.floor(Math.random() * 3_001)
}

export function useWebSocket() {
  const qc = useQueryClient()
  const setWsConnected = useUIStore((s) => s.setWsConnected)
  const mountedRef = useRef(true)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    mountedRef.current = true
    // Single pending timer at a time — cleared by cleanup and by every
    // successful open, never left to fire after either.
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined

    function clearReconnectTimeout() {
      if (reconnectTimeout !== undefined) {
        clearTimeout(reconnectTimeout)
        reconnectTimeout = undefined
      }
    }

    function connect() {
      if (!mountedRef.current) return

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`)
      wsRef.current = ws

      // wsRef.current === ws in every callback below: after a reconnect (or
      // after unmount replaces/clears wsRef), a stale socket's late-firing
      // event must never start a second timer or trigger a second refetch.
      ws.onopen = () => {
        if (!mountedRef.current || wsRef.current !== ws) return
        clearReconnectTimeout()
        setWsConnected(true)
        // WS delivers no replay: events broadcast while disconnected are
        // gone. Refetch everything on every (re)connect so the UI recovers
        // immediately. Active-alert/claim/silence reads are served from
        // in-memory snapshots; resolved-history reads hit the database
        // (paginated) instead — either way none of this touches
        // Alertmanager, so a reconnect storm can't scale AM load.
        qc.invalidateQueries()
      }

      ws.onclose = () => {
        if (!mountedRef.current || wsRef.current !== ws) return
        setWsConnected(false)
        clearReconnectTimeout()
        reconnectTimeout = setTimeout(connect, getReconnectDelay())
      }

      ws.onerror = () => {
        if (wsRef.current !== ws) return
        ws.close()
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current || wsRef.current !== ws) return
        try {
          const msg = JSON.parse(event.data) as WSEvent
          handleEvent(msg)
        } catch {
          // ignore malformed messages
        }
      }
    }

    function handleEvent(event: WSEvent) {
      switch (event.type) {
        case 'alerts_update': {
          const payload = event.payload as AlertsUpdatePayload
          qc.setQueryData(['alerts', undefined], payload.alerts)
          qc.setQueryData(['alerts', {}], payload.alerts)
          break
        }

        case 'claim_set': {
          const payload = event.payload as ClaimSetPayload
          // Patch alerts cache
          qc.setQueriesData({ queryKey: ['alerts'] }, (old: unknown) => {
            if (!Array.isArray(old)) return old
            return old.map((a: { fingerprint: string; clusterName: string }) =>
              a.fingerprint === payload.fingerprint && a.clusterName === payload.clusterName
                ? { ...a, activeClaim: payload.claim }
                : a,
            )
          })
          qc.invalidateQueries({ queryKey: ['claim', payload.fingerprint, payload.clusterName] })
          qc.invalidateQueries({ queryKey: ['claim-history', payload.fingerprint, payload.clusterName] })
          break
        }

        case 'claim_released': {
          const payload = event.payload as ClaimReleasedPayload
          qc.setQueriesData({ queryKey: ['alerts'] }, (old: unknown) => {
            if (!Array.isArray(old)) return old
            return old.map((a: { fingerprint: string; clusterName: string }) =>
              a.fingerprint === payload.fingerprint && a.clusterName === payload.clusterName
                ? { ...a, activeClaim: undefined }
                : a,
            )
          })
          qc.invalidateQueries({ queryKey: ['claim', payload.fingerprint, payload.clusterName] })
          qc.invalidateQueries({ queryKey: ['claim-history', payload.fingerprint, payload.clusterName] })
          break
        }

        case 'silences_update': {
          // Pure invalidation signal (empty payload) — the silence snapshot
          // changed on the backend (poll diff or another user's mutation).
          qc.invalidateQueries({ queryKey: ['silences'] })
          break
        }

        case 'comment_added': {
          const payload = event.payload as CommentAddedPayload
          const clusterName = payload.comment?.clusterName
          if (clusterName) {
            qc.invalidateQueries({ queryKey: ['comments', payload.fingerprint, clusterName] })
          } else {
            qc.invalidateQueries({ queryKey: ['comments', payload.fingerprint] })
          }
          break
        }
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      clearReconnectTimeout()
      wsRef.current?.close()
    }
  }, [qc, setWsConnected])
}
