# Jarvis Lessons — Silences and settings store

Silence semantics/matching/timing, AM validation, `useSettingsStore` persistence. Part of the lessons reference — start at `.agents/lessons.md` (index). Newest first; entry format: symptom → cause → rule.

---

## `migratePersistedSettings`'s pre-v2 branch diffed raw localStorage data directly — a malformed `labelDisplay` crashed every render

**Symptom**: A `jarvis-user-settings` localStorage blob with a `labelDisplay`
missing `order` (hand-edited, or written by some other bug) produced a blank
page — `partitionLabelsForDisplay` (`lib/alertUtils.ts`) calls
`config.order.indexOf(...)` unconditionally, so `order: undefined` throws on
the very first alert card.
**Cause**: `migratePersistedSettings`'s `version < 2` branch called
`diffFromDefaults(migrateLegacyDefaultFilters(state))` directly on the raw
persisted object — `diffFromDefaults` only compares JSON against
`DEFAULT_SETTINGS`, it does no shape validation. `normalizeSettings`, which
*does* validate every field's shape (including `labelDisplay`), was never in
this path at all; the code comment even said the localStorage path was
"never normalized."
**Rule**: Never diff or spread a raw persisted/user-supplied settings blob
directly — always run it through `normalizeSettings` first, even in a
migration step that predates the current schema version. Fixed by replacing
the direct `diffFromDefaults(migrateLegacyDefaultFilters(state))` call with
`diffFromDefaults(normalizeSettings(state))` (`normalizeSettings` already
calls `migrateLegacyDefaultFilters` as its first step, so nothing is lost).
See `AGENTS.md` invariant #20.

---

## `useSettingsStore`'s zustand `persist` must not get a narrow `partialize`

**Symptom (near-miss, caught before merge)**: implementing server-side settings
persistence, the natural design was a `partialize` that only wrote the new `{anonOverrides, userMirror}` bookkeeping fields to
`localStorage['jarvis-user-settings']`, since those are conceptually "the
persisted state." That would have silently broken every existing
`frontend/e2e/functional/none/settings.spec.ts` test that reads
`JSON.parse(localStorage.getItem(...)).state.timeFormat` etc. directly — the
flat resolved fields would simply no longer be there.
**Cause**: zustand's default (no `partialize`) already persists the *entire*
store state as `state.<key>` — including derived/internal fields — and
silently drops function values on `JSON.stringify`. The old store relied on
this implicitly (flat `UserSettings` fields directly under `state`); a
narrow `partialize` trades that away for no real benefit, since the extra
fields ride along for free anyway.
**Rule**: when a store already has a "raw localStorage shape" contract that
other tests or tooling read directly, don't add `partialize`/custom `merge`
unless something must be *excluded* from persistence (e.g. genuinely
transient in-memory-only data) — letting the whole state persist keeps the
top-level shape stable and one migration step (`migrate`, keyed by
`version`) is enough to reshape an old persisted blob.

---

## A stale "active" silence can be past its `endsAt` — don't clamp the countdown

**Symptom**: The silences page showed cards badged `active` with "⚠️ In 0m",
while the freshly added "created 1d ago" line said the window was long over.
**Cause**: `ops-wirk` was unreachable, so the page served the last good poll
snapshot (AGENTS.md invariant #14) — silences frozen `active` with an
`endsAt` now hours in the past. `SilenceExpiry` rendered
`In {formatDuration(endsAt - now)}`, and `formatDuration` clamps negatives to
`0` → a permanent, misleading "In 0m".
**Rule**: `silenceTiming` (`lib/alertUtils.ts`) returns the real (possibly
negative) `remainingMs` and keeps `urgency: 'soon'` for an overdue active
silence; `silenceRemainingText` turns a negative into "⚠️ Overdue X", never a
frozen countdown. Any "time left" display must special-case `remaining <= 0`
before formatting — the number can legitimately be negative whenever a
cluster's snapshot is stale.

---

## A silence's "created" time is `updatedAt`, never `startsAt`

**Symptom**: Sorting the silences page by "Created" produced a confusing
order — a just-created silence landed in the middle of the list, not at the
top.
**Cause**: The sort read `Silence.startsAt`. In Alertmanager `startsAt` is
the *schedule start* of the mute window — it can be set well into the future
(pending silences) or slightly in the past, and is unrelated to when the
silence was actually submitted. Alertmanager exposes no dedicated created-at
field; `updatedAt` is the create-and-last-edit timestamp (editing a silence
in AM rewrites it, and also mints a new silence ID).
**Rule**: `sortSilences` in `lib/alertUtils.ts` sorts "created" by
`updatedAt`. Treat `updatedAt` as the creation time everywhere in the UI
(`SilenceLifetimeBar.tsx`, `SilenceListView.tsx`); only use `startsAt`/`endsAt` for the active mute
window. The explicit sort also takes precedence over the
active→pending→expired lifecycle order now (that order is only a
timestamp-tie breaker) — users sorting by a date expect that date to win.

---

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
(differential tests against a real Alertmanager) for the broader pattern this
guards against.

---

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

---

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

---

## Alertmanager silence "update" can return a new silence ID

**Symptom**: Editing/extending a silence leaves the old one active →
duplicate silences.
**Cause**: AM's `POST /silences` with an existing `id` may create a new
silence instead of updating in place.
**Rule**: When the returned ID differs from the submitted one, expire the old
silence (implemented in `backend/internal/api/silences.go`; documented in
`.agents/architecture.md` → API).
