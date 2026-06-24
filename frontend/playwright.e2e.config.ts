import { defineConfig, devices } from '@playwright/test'

/**
 * Functional E2E config — runs against the isolated e2e Jarvis stack
 * (compose.e2e.yml). The auth mode + which spec folder runs is selected by the
 * runner (scripts/e2e-run.sh) via E2E_TEST_DIR. baseURL comes from E2E_BASE_URL
 * (http://e2e-jarvis:8080 inside the playwright container).
 */
export default defineConfig({
  testDir: process.env.E2E_TEST_DIR ?? './e2e/functional/none',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8085',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
