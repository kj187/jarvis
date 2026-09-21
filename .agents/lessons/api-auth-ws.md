# Jarvis Lessons — API, auth, WebSocket, alert ordering

Handlers, route registration and auth middleware, Alertmanager payload quirks, WS hub, list ordering. Part of the lessons reference — start at `.agents/lessons.md` (index). Newest first; entry format: symptom → cause → rule.

---

## Alertmanager can return `silencedBy`/`inhibitedBy` as JSON `null` instead of `[]` — Jarvis's own API must not pass that through

**Symptom**: The e2e "none" functional suite failed almost universally
(anything needing an alert card to render) with a blank page and
`TypeError: e.status.silencedBy is not iterable` in the browser console —
unrelated-looking tests (responsive layout, detail panel, comments) all
failed the same way because they all render at least one alert.
**Cause**: `models.AlertStatus.SilencedBy`/`InhibitedBy` have no `omitempty`,
so a nil Go slice marshals to JSON `null`. Alertmanager doesn't always
populate these with `[]` for an alert matching neither — Go's JSON decoder
then leaves the field nil. The frontend unconditionally iterates
`alert.status.silencedBy` in several components (`AlertListView.tsx`,
`SilenceForm.tsx`, `lib/alertUtils.ts`, …), assuming the backend's contract
(`string[]`) always holds. Compounding this, `AlertStore`'s P4 clone step
(`append([]string(nil), s...)`) collapsed an already-non-nil-empty slice back
to nil on every `Set()` — even a correctly-enriched alert lost its `[]` the
moment it passed through the store.
**Rule**: `cluster.enrichMerged` now normalizes both fields via
`nonNilStrings` so Jarvis's own API always emits `[]`, never `null`,
regardless of what upstream Alertmanager sends. Separately, any clone helper
that copies a slice must preserve non-nil-emptiness — use
`append([]T{}, s...)` (starts from a non-nil empty slice) instead of
`append([]T(nil), s...)` (`append` with zero elements to add returns its
first argument unchanged, so a nil destination stays nil). See
`cloneSlice` in `internal/history/alert_store.go`.

---

## A route with neither `RequireAuth` nor `OptionalAuth` never gets `auth.ContextKey` — even with a valid cookie

**Symptom**: Building `GET /api/v1/settings` (deliberately unauthenticated —
it must answer `user: null` for anonymous callers too), a Playwright E2E test
showed a logged-in user's `PUT` (204, confirmed committed — the row was
present in the DB, `INSERT`ed under the correct `user_id`) "disappear" on the
very next `GET`, every time, 100% reproducible. All the *unit* tests for the
same handler passed, because they built the `echo.Context` directly with
`c.Set(auth.ContextKey, caller)` — bypassing the real middleware chain
entirely.
**Cause**: `auth.RequireAuth` is the *only* thing that calls
`c.Set(auth.ContextKey, user)`. A route registered without it — which
`GET /api/v1/settings` is, on purpose, so it can serve anonymous callers —
never populates the context, so `auth.UserFromContext(c)` returns `nil`
unconditionally, regardless of whether a valid session cookie was sent. The
handler silently treated every authenticated caller as anonymous.
**Rule**: a route that must behave differently for anonymous vs.
authenticated callers *without gating on login* needs `auth.OptionalAuth`
(added alongside this fix) — it resolves the cookie and sets `auth.ContextKey`
exactly like `RequireAuth`, but never rejects the request. And more broadly:
a handler unit test that injects `c.Set(auth.ContextKey, ...)` directly proves
the handler's *own* logic but proves nothing about whether the real
middleware chain actually populates that context for the route as registered
— for at least one test per such handler, drive a real cookie through a real
`httptest.Server` + the full router instead (see
`TestGetSettings_RealHTTPRoundTrip`, `internal/api/settings_handler_test.go`).

---

## Alerts inside a group reshuffled on every poll — frontend group flicker

**Symptom**: In a live alert group the alert rows kept changing order on
every poll refresh, producing a constant visual flicker in the list and
card-grid views.
**Cause**: `AlertStore.Get()` (`internal/history/alert_store.go`) returned
the active slice in upstream Alertmanager response order (not guaranteed
stable) and appended the resolved buffer via a **Go map range** (never
stable). `GET /api/v1/alerts`, `/api/v1/alerts/groups` and the WS
`alerts_update` broadcast all pass that snapshot straight through, and the
frontend grouping (`buildGroupsByLabel`, `AlertCardGrid`) preserves incoming
order — so a reshuffled snapshot = reshuffled group.
**Rule**: `AlertStore.Get()` sorts before returning — `startsAt` desc, then
`fingerprint` asc, then `clusterName` asc (the last two are unique + stable
per alert, so it's a total order). Any new alert-list read path relies on
this; don't re-introduce an unsorted snapshot. Bonus: it also removed the
"false changed" broadcast from resolved-buffer map ordering noted in
`broadcastAlertsIfChanged`.

---

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

---

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

---

## Proxy errors: always log the underlying Alertmanager error

**Symptom**: Silence create/delete fails with generic `502 alertmanager
request failed` and no way to diagnose why.
**Rule**: Handlers proxying to Alertmanager must `slog.Error` the underlying
error (with cluster context) before returning the sanitized HTTP error —
the response stays generic (no internal detail leaks), the log carries the
cause.

---

## A bounded per-client WS queue disconnects *healthy* clients, not just stuck ones

**Symptom**: `TestHub_SlowClientDisconnectedOnQueueOverflow` failed
intermittently in CI and 6 of 10 runs locally — on unmodified `main`, with a
zero-line Go diff. The failure was never the slow client: the *healthy* one was
dropped with `close 1006` while reading the burst.

**Cause**: `Hub.Run` classified "this client's queue is full right now" as "this
client is too slow" and disconnected it. But the hub enqueues with plain channel
sends (nanoseconds) while a client's `writePump` must do a real socket write per
message (microseconds). With a queue bounded at 4 messages, *any* burst of 5+
outran *every* client, healthy or not. Adding a concurrent reader to the test
did not help (19 of 20 runs still failed), which is what ruled out "the test is
racing by construction" and proved it was the production rule. In production
that means a burst — several claims during an incident plus an `alerts_update` —
disconnects every open tab at once, and each reconnect runs a full
`qc.invalidateQueries()`.

**Also note**: the case the disconnect existed for was already covered. A truly
stuck socket fails `writePump`'s `writeWait` (10s) deadline and is torn down
anyway; the overflow path only freed memory sooner.

**Fix**: split the two message kinds instead of counting them together.
`alerts_update` is a snapshot, so at most one is queued per client and a newer
one overwrites it in place — which serves the original memory concern better
(one alert list per client, not four). Discrete events are deltas that must not
be merged, so they get their own, deeper bound (`discreteBuffer`, 32) because
they are small. Only a full *discrete* backlog now means "not draining".

**General rule**: a queue bound expressed as a message count conflates two
different things — memory pressure (driven by payload *size*) and liveness
(driven by whether the consumer *progresses*). Bound the big, self-superseding
payloads by replacing them, and judge liveness on messages that cannot be merged
away.
