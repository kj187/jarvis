# Jarvis Lessons — Tests, E2E, screenshots

Playwright timing and fixtures, E2E reset/seed helpers, PG-gated tests, Mock-OIDC. Part of the lessons reference — start at `.agents/lessons.md` (index). Newest first; entry format: symptom → cause → rule.

---

## Playwright's `page.clock.fastForward()` fired a `setTimeout` before its scheduled deadline when racing a real WebSocket close/reopen

**Symptom**: An e2e test forced a WebSocket disconnect, then asserted (via
`page.clock.install()` + a single `fastForward(delay - 1)`) that the app's
jittered reconnect timer had *not* yet fired. It had — `connectCount` was
already 2, not 1, even though `delay - 1` ms had supposedly not yet elapsed.
Instrumenting `window.setTimeout` confirmed the timer itself was scheduled
correctly for the right delay and fired at exactly the right virtual
timestamp — but the *first* single large `fastForward` call reached that
timestamp sooner than a manual sum of several small `fastForward` calls
covering the identical total did.
**Cause**: not fully root-caused — likely an interaction between Playwright's
virtual-time fake timers and the real, asynchronous WebSocket close/open
event dispatch (a real browser network primitive, not a JS timer) that a
single big time jump processes differently than several small ones.
**Rule**: Don't assert millisecond-exact fake-clock boundaries around a real
WebSocket's real open/close events. Use real wall-clock time with generous
bounds instead (`page.waitForTimeout` sanity floor below the minimum possible
delay, `{ timeout }` ceiling comfortably above the maximum) — see
`e2e/functional/none/ws-reconnect.spec.ts`. `page.clock` is still fine for
scenarios with no real async I/O in the loop (e.g. `resolved-fetch.spec.ts`'s
resolved-history fallback timer).

---

## PG elector tests in different packages serialised each other over the one advisory lock

**Symptom**: The `Backend` CI job flaked, hardest during a burst of
concurrent pipelines (a batch Dependabot merge): `internal/leader`
(`TestPGElector_Failover`, `TestPGElector_Subscribe_…`) and
`internal/history` (`TestMultiReplica_FollowerTrigger_ForwardsToLeader`)
failing `waitFor` with `condition not met within 5s`; separately the fuzz
step failing `FuzzParseSecretKey … context deadline exceeded`.
**Cause**: every `PGElector` used the production Binding Constants
`pg_try_advisory_lock(0x4A525653, 1)`. `go test ./...` runs `internal/leader`
and `internal/history` as separate binaries **concurrently** against the one
shared test database, so only one package's electors could ever hold
leadership — the other package's tests waited out their 5s ceiling under a
loaded runner. The fuzz failure was pure worker oversubscription (each of 5
targets spawned GOMAXPROCS workers), not a finding — `parseSecretKey` is a
single `hex.DecodeString`.
**Rule**: `PGElector.SetLockID(classID, id)` (test-only, alongside
`SetRetryInterval`) pins each test to its own advisory-lock namespace —
class ID = test PID, lock ID = hash of `t.Name()` (helpers named `testLockID`
in both `internal/leader` and `internal/history` tests); electors built for
the same test share the ID and still contend. Production must never call it.
`holdLock` now attempts the lock immediately on connect instead of after a
full `retryInterval` (also a real cold-start win: a fresh pod with no
incumbent is promoted in one round-trip, not after 5s). `waitFor` ceilings
raised to 20–30s (a passing check still returns immediately). CI fuzz step
runs `-parallel 2`.

---

## `jarvis.reset()` truncates `users` too — fatal for a helper called after login in a screenshot spec

**Symptom**: `fireWithHeatmapHistory()` (see below) worked fine in `none`-mode
screenshots, but every `internal`-mode spec that logged in first
(`ensureInternalAdmin` + `loginInternal`) started timing out waiting for
`login-button`/`user-menu` — the app silently redirected to a different auth
state instead.
**Cause**: `ResetForTesting` (`backend/internal/history/testing_e2e.go`)
truncates `users` along with the alert-history tables — correct for the
per-test auto-reset in `support/fixtures.ts` (full isolation between tests),
but `fireWithHeatmapHistory` was *also* calling `jarvis.reset()` mid-flow
(to start historical seeding from a clean fingerprint row). Any spec that
creates its admin user (`ensureInternalAdmin`) *before* calling the helper
had that user silently deleted by the helper's own reset, before the login
step or subsequent navigation.
**Rule**: Don't reset the DB inside a helper meant to run after other setup
(auth, claims, etc.) unless you truncate only the tables you actually need
clean — `alert_events`/`alert_fingerprints`, not `users`/`alert_claims`. In
this case the real fix was realizing the reset wasn't needed at all: once
history seeding moved to direct inserts (`SeedFiringHistoryForTesting`,
next entry), there's no idempotency state left to collide with, so
`fireWithHeatmapHistory` now seeds on top of the already-live fingerprint
with no reset step.

---

## Chaining multiple historical firing cycles onto one fingerprint via the production record path silently collapses them into one row

