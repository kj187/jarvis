import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'auth-screenshots.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? undefined,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH ?? undefined,
        },
      },
    },
  ],
  webServer: {
    command: 'echo "server already running"',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
