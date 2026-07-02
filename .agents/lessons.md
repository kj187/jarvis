# Jarvis — Lessons Learned

Durable, non-obvious insights from past debugging sessions. Check this file
before re-deriving a gotcha from scratch; add a new entry (newest first)
whenever a debugging session produces an insight that would save the next
session real time (root `AGENTS.md` → Workflow Rules #6). Keep entries short:
symptom → cause → rule. When another file owns the full detail, link it
instead of duplicating.

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
