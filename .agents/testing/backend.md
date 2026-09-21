# Jarvis Tests — Backend (matrix, utilities, critical cases, memory baselines)

Part of the test reference — start at `.agents/testing.md` (index: commands, `make verify`, pre-commit, CI). Base rules live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

---

## Memory performance baselines

The opt-in memory benchmarks are the reusable starting point for investigations
into allocation volume, retained alert snapshots, resolved-history reads, and
WebSocket fanout. They live in `internal/history/memory_bench_test.go`,
`internal/api/memory_bench_test.go`, and `internal/ws/memory_bench_test.go`.
Normal `go test`, pre-commit, and CI runs compile but do not execute benchmarks;
`-bench '^BenchmarkMemory'` is required to run them.

The fixtures use the fixed UTC instant `2026-09-17T06:00:00Z`, deterministic
fingerprints and label values, four clusters, and fixed annotation sizes. Keep
setup outside the timed region and always use `b.ReportAllocs()`. Do not replace
the discarding API writer with `httptest.ResponseRecorder`: a recorder retains
the complete response and makes the test harness itself look like application
memory. Do not compare benchmark results produced with `-race`.

Resolved-history UI coverage lives in the no-auth E2E suite:
`resolved-fetch.spec.ts` verifies on-demand loading, cancellation and the
one-retry policy; `resolved-pagination.spec.ts` seeds more than two pages and
verifies bounded limit/offset requests, the dimmed page-transition state and
that the legacy full-history endpoint is never used.

For a before/after comparison:

1. Use the same commit toolchain, architecture, database, fixture size,
   concurrency, `GOGC`, and `GOMEMLIMIT`.
2. Run ten repetitions with `-benchmem -count=10`; keep `ns/op`, `B/op`, and
   `allocs/op` as separate measurements. A Go benchmark reports mean time per
   operation, not request p95.
3. Use `scripts/memory-load.mjs` for request latency distributions and concurrent
   load. It accepts loopback hosts only, consumes response bodies without retaining
   them, and stores bounded one-second summaries rather than response payloads.
4. Capture process/container memory independently at one-second resolution. The
   load generator cannot establish the server's RSS or peak memory.
5. Write raw results below gitignored `tmp/memory-results/` and record commit,
   Go version, OS/CPU, database/version, fixture size, concurrency, `GOGC`, and
   `GOMEMLIMIT` beside each run. Raw measurement output is not committed by
   default; benchmark code and changes to this procedure are.

The benchmark names are intentionally stable: `BenchmarkMemoryResolvedLegacy`,
`BenchmarkMemoryResolvedCount`, `BenchmarkMemoryResolvedPage`,
`BenchmarkMemoryResolvedPageFiltered`,
`BenchmarkMemorySnapshotCodec`, `BenchmarkMemoryLiveGET`, and
`BenchmarkMemoryBroadcast`. Count/page exercise the production store queries;
there is no measurement-only HTTP endpoint. The loopback load harness never seeds or deletes data: prepare a
disposable local/E2E database separately, and never point a destructive fixture
at a production DSN.

---

## Backend Test Matrix

