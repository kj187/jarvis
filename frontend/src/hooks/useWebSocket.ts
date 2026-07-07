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

const RECONNECT_DELAY = 3_000

export function useWebSocket() {
  const qc = useQueryClient()
  const setWsConnected = useUIStore((s) => s.setWsConnected)
  const mountedRef = useRef(true)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    mountedRef.current = true
    let reconnectTimeout: ReturnType<typeof setTimeout>

    function connect() {
      if (!mountedRef.current) return

      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${window.location.host}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        if (mountedRef.current) setWsConnected(true)
      }

      ws.onclose = () => {
        if (mountedRef.current) {
          setWsConnected(false)
          reconnectTimeout = setTimeout(connect, RECONNECT_DELAY)
        }
      }

      ws.onerror = () => {
        ws.close()
      }

      ws.onmessage = (event: MessageEvent<string>) => {
        if (!mountedRef.current) return
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
      clearTimeout(reconnectTimeout)
      wsRef.current?.close()
    }
  }, [qc, setWsConnected])
}
