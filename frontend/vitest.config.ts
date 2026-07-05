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
      // 100% branch-coverage gate lands once the silence-matching rewrite
      // (anchored regex, S-01/S-03/S-05/S-06/S-14) has full test coverage —
      // enabling it now would fail on functions not yet under test.
    },
  },
})
