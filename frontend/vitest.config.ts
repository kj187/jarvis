import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Narrow, deliberate exception to the functional-E2E-only strategy (see
 * `.agents/testing.md`): pure matching/formatting logic in `lib/alertUtils.ts`
 * needs property-based/fuzz testing (fast-check) that isn't practical to
 * express as Playwright UI flows. Scope is limited to `src/lib/**` — no
 * broader component/unit-test stack is being reintroduced.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/lib/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/lib/alertUtils.ts'],
      thresholds: {
        statements: 100,
        lines: 100,
        functions: 100,
        // 99 rather than 100: the one remaining branch is the module-level
        // `tzAbbr` constant's `?? ''` fallback for when `toLocaleTimeString`
        // returns a timezone name with no trailing token — a real edge case,
        // but only exercisable by mocking Intl/Date behavior, for a value
        // that's cosmetic display text with no correctness stakes.
        branches: 99,
      },
    },
  },
})
