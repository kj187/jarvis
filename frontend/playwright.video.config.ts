import { defineConfig, devices } from '@playwright/test'
import { VIDEO_FORMATS, VIDEO_PROJECT, currentVideoFormat } from './e2e/video/recorder'

/**
 * Release-video recording config — runs the per-release storyboard
 * (e2e/_video/<VIDEO_PROJECT>.video.ts, gitignored) against the isolated e2e stack.
 * VIDEO_FORMAT (landscape | square) picks the viewport; scripts/e2e-run.sh
 * runs it once per format. See .agents/skills/release-video/SKILL.md.
 */
const { width, height } = VIDEO_FORMATS[currentVideoFormat()]

export default defineConfig({
  testDir: './e2e/_video',
  testMatch: `${VIDEO_PROJECT}.video.ts`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A 2–3 minute video is well over 5 minutes of wall clock: the storyboard
  // runs in real time and finish() then screenshots every title-card frame.
  timeout: 1_200_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8085',
    trace: 'off',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      // Device-pixel frames (zoomed shots downscale instead of turning blurry): the
      // screencast ignores emulated deviceScaleFactor alone and needs the launch
      // flag too; layout (innerWidth, breakpoints) stays at the CSS viewport.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width, height },
        deviceScaleFactor: 2,
        launchOptions: { args: ['--force-device-scale-factor=2'] },
      },
    },
  ],
})
