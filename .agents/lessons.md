# Jarvis — Lessons Learned

Durable, non-obvious insights from past debugging sessions. Check this file
before re-deriving a gotcha from scratch; add a new entry (newest first)
whenever a debugging session produces an insight that would save the next
session real time (root `AGENTS.md` → Workflow Rules #6). Keep entries short:
symptom → cause → rule. When another file owns the full detail, link it
instead of duplicating.

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
