import type { Page } from '@playwright/test'

/**
 * Auth helpers shared across the none / internal / oidc test modes.
 *
 * The active mode is selected by the e2e stack (JARVIS_AUTH_PROVIDER), not by
 * the test — the test simply drives whatever flow that mode exposes.
 */

const NOAUTH_DISMISS_KEY = 'jarvis_noauth_notice_dismissed'

/** Default credentials seeded for the internal-mode tests. */
export const INTERNAL_ADMIN = {
  username: 'e2e-admin',
  password: 'e2e-admin-password',
}

/**
 * Hides the "No authentication configured" modal (none mode only) by setting
 * its dismiss flag before the page loads. Call BEFORE page.goto().
 */
export async function dismissNoAuthNotice(page: Page): Promise<void> {
  await page.addInitScript(
    (key) => window.localStorage.setItem(key, '1'),
    NOAUTH_DISMISS_KEY,
  )
}

/**
 * Internal mode first-run: creates the initial admin via POST /setup.
 * Idempotent — a 403 ("already completed") is treated as success.
 */
export async function ensureInternalAdmin(
  page: Page,
  creds = INTERNAL_ADMIN,
): Promise<void> {
  const res = await page.request.post('/setup', { data: creds })
  if (!res.ok() && res.status() !== 403) {
    throw new Error(`setup failed: ${res.status()} ${await res.text()}`)
  }
}

/** Internal mode: logs in via POST /auth/login; the session cookie lands in the page context. */
export async function loginInternal(
  page: Page,
  creds = INTERNAL_ADMIN,
): Promise<void> {
  const res = await page.request.post('/auth/login', { data: creds })
  if (!res.ok()) {
    throw new Error(`login failed: ${res.status()} ${await res.text()}`)
  }
}

/**
 * OIDC mode: drives the full Authorization-Code-with-PKCE flow by navigating to
 * /auth/oidc/start. The mock OIDC server auto-approves (interactiveLogin=false)
 * and redirects back to the callback, landing on "/" fully authenticated.
 */
export async function loginOIDC(page: Page): Promise<void> {
  await page.goto('/auth/oidc/start')
  await page.waitForURL('**/')
}
