# Jarvis — Lessons Learned

Durable, non-obvious insights from past debugging sessions. Check this file
before re-deriving a gotcha from scratch; add a new entry (newest first)
whenever a debugging session produces an insight that would save the next
session real time (root `AGENTS.md` → Workflow Rules #6). Keep entries short:
symptom → cause → rule. When another file owns the full detail, link it
instead of duplicating.

---

## A silence expiring mid-episode replays as a "new" firing row with the same `starts_at` — double-counts the heatmap

**Symptom**: `GetFiringStarts` (`backend/internal/history/store.go`) was
believed safe from double-counting because "the 60s grace period already
prevents it" (old code comment). That's only true for resolve+refire.
**Cause**: When a silence expires (or is deleted) while the alert is still
actually firing in Alertmanager, the poll sequence is `suppressed →
expired (poll N) → firing (poll N+1)` — the new firing row is written
because the *last* event was `expired`, not `firing` (idempotency only
skips inserts when the immediately preceding status matches). That new row
carries the *same* `starts_at` as the original episode (AM never actually
stopped firing), so one real firing episode produced two rows with
status `firing` — `GetFiringStarts` counted both, double-counting the
episode in the heatmap. The same pattern hits the grace-period edge case
too, when the row immediately before a `resolved` row was `suppressed`.
**Rule**: Episode identity for firing-episode dedup is `starts_at`
(Alertmanager's upstream condition-start time), not "one row per firing
status change". `GetFiringStarts` now groups by `starts_at` (via a
`ROW_NUMBER() OVER (PARTITION BY starts_at ...)` subquery — a plain
`GROUP BY` + `MIN(recorded_at)` fails on SQLite because aggregate
expressions lose the column's declared `DATETIME` type, so
`modernc.org/sqlite` scans the result as a string instead of `time.Time`;
selecting the raw `recorded_at` column through a window-function subquery
preserves it). `occurrence_count` and `GetStatsForCluster`'s per-cluster LAG
query are unaffected — they only count firing-after-resolved transitions.

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

## A resolve+refire inside the 60s grace period is silently absorbed, not recorded

**Symptom**: Manually testing occurrence tracking / the firing-pattern
heatmap by running `make fixtures-remove` then `make fixtures-create` —
even with an explicit `POST /api/v1/poll` forced in between and a few
seconds' wait — `occurrenceCount` and the heatmap stayed completely
unchanged, with zero trace of a resolved event ever appearing in
`GET /alerts/:fp/history`, even though Alertmanager's own `GET /api/v2/alerts`
confirmed the alert genuinely disappeared and came back with a fresh
`startsAt`. (First suspected: poll-interval racing, or Alertmanager gossip
lag between the dev HA pair's two members — both ruled out by direct testing:
the resolve is immediate at the Alertmanager API level, and AM does not
gossip raw alert data between mesh members at all, only silences/nflog, so
member-lag was never the mechanism.)
**Cause**: This is Critical Invariant #1 (`AGENTS.md`) doing exactly what
it's designed to do. `RecordStatusChange` (`backend/internal/history/store.go`):
a firing status arriving within 60s of the last recorded *resolved* row
**deletes that resolved row** and returns the prior (still-firing) row
unchanged — `created=false`, no new event, `occurrence_count` untouched.
This exists to stop a transient poll miss from creating ghost-resolve
entries. `resolve-test-alerts.sh` resolves in well under a second; unless
something deliberately holds the alert resolved for >60s before re-firing,
any test re-fire lands inside the grace window and is invisibly discarded —
regardless of `JARVIS_POLL_INTERVAL`, and regardless of whether a poll was
forced in between.
**Rule**: To manually force a genuine new firing episode, resolve, then
wait **more than 60 seconds** before re-firing — `make fixtures-refire`
(`scripts/refire-test-alerts.sh`, `GRACE_WAIT_SECONDS=70`) does this. There
is no way to shortcut this with faster polling; the wait is the fix.

## A plausible-sounding Alertmanager validation rule can still be wrong — verify against a real instance

**Symptom**: A new backend check (`validateSilenceMatchers`, added to reject
matchers Alertmanager itself would reject) silently rejected a legitimate
`instance!~"web"` silence with 400 "must not match the empty string" — no
error surfaced anywhere except a differential E2E test noticing the silence
was simply never created.
**Cause**: The check ("at least one matcher must not match the empty
string") was implemented symmetrically for positive AND negative matchers.
Reasoning from first principles about what AM's rule "should" do (and even
writing consistent unit tests around that reasoning) produced a self-coherent
but factually wrong model: real Alertmanager (verified via direct API calls,
bypassing Jarvis) only applies this check to positive matchers (`=`, `=~`) —
negative matchers (`!=`, `!~`) are always accepted, since being broad/exclusionary
is their entire point (e.g. `env!=kube-system`).
**Rule**: For any check meant to mirror a rule enforced by an external system
(Alertmanager, but the same applies to any upstream API), verify the actual
behavior with direct calls to that system — `curl` it — rather than trusting
a mental model, even one that produces passing self-consistent unit tests.
Unit tests against your own reference implementation can only catch
regressions from that implementation; they cannot catch the implementation
itself being wrong. See `frontend/e2e/functional/none/silence-matching-semantics.spec.ts`
(differential tests against a real Alertmanager) and
`tmp/fable/review_silence.md` T-06 for the broader pattern this guards against.

## Silence matchers must exclude pseudo-labels (`@receiver`, `@cluster`, `receiver`)

**Symptom**: One-click Fast-Silence created a silence, but the alert never
turned suppressed. The Silences list showed "0 affected alerts", yet opening
the silence detail showed "1 affected alert". `silencedBy` on the alert stayed
empty.
**Cause**: `buildAckSilenceBody` built matchers from *all* of `alert.labels`,
including the synthetic pseudo-labels Jarvis adds for display/filtering
(`@receiver`, and `@cluster` via `getEffectiveAlertState`). Those keys do not
exist on the real Alertmanager alert, so AM matched nothing (0 affected, no
suppression). The client-side "affected" count in the silence *detail* uses the
enriched labels, so it matched 1 — hence the contradiction between list and
detail.
**Rule**: When deriving silence matchers from an alert, skip pseudo-labels —
any key starting with `@` plus `receiver`. This mirrors `SilenceForm`'s
`buildPrefillMatchers` SKIP set (`receiver`, `@receiver`, `@cluster`). Regression
guard: `e2e/functional/none/alert-ack.spec.ts` asserts no matcher name starts
with `@` or equals `receiver`.

## WS clients must be registered synchronously in ServeWS, not via the hub loop

**Symptom**: J3 e2e tests (`claim_set` badge in open detail panel) flaky —
fail on first run, pass on retry. The browser shows "WebSocket connected",
but a WS event fired right after connect never arrives.
**Cause**: The browser fires `onopen` when the 101 handshake completes, but
registration went through a buffered `register` channel processed by the hub
loop. A broadcast racing that registration iterated an empty client set —
and the loop's `select` gives no ordering guarantee between a pending
registration and a pending broadcast. Lost event = lost forever: claim/comment
queries only refetch on WS invalidation.
**Rule**: `ServeWS` adds the client to the map under the mutex *before*
starting the pumps. Anything a client must be guaranteed to see after its
handshake must not depend on event-loop scheduling. Regression test:
`TestHub_ServeWSRegistersSynchronously` (runs without `hub.Run()`).

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

## New public routes must be added to `isSkippedPath`, not just registered outside `apiV1`

**Symptom**: A new route registered globally (like `/health`) returns 404
under `JARVIS_AUTH_PROVIDER=internal` with zero users, even though it's
outside the `apiV1` group and no auth middleware applies to it.
**Cause**: `firstRunRedirect` (`internal/api/setup_handler.go`) 302-redirects
any path not in `isSkippedPath` to `/setup` whenever internal-mode has no
users yet — being outside `apiV1` only skips the *auth* middleware, not this
one. A client that follows redirects then hits `/setup`, and in a test with
an empty `embed.FS{}` the SPA catch-all isn't registered, so it 404s instead
of showing a redirect.
**Rule**: Every route meant to be reachable pre-setup (like `/metrics`) must
be added to the `isSkippedPath` switch alongside `/health`, `/ws`, `/setup`.

## Silence recreate: strip backslashes before ANY character, not just regex metacharacters

**Symptom**: Re-creating an expired silence with regex matchers shows
"0 affected alerts" and the matcher never matches.
**Cause**: Alertmanager (or external tooling) may store escapes like `\/` or
`\-` in regex matcher values. `unescapeRegex` in `SilenceForm.tsx` originally
only stripped backslashes before the regex metacharacter set, so those escapes
survived recreate and were re-escaped to `\\/` on submit — breaking the
matcher.
**Rule**: A backslash escape always means "literal next character" — unescape
with `s.replace(/\\(.)/g, '$1')`. Repro fixtures: `make fixtures-silence` /
`make fixtures-unsilence`.

## Alertmanager silence "update" can return a new silence ID

**Symptom**: Editing/extending a silence leaves the old one active →
duplicate silences.
**Cause**: AM's `POST /silences` with an existing `id` may create a new
silence instead of updating in place.
**Rule**: When the returned ID differs from the submitted one, expire the old
silence (implemented in `backend/internal/api/silences.go`; documented in
`.agents/architecture.md` → API).

## Proxy errors: always log the underlying Alertmanager error

**Symptom**: Silence create/delete fails with generic `502 alertmanager
request failed` and no way to diagnose why.
**Rule**: Handlers proxying to Alertmanager must `slog.Error` the underlying
error (with cluster context) before returning the sanitized HTTP error —
the response stays generic (no internal detail leaks), the log carries the
cause.

## Mock-OIDC in E2E has several baked-in gotchas

Config must be file-mounted (podman-compose drops inline `JSON_CONFIG`),
claim mapping must match on `grant_type=authorization_code`, and the issuer
must be the internal hostname. Full detail: `docs/testing-e2e.md` →
"Mock OIDC details".

## Release workflow steps only run on tag push — test drift stays hidden

**Symptom**: `release.yml` failed at "Create GitHub Release" during v1.6.0:
`no matches found for sbom.spdx.json`. The pinned `anchore/sbom-action` SHA
does not support `output-file`/`upload-artifact`/`upload-release-assets`
(inputs silently ignored as "unexpected"), so no SBOM file was written.
**Cause**: The step was added without ever executing — `release.yml` only
triggers on tag push, so broken steps surface at release time.
**Rule**: SBOM is now generated by running syft directly
(`anchore/sbom-action/download-syft` + `syft ... > sbom.spdx.json`). When a
release fails after the tag exists: fix on a branch, merge, then **move the
tag** (`git tag -f`, force-push) — the workflow runs from the tag's commit,
so re-pushing the old tag would rerun the broken workflow. Only safe while
no GitHub Release was published (releases are immutable; images/charts are
tag-overwritable).

## Per-client live proxying to Alertmanager makes AM load scale with open tabs

**Symptom**: Alertmanager CPU roughly doubled on one environment after
deploying Jarvis — most visible on the instance with the largest
alert/silence payload.
**Cause**: `GET /api/v1/silences` (fetch from every cluster member) and
`GET /api/v1/clusters` (live `/api/v2/status` ping per member) proxied to
Alertmanager on **every client request**, and the frontend refetches both
every 30s in every open tab. Each tab added ~4 AM requests/min per member on
top of the recorder poll — the intended "only the backend polls, clients get
snapshots/WS" architecture was silently broken for these two endpoints.
**Rule**: Critical Invariant #13 — client-facing reads are served from poll
snapshots (`AlertStore` / `SilenceStore` / `MemberUpStates`), never from a
synchronous AM call. Mutations write through to the snapshot + trigger a
poll so the UI stays instant. When adding a read endpoint, ask: "does its
cost scale with the number of open tabs?" — if yes, snapshot it.

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