**Symptom**: Backfilling a 14-cycle firing→resolved history onto a single
fingerprint via 14 sequential `SeedResolvedForTesting` calls (looping the
existing e2e `/test/seed` endpoint) — regardless of whether the cycles were
submitted oldest-first or newest-first — only ever left **one** surviving
`firing` row in the DB: always whichever cycle was submitted **first**. Every
other cycle vanished without error.
**Cause**: `SeedResolvedForTesting` reuses the production
`RecordStatusChange` + `RecordResolvedForCluster` path. `RecordStatusChange`
always stamps `recorded_at` with **real** `time.Now()` regardless of the
historical `startsAt` argument, while `RecordResolvedForCluster` stamps
`recorded_at` with the **historical** `resolvedAt` argument passed in. So
cycle 1's firing row gets `recorded_at = real_now`, but cycle 1's resolved row
gets `recorded_at = <historical resolvedAt>` — always earlier than real_now.
`getLastEventForCluster` picks the row with `MAX(recorded_at)`, which is
therefore **permanently** cycle 1's firing row — no later historical resolved
row can ever out-date real `time.Now()`. Every subsequent cycle's firing call
sees `last.Status == "firing"` and hits the idempotency short-circuit
(`RecordStatusChange`'s very first check) or the 60s grace period, either way
inserting nothing new; its resolved call still inserts a row, but inherits
`starts_at` from cycle 1's original firing row, corrupting it.
**Rule**: Never chain more than one historical cycle onto the same
fingerprint through `RecordStatusChange`/`RecordResolvedForCluster` (or
`SeedResolvedForTesting`, which wraps them) — that path assumes `recorded_at`
tracks real time, true for live poll ingestion but not for backfilling
history. Use `SeedFiringHistoryForTesting`
(`backend/internal/history/testing_e2e.go`) / `jarvis.seedHeatmapHistory()`
(`e2e/support/jarvis.ts`) instead — it inserts each cycle's firing/resolved
row directly with `recorded_at` set to that cycle's own timestamp, bypassing
the idempotency/grace-period logic entirely (correct for controlled,
already-ordered synthetic history — that logic exists to protect real-time
flapping, which doesn't apply here).

---

## A frozen screenshot clock silently empties the heatmap even with real seeded data

**Symptom**: Seeded a realistic firing history via `POST /api/v1/test/seed`
(`support/heatmapHistory.ts`, `fireWithHeatmapHistory`) for a Playwright
screenshot, confirmed via the API that `GET /alerts/:fp/heatmap` returned a
non-empty `firingStarts` array — yet the rendered heatmap grid and card
sparkline were 100% empty cells in the screenshot.
**Cause**: `bucketFiringStarts` (`lib/heatmapUtils.ts`) buckets timestamps
relative to `now = new Date()` read from the **frontend/browser** clock.
Screenshot specs call `freezeClock(page)`, which pins that browser clock to
the shared fixed epoch `FIXED_NOW` (`2025-01-15T12:00:00Z`, `support/
fixtures.ts`) for deterministic relative-time text elsewhere. But the
backend's heatmap window filter (`GetFiringStarts`,
`backend/internal/history/store.go`) always uses real Go server time
(`time.Now()`), and seeded history is naturally timestamped near real
wall-clock time too. Once the real date drifts far enough from the fixed
2025 epoch, every returned `firingStarts` timestamp lands far outside the
window the frozen frontend clock computes buckets for → nothing matches →
all-empty grid, despite correct, non-empty backend data.
**Rule**: Any screenshot that needs a non-empty heatmap/sparkline must not
freeze the browser clock to the shared fixed epoch. `fireWithHeatmapHistory`
freezes it to `new Date()` (real time) internally instead — do not also call
`freezeClock(page)` in a spec that uses it.

---

## E2E Playwright image pin must match `@playwright/test` version

**Symptom**: Every E2E test fails in ~2ms with
`browserType.launch: Executable doesn't exist at /ms-playwright/chromium_headless_shell-<rev>/...`
— typically on a Dependabot PR that bumps `@playwright/test`.
**Cause**: `compose.e2e.yml` pins `mcr.microsoft.com/playwright:vX.Y.Z-noble`.
The container's pre-installed browsers live under revision paths tied to that
image version; a newer `@playwright/test` from `frontend/package.json` looks
for a newer browser revision that isn't in the image. Dependabot only bumps
package.json/lockfile, never the compose image.
**Rule**: Whenever `@playwright/test` changes version, update the image tag in
`compose.e2e.yml` to the same version in the same commit. Mass 2ms E2E
failures = environment/browser mismatch, not test regressions.

---

## Mock-OIDC in E2E has several baked-in gotchas

Config must be file-mounted (podman-compose drops inline `JSON_CONFIG`),
claim mapping must match on `grant_type=authorization_code`, and the issuer
must be the internal hostname. Full detail: `docs/testing-e2e.md` →
"Mock OIDC details".

---

## e2e `/test/reset` didn't clear the 20-minute resolved-alert buffer

**Symptom**: `silence-matching-semantics.spec.ts` flaked in CI with a wrong
affected-alerts count (`silence-matching-semantics.spec.ts:135`), unrelated
to the diff under test — pointed at cross-test state leakage.
**Cause**: `POST /api/v1/test/reset` called `alertStore.Set(nil)` to clear
alerts between tests. `Set` intentionally preserves `AlertStore`'s resolved
buffer (alerts stay visible 20 minutes after resolving) — by design, `Set`
only prunes buffer entries that reappear in the new active list, so `Set(nil)`
touches the buffer not at all. A previous test's alert, resolved via
`am.clearAll()` in the next test's fixture and picked up by the recorder's
poll, landed in the buffer and leaked into `GET /api/v1/alerts` — which
`SilenceForm`'s live affected-alerts preview reads unfiltered by state.
**Rule**: `AlertStore.Reset()` (`internal/history/alert_store.go`) clears
both the active list and the resolved buffer; `testReset` uses it instead of
`Set(nil)`. `Set(nil)` keeps its production semantics for the real poll loop.
Any store with a deliberately-persisted buffer/cache needs an explicit
test-only full-wipe method — `Set(nil)`-shaped "clear" calls are not it.
