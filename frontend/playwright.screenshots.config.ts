import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: ['auth-screenshots.spec.ts', 'feature-screenshots.spec.ts'],
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // When running inside the Alpine dev container, point to the system Chromium
        // installed via `apk add chromium` (set via CHROMIUM_PATH env var in Makefile).
        ...(process.env.CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } }
          : {}),
      },
    },
  ],
  webServer: {
    command: 'echo "server already running"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
