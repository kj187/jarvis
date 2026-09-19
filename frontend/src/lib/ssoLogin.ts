import { fetchAuthMe } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import type { AuthUser } from '@/types'

const CHANNEL = 'jarvis-auth'
const POPUP_DONE_PARAM = 'login'
const POPUP_DONE_VALUE = 'popup-done'
const SESSION_POLL_MS = 1000
const POPUP_FEATURES = 'popup=yes,width=520,height=720'

/**
 * SSO entry URL that brings the browser back to the page it left (path,
 * filters, open alert) after a full-page redirect. Used where a popup is not an
 * option; the backend only honours same-origin paths.
 */
export function ssoRedirectUrl(loginUrl: string): string {
  const { pathname, search, hash } = window.location
  return `${loginUrl}?return_to=${encodeURIComponent(pathname + search + hash)}`
}

/**
 * Runs the SSO login in a popup so the page underneath — an half-filled silence
 * form, an open alert — stays exactly as it is. As soon as the session is valid
 * the auth store is updated (which also releases whatever action was waiting
 * for the login) and the popup is closed from here.
 *
 * The opener never depends on the popup cooperating: while it is open we watch
 * for the session cookie the callback sets (shared by all windows), so it works
 * even when the identity provider's opener policy severs `window.opener` or the
 * popup cannot close itself. The popup's own BroadcastChannel message is only a
 * faster path. Falls back to a full-page redirect that returns to the current
 * URL when the browser blocks the popup. `onSettled` fires when the flow ends,
 * logged in or not (e.g. the user closed the popup).
 */
export function startSsoLogin(loginUrl: string, onSettled: () => void): void {
  const popup = window.open(`${loginUrl}?popup=1`, 'jarvis-sso', POPUP_FEATURES)
  if (popup === null) {
    window.location.href = ssoRedirectUrl(loginUrl)
    return
  }

  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
  let settled = false
  let checking = false

  const finish = (user: AuthUser | null) => {
    if (settled) return
    settled = true
    window.clearInterval(watchdog)
    channel?.close()
    if (!popup.closed) popup.close()
    if (user !== null) useAuthStore.getState().setUser(user)
    onSettled()
  }

  // Re-read the session; ends the flow when it is valid, or when the popup is gone.
  const check = async () => {
    if (settled || checking) return
    checking = true
    try {
      const user = await fetchAuthMe()
      if (user !== null || popup.closed) finish(user)
    } finally {
      checking = false
    }
  }

  channel?.addEventListener('message', () => void check())
  const watchdog = window.setInterval(() => void check(), SESSION_POLL_MS)
}

/**
 * Called once at startup. When this window is the SSO popup landing back on the
 * app after the identity provider, tell the opener and close. Whether we really
 * are the popup cannot be told reliably (an identity provider's cross-origin
 * opener policy wipes `window.opener` and `window.name`), so the app still
 * boots afterwards: in a real popup it is torn down with the window, in an
 * ordinary tab it simply works.
 */
export function completeSsoPopup(): void {
  const url = new URL(window.location.href)
  if (url.searchParams.get(POPUP_DONE_PARAM) !== POPUP_DONE_VALUE) return

  url.searchParams.delete(POPUP_DONE_PARAM)
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)

  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage('done')
    channel.close()
  }
  window.close()
}
