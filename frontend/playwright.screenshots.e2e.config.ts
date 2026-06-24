import { defineConfig, devices } from '@playwright/test'

/**
 * Screenshot generation config — deterministic, runs against the isolated e2e
 * Jarvis stack (compose.e2e.yml). One test = one PNG; the spec folder is chosen
 * per auth mode by the runner (scripts/e2e-run.sh) via E2E_SCREENSHOT_DIR.
 * Regenerate a single screenshot with `-g <name>`.
 */
export default defineConfig({
  testDir: process.env.E2E_SCREENSHOT_DIR ?? './e2e/screenshots/none',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8085',
    trace: 'off',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