| Package | Test file | What is tested |
|---|---|---|
| `internal/config` | `config_test.go` | Config parsing, cluster-N iteration, HOST_ALIAS logic, `JARVIS_PPROF_ADDR` passthrough (defaults empty, custom value round-trips — address format itself is validated by `internal/debugserver`, not here) |
| `internal/config` | `config_retention_test.go` | Retention env vars: defaults (all disabled), global→domain inheritance, per-domain override even when global is 0, comments never inherit the global, sweep-interval parsing, negative/non-integer values → startup error |
| `internal/debugserver` | `server_test.go` | P0b opt-in pprof server: empty addr disables (`New` returns `nil, nil`); rejects hostname/wildcard/non-loopback IP/zone ID/port 0/out-of-range/missing port; `Start` bind failure returned synchronously; heap/allocs/goroutine reachable, index/cmdline/profile/trace/unknown paths 404, non-GET 405; `seconds` (1..60)/`debug` (0/1/2)/`gc` (heap-only, 0/1) query validation rejects out-of-bounds values with 400 before touching the underlying `pprof.Handler`; a concurrent second profile request gets 429 (semaphore, not a queue); `Shutdown` (via ctx cancellation) stops accepting connections |
| `internal/config` | `config_fuzz_test.go` | Fuzz: `parseSecretKey` never panics/errors, hex round-trip |
| `internal/db` | `db_test.go` | `Migrate` idempotent, PRAGMA settings; `poll_snapshots` table exists after `Migrate` on PostgreSQL (`JARVIS_TEST_POSTGRES_DSN`-gated, uses `openPostgres` directly rather than dialect-dispatching `Open` — avoids a gosec G703 false-positive-in-spirit from `Open`'s SQLite branch reaching `os.MkdirAll`); the four retention-sweep indices (`idx_alert_comments_created_at`, `idx_alert_claims_released_at`, `idx_silence_events_recorded_at`, `idx_alert_fingerprints_last_seen_at`) exist on SQLite and PostgreSQL after `Migrate` — verified with `EXPLAIN (ANALYZE, BUFFERS)` against a seeded local PostgreSQL instance to confirm the planner actually picks them (`.agents/architecture.md` schema section) |
| `internal/db` | `db_fuzz_test.go` | Fuzz: `RedactDSN` never panics, password never leaks |
| `internal/cluster` | `registry_test.go` | `NewRegistry`, `Get`, `All` — single/multi-cluster |
| `internal/cluster` | `enrich_test.go` | `enrichMerged`: `@receiver` label/`Receivers` from single/multiple receivers, no source mutation, status/time fields preserved; nil `Status.SilencedBy`/`InhibitedBy` become non-nil empty slices (marshal to JSON `[]`, never `null` — `.agents/lessons.md`) |
| `internal/history` | `store_test.go` | `UpsertFingerprint`, `GetOrCreateActiveEvent`, grace period (60s), `occurrence_count` logic |
| `internal/history` | `store_postgres_test.go` | `postgresTestDSN` (skip gate), `newTestPostgresStores(t, n)` — n independent `*sql.DB` connections against one truncated PostgreSQL test database, the multi-replica situation in miniature (reused by later multi-replica-plan slices' elector/recorder/fanout tests); cancelled `VisitResolved` iteration releases a pool capped to one connection for immediate reuse |
| `internal/history` | `store_concurrency_test.go` | Critical Invariant #16: `RecordStatusChange` raced concurrently — one Store (SQLite) and 10 Stores on one PostgreSQL database (`JARVIS_TEST_POSTGRES_DSN`-gated) — exactly one resulting event row, no duplicate from a non-atomic idempotency-check-then-insert; 2 racing Postgres connections proved too narrow a window to reproduce the bug reliably (20/20 false-negative runs in development), hence 10 |
| `internal/history` | `store_extra_test.go`, `store_resolved_test.go` | `GetClaimHistory`, silence history, streaming latest-resolved selection (refire exclusion, cluster isolation, exact TTL boundaries, context/callback cancellation, JSON fallback compatibility, event-ID tie-break), `SeedResolved`, silence templates |
| `internal/history` | `store_resolved_page_test.go` | bounded Resolved pages: stable event-ID ties across pages, total, single-pass filters, invalid regex indices, past-end offsets, fingerprint detail, refire exclusion; PostgreSQL coverage is env-gated |
| `internal/history` | `store_retention_test.go` | Retention delete/detach methods (`store_retention.go`): `sweepableEventsCondition` — open firing/suppressed episode head survives any age, a superseded or resolved/expired row past cutoff is deleted; batching (1200 rows/batch 500); context-cancel stops the loop; detach nulls `event_id` only on rows referencing a soon-to-be-deleted event; released-claim/comment/silence-event cutoffs (active claims always survive); orphan fingerprint sweep (survives with any remaining event/claim/comment, deletes only true orphans past `last_seen_at` cutoff); re-fire after a full event sweep does not inflate `occurrence_count` |
| `internal/history` | `alert_store_test.go` | `Set`/`Get`/`MarkResolved`/`ExpireResolved` (thread safety via goroutines); episode timestamps and exact TTL boundary; seed remaining TTL; refire/resolve deadline replacement; active-wins and duplicate-does-not-extend rules; reset clears expiry metadata; `Get` deterministic total order (invariant #17) |
| `internal/history` | `alert_store_cache_test.go` | P4 versioned JSON cache: `EncodedSnapshot()` matches `Get()`'s content/order and reuses its cached backing array until a mutation bumps the version; every mutator that finds nothing to change (`SetActiveClaim`/`ClearActiveClaim`/`RemoveResolvedForCluster`/`RemoveByFingerprint`/`ExpireResolved` no-ops) never bumps it; `Set`/`SetActiveClaim` clone their input (Labels/Annotations/Receivers/Status slices/Claim incl. its pointer fields) so a caller mutating its own copy afterward can't affect the store; `Set` preserves non-nil-empty `Status.SilencedBy`/`InhibitedBy`/`Receivers` through its clone step instead of collapsing them back to nil (`.agents/lessons.md`); concurrent Set/SetActiveClaim/ClearActiveClaim/Get/EncodedSnapshot under `-race` |
| `internal/history` | `silence_store_test.go` | `SilenceStore`: Set/Get copy semantics, Upsert, MarkExpired, Reset, concurrent access |
| `internal/history` | `lifecycle_test.go` | Integration: FiringToResolved, SuppressedExpired, GracePeriod, ReoccurrenceAfterResolution, FullCycle |
| `internal/history` | `recorder_test.go`, `recorder_snapshot_test.go` | Diff logic and failed-fetch last-good behavior; the single resolved sweeper runs without polls and stops on cancellation; follower expiry removes store+cache entries, rejects old snapshots, and preserves episode deadlines across rebuild/promotion |
| `internal/history` | `recorder_leader_test.go` | D3-step-4 leader gating via a `fakeElector`: a follower skips `RecordStatusChange`/`RecordResolvedForCluster` (in-memory `AlertStore` still updates); the nil-elector default and an explicit leader=true elector both still write history; `reconcileStartupResolves` only runs once promoted (`reconciledClusters` guard); the delayed claim-release goroutine re-checks leadership at fire time and skips if demoted mid-delay |
| `internal/history` | `snapshot.go` / `snapshot_test.go` | `encodeSnapshot`/`decodeSnapshot` gzip'd-JSON round-trip; `decodeSnapshot` streams via `json.Decoder` directly over the `gzip.Reader` (no `io.ReadAll`) and forces a second `Decode` call so a truncated payload, a corrupted gzip trailer (CRC32/ISIZE), a trailing second JSON document, or trailing garbage are all rejected instead of silently accepted; `Store.PersistSnapshot`/`GetSnapshot`/`GetAllSnapshots`/`NotifySnapshotChanged`/`NotifyTrigger` — no-op on SQLite, persist/upsert/read-back and real `pg_notify` delivery on PostgreSQL (`JARVIS_TEST_POSTGRES_DSN`-gated, via a raw `pgx.Conn` LISTEN client independent of Recorder's own listener) |
| `internal/history` | `recorder_multireplica_test.go` | Slice-2 integration: two full `Recorder`s, each with a real `leader.PGElector`, sharing one PostgreSQL database and one fake Alertmanager (`JARVIS_TEST_POSTGRES_DSN`-gated) — exactly one polls, the follower converges via snapshots without ever touching its own `cluster.Cluster` (`MemberUpStates()` stays empty on the follower's own registry while `ClusterUpStates()` is populated from the snapshot); leader kill → follower promotes, polls, and reconciles; a resolve+refire pair straddling the handoff still reopens under the grace period (Critical Invariant #1 across a leadership change); a follower's `Trigger()` reaches the leader well under the poll interval. Each test's electors share a per-test advisory-lock namespace (`testLockID`, mirrors `internal/leader`) so the two PG test binaries don't contend over one lock (`.agents/lessons.md`); `waitFor` ceilings are 20–30s |
| `internal/history` | `recorder_snapshot_batch_test.go` | P5 follower burst-coalescing, SQLite-only (no PostgreSQL needed — exercises the goroutines directly): `followerDirtySet` dedupes/sorts/clears; four notifications within `followerBurstWindow` produce exactly one `AlertStore` rebuild, observed via its own version counter (P4); a continuous notification stream still rebuilds at least every window instead of being starved (fixed deadline, never pushed back); cancel while a burst is pending returns promptly; the independent full-resync ticker rebuilds on schedule with zero notification traffic; `runModeSupervisorWith` (instrumented fake leader/follower functions, no real elector/PostgreSQL) never starts a new mode before the previous one's slow teardown actually finished |
| `internal/history` | `claim_cluster_test.go` | Cluster-scoped claim isolation (same fingerprint in multiple clusters) |
| `internal/history` | `enrich_test.go` | Alert enrichment (active claim attachment) |
| `internal/history` | `optimization_test.go` | Query/indexing optimizations |
| `internal/history` | `time_fuzz_test.go` | Fuzz: `parseNullableTimeString` never panics, err/Valid contract |
| `internal/retention` | `sweeper_test.go` | `Sweeper`: disabled config → `Start` never calls the store; context cancelled before the first sweep stops cleanly; full sweep order + per-domain cutoffs against a `fakeStore` (comments → claims → silence events → detach → events → orphan, orphan cutoff = widest of the four); domains with no effective retention are skipped; one domain's error doesn't abort the rest; `jarvis_retention_*` metrics counted; nil `*metrics.Metrics` doesn't panic; `shouldSweep()` gated by a `fakeLeaderChecker` (nil elector always sweeps, follower never sweeps, leader sweeps) |
| `internal/leader` | `static_test.go` | `StaticElector`: always leader, `Subscribe` fires `fn(true)` synchronously |
| `internal/leader` | `postgres_test.go` | `PGElector` (`JARVIS_TEST_POSTGRES_DSN`-gated): exactly one of two electors racing the same DSN becomes leader; killing the leader's `Run` context releases the session lock and the follower is promoted within seconds; `Subscribe` fires immediately with the current (not-yet-connected `false`) state, then `true` on promotion — `[false, true]`. Each test pins its own advisory-lock namespace via `SetLockID`/`testLockID` (PID + `t.Name()` hash) so this binary and `internal/history`'s multireplica binary — run concurrently by `go test ./...` on one DB — don't serialise each other into `waitFor` timeouts (`.agents/lessons.md`); `waitFor` ceilings are 20s, a loaded-CI margin not an expected wait |
| `internal/leader` | `podlabel_test.go` | `PodLabeler` (D7): promotion issues the add merge-patch (`jarvis.kj187.de/role=leader`) with the exact method/path/`Content-Type`/bearer token/body; step-down after a promotion issues the null merge-patch; step-down *without* a prior promotion issues no request (guards against `Subscribe`'s immediate-fire initial `false`); a disabled `PodLabeler` never makes a request; `NewPodLabeler` disables itself gracefully with no ServiceAccount mount (true in every non-Kubernetes test/CI environment) |
| `internal/history` | `recorder_leader_test.go` | D3-step-4 leader gating via a `fakeElector`: a follower skips `RecordStatusChange`/`RecordResolvedForCluster` (in-memory `AlertStore` still updates); the nil-elector default and an explicit leader=true elector both still write history; `reconcileStartupResolves` only runs once promoted (`reconciledClusters` guard); the delayed claim-release goroutine re-checks leadership at fire time and skips if demoted mid-delay |
| `internal/alertmanager` | `client_test.go` | HTTP client against `httptest.NewServer` |
| `internal/alertmanager` | `auth_test.go` `oauth2_test.go` | Per-cluster upstream auth (basic/bearer/OAuth2) |
| `internal/api` | `alerts_test.go` | Alert list/detail handler; legacy resolved-history JSON streaming, bounded response writes, filters, empty result, and failures before/after response commit |
| `internal/alertfilter` | `filter_test.go`, `testdata/conformance.json` | Resolved-only RE2 matchers, receiver/pseudo-label semantics, strict `@age`, per-label search, invalid-regex indices, and the shared frontend/backend conformance corpus |
| `internal/api` | `claims_test.go` | Claim set/release handler |
| `internal/api` | `comments_test.go` | Comment create/delete handler (author-gated) |
| `internal/api` | `silences_test.go` | Silence list (snapshot-only, zero AM calls, `?cluster=` filter) + create/delete handler incl. `SilenceStore` write-through + poll trigger + silence templates CRUD + backend validation (empty/invalid matchers, endsAt checks) + AM 4xx passthrough |
| `internal/api` | `silence_validation_test.go` | `validateSilenceMatchers` (empty-string-match rule, RE2 compile), `sanitizeAMMessage`, `isUniqueViolation` |
| `internal/api` | `silence_validation_fuzz_test.go` | Fuzz: `validateSilenceMatchers` accept/reject is consistent with its own regex compilation; `sanitizeAMMessage` never panics, always bounded and newline-free |
| `internal/api` | `auth_handler_test.go` | login/logout/me/info, OIDC handlers; `/auth/me`: SSO groups only with `JARVIS_OIDC_GROUPS_CLAIM` set, e-mail from the DB (the JWT has none), internal users get no group fields, a failed lookup still returns the session fields (never a non-200) |
| `internal/api` | `oidc_flow_test.go` | OIDC state-cookie packing (`popup` / `return_to`, legacy two-field cookie) and `sanitizeReturnTo` open-redirect guard (absolute/`//`/backslash/control chars/`/auth` `/api` `/ws` paths rejected; forged cookie falls back to `/`) |
| `internal/api` | `setup_test.go` | first-run `/setup` handler (internal mode, 403 when users exist) |
| `internal/api` | `admin_handler_test.go` | admin user CRUD + role/self guards |
| `internal/api` | `clusters_test.go` | Cluster health from cached poll up-state (up/degraded/all-down/no-poll-yet), zero live `/api/v2/status` calls, single-member `members` omission |
| `internal/api` | `router_test.go` | Route registration, `/groups` before `/:fingerprint/*`, protection modes |
| `internal/api` | `fanout_dispatch.go` / (covered by `fanout_integration_test.go`) | `HandleFanoutMessage`/`HandleFanoutRef` — receiving-side dispatch for cross-pod WS mutation fanout (D4) |
| `internal/api` | `fanout_integration_test.go` | D4 integration (`JARVIS_TEST_POSTGRES_DSN`-gated): two full "pods" — own `Store`/`Hub`/`fanout.PGFanout` each, sharing one database — a real `addComment` HTTP call reaches both pods' WS clients exactly once (no echo double-delivery); a second test drives a 9000-char comment body through the same path to exercise the oversized-message Ref fallback end-to-end, including the database refetch on the receiving pod |
| `internal/auth` | `jwt_test.go` `internal_provider_test.go` `middleware_test.go` | JWT sign/verify, RequireAuth/RequireAdmin |
| `internal/auth` | `oidc_groups_test.go` | `claimStrings` (string / array / non-string items / absent / colon in the claim name) and `resolveRole` (admin group, exact match) |
| `internal/users` | `store_test.go` | User CRUD, OIDC upsert, bcrypt; IdP groups replaced on every login (also emptied); `JARVIS_TEST_POSTGRES_DSN`-gated: the `oidc_groups` migration runs twice and groups round-trip on PostgreSQL |
| `internal/settings` | `store_test.go` | `Get` on unknown user → `("", nil)` not an error; `Put`→`Get` round-trip; `Put` twice → upsert (one row, last write wins); `Delete` (no-op on unknown user); cascade delete when the owning user row is deleted |
| `internal/api` | `settings_handler_test.go` | `GET /settings` anonymous → `200 {user:null,global:{}}`; `PUT` anonymous → `401`; `PUT`→`GET` round-trip for the same user; `PUT` rejects non-object JSON (`[1,2,3]`, invalid JSON, `42`, `null`, a bare string) and bodies > 16 KiB with `400`; `PUT {}` is accepted (needed for adoption's empty-blob case); `DELETE` → `204`, subsequent `GET` → `user: null`; `TestGetSettings_RealHTTPRoundTrip` drives a real cookie through a real `httptest.Server` + full router (not the `c.Set(auth.ContextKey, ...)` shortcut the other tests use) — this is the one that catches a missing `auth.OptionalAuth` on the `GET` route (see `AGENTS.md` / `.agents/architecture.md` "Authentication & Authorization") |
| `internal/ws` | `hub_test.go` | Broadcast, client register/unregister, `jarvis_ws_broadcasts_total`, `BuildEventJSON`+`BroadcastRaw` produce the same metric label as `BroadcastJSON`; P4: a snapshot burst coalesces per client (at most one pending `alerts_update`, newest wins) so it never disconnects a draining client, discrete events are never merged and arrive in order, and a client whose discrete backlog (`discreteBuffer`, 32) fills is disconnected rather than silently losing deltas; `BroadcastRaw`/`BroadcastTyped` map any event type outside the fixed known set to the `unknown` metric label instead of creating a new one |
| `internal/fanout` | `postgres_test.go` | `PGFanout` (`JARVIS_TEST_POSTGRES_DSN`-gated): delivers to the other instance only (echo suppression via `origin`), small messages delivered inline, oversized messages (> `maxNotifyPayloadBytes`) fall back to a `Ref` instead |
| `internal/fanout` | `noop_test.go` | `NoopFanout`: `Publish` is a no-op, `Run` blocks until `ctx` is cancelled |
| `internal/metrics` | `collector_test.go` | `storeCollector` scrape-time output (`testutil.CollectAndCompare`), nil `clusterUp`, `jarvis_build_info`, duplicate-registration panic |
| `internal/metrics` | `echo_test.go` | HTTP middleware: route-pattern label (not raw path), 404 → `unmatched`, skip list (`/metrics`/`/health`/`/ws`) |

---

## Backend Test Utilities

### In-memory SQLite for DB tests

```go
// No filesystem needed — fast and isolated:
db, err := db.Open(":memory:")
```

### `httptest.NewServer` for AM client tests

```go
// Real HTTP server in test — no interface mocking of the HTTP stack:
ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(mockAlerts)
}))
defer ts.Close()
client := alertmanager.NewClient(ts.URL)
```

### `echo.NewContext` for handler tests

```go
e := echo.New()
req := httptest.NewRequest(http.MethodGet, "/api/v1/alerts", nil)
rec := httptest.NewRecorder()
c := e.NewContext(req, rec)
// call handler, check response
```

### Race Detector

```go
// For alert_store_test.go: call Set/Get from multiple goroutines simultaneously
go func() { store.Set(alerts) }()
go func() { _ = store.Get() }()
// Race detector finds data races if sync.RWMutex is missing or used incorrectly
```

---

## Critical Backend Test Cases

### Grace Period (60s) — Critical Invariant #1

```
Scenario: Alert resolved → re-fires within 60s
Expected: GetOrCreateActiveEvent returns the OLD event (reopened)
          NO new event is created
          occurrence_count is NOT incremented

Scenario: Alert resolved → re-fires after 61s
Expected: New event is created
          occurrence_count IS incremented (hadPreviousEvent = true)
```

### `occurrence_count` — Critical Invariant #2

```
First firing:              occurrence_count = 1  (on INSERT)
Second firing (new):       occurrence_count = 2  (GetOrCreateActiveEvent increments)
Third firing (new):        occurrence_count = 3
Grace period reopen:       occurrence_count unchanged (no new event)
```

### Recorder Diff Logic

```
firing → resolved:    call ResolveEvents + ReleaseClaimsForResolved
firing → suppressed:  GetOrCreateActiveEvent with status=suppressed
suppressed → firing:  write expired event + new firing event
suppressed → resolved: directly resolved, no expired event
```
