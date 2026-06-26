# Jarvis E2E & Screenshot Testing

> **Audience:** developers _and_ AI agents. This file is the single source of
> truth for the isolated end-to-end (E2E) test + documentation-screenshot
> pipeline. Read it fully before touching anything under `frontend/e2e/`,
> `compose.e2e.yml`, `Containerfile.e2e`, or `scripts/e2e-run.sh`.

## TL;DR

```bash
make e2e                              # functional tests, ALL 3 auth modes (CI runs this)
make e2e-mode MODE=oidc               # functional tests, ONE mode
make e2e-screenshots                  # regenerate ALL doc screenshots (all modes)
make e2e-screenshot NAME=feature-card-view    # regenerate ONE screenshot (MODE=none default)
make e2e-screenshot NAME=auth-setup MODE=internal
make e2e-down                         # force-clean the stack if something is stuck
```

Everything runs in a **fully isolated** Podman/Docker stack with its own network
(`jarvis_e2e`) and **ephemeral** state (tmpfs). It never touches the dev stack,
your real Alertmanager, or any persistent database.

---

## Why a dedicated stack?

The old setup screenshotted the Vite dev server with **mocked** API responses.
That was brittle and untestable. The new pipeline runs the **real production
binary** (frontend embedded) against a **real Alertmanager**, polling real
alerts — so functional tests and screenshots exercise the actual system.

## Architecture

```
                 ┌──────────────────────── network: jarvis_e2e ────────────────────────┐
                 │                                                                       │
  host :8085 ───▶│  e2e-jarvis (Containerfile.e2e, -tags "prod e2e")                     │
  host :8086 ───▶│      │  JARVIS_POLL_INTERVAL=1s, SQLite on tmpfs                       │
                 │      ├─▶ e2e-alertmanager  (real Alertmanager, tmpfs)                  │
                 │      └─▶ e2e-mock-oidc      (mock OIDC server, only MODE=oidc)         │
                 │                                                                       │
                 │  e2e-playwright (mcr.microsoft.com/playwright) ── runs the specs ──────│
                 └───────────────────────────────────────────────────────────────────────┘
```

| Service | Image | Purpose |
|---|---|---|
| `e2e-jarvis` | built from `Containerfile.e2e` | Production binary + **e2e-only** seed/reset endpoints. Host port **8085**. |
| `e2e-alertmanager` | `prom/alertmanager` | Real Alertmanager. Fixtures are fired via its API v2. |
| `e2e-mock-oidc` | `ghcr.io/navikt/mock-oauth2-server` | Mock OIDC IdP (only started for `MODE=oidc`). Host port **8086**. |
| `e2e-playwright` | `mcr.microsoft.com/playwright` | Runs Playwright specs on the `jarvis_e2e` network. |

### The e2e build tag

`Containerfile.e2e` compiles with `-tags "prod e2e"`. The `e2e` tag enables
**test-only** endpoints that do **not** exist in production builds:

| Endpoint | Effect |
|---|---|
| `POST /api/v1/test/reset` | Truncate all history tables + clear in-memory store. |
| `POST /api/v1/test/seed`  | Insert resolved-alert lifecycles directly into the DB. |
| `POST /api/v1/test/claim` | Set a claim on an alert (bypasses auth). Used by `jarvis.setClaim()`. |
| `POST /api/v1/test/comment` | Add a comment to an alert (bypasses auth). Note: does **not** broadcast a WS event — use the production endpoint `/api/v1/alerts/:fingerprint/comments` when testing WebSocket behaviour. |

Implementation is split by build tag so production can never expose them:
- `backend/internal/api/testing_routes_e2e.go`  (`//go:build e2e`)
- `backend/internal/api/testing_routes_noe2e.go` (`//go:build !e2e`, no-op)
- `backend/internal/history/testing_e2e.go`      (`//go:build e2e`, `ResetForTesting` / `SeedResolvedForTesting`)

> ⚠️ **Never** deploy `jarvis-e2e:local` / the `e2e` build outside the test stack.

## The three auth modes

The stack is brought up **once per mode**. `scripts/e2e-run.sh` sets the env and
selects the matching spec folder.

| Mode | `JARVIS_AUTH_PROVIDER` / `AUTH_MODE` | Flow exercised | Spec folders |
|---|---|---|---|
| `none` | `none` / `none` | No login. NoAuthNotice modal shown. | `e2e/**/none/` |
| `internal` | `internal` / `write_protect` | First-run setup wizard + username/password login. | `e2e/**/internal/` |
| `oidc` | `oidc` / `write_protect` | Full Authorization-Code-with-PKCE flow against the mock IdP; `groups=[Administrator]` → admin role. | `e2e/**/oidc/` |

### Mock OIDC details (gotchas baked in)

- Config is **mounted as a file** (`scripts/mock-oidc-config.json` →
  `JSON_CONFIG_PATH`). Passing it via the `JSON_CONFIG` env through
  podman-compose silently drops the value — do not switch back to inline JSON.
- The claim-injecting `requestMapping` matches on **`grant_type=authorization_code`**,
  not `scope` or `client_id`. Reason: Jarvis is a confidential client and sends
  `client_id`/`secret` via the HTTP **Basic** header, and `scope` is only sent to
  `/authorize` (not `/token`). `grant_type` is the only param reliably present on
  the token request.
- `interactiveLogin: false` → the authorize endpoint auto-approves, so the
  browser flow needs no manual login page interaction.
- The OIDC issuer is the **internal** hostname `http://e2e-mock-oidc:8080/default`.
  Both Jarvis (server-side discovery) and the browser (authorize redirect) reach
  it under that name, so the `iss` claim stays consistent. Host port 8086 exists
  only for the readiness probe.

## Directory layout

```
frontend/
  playwright.e2e.config.ts              # functional config; testDir = $E2E_TEST_DIR
  playwright.screenshots.e2e.config.ts  # screenshot config; testDir = $E2E_SCREENSHOT_DIR
  e2e/
    support/
      alertmanager.ts   # AM API v2 client: fire() / clearAll()
      jarvis.ts         # Jarvis client: poll() / reset() / seedResolved()
      auth.ts           # dismissNoAuthNotice, ensureInternalAdmin, loginInternal, loginOIDC
      fixtures.ts       # test.extend (auto reset+clear per test), freezeClock, waitForActiveAlerts
    fixtures/
      alerts.ts         # kubernetesAlerts (4), manyAlerts (~14, for populated screenshots)
    functional/
      none/             # card-view, no-auth-notice
      internal/         # setup + login
      oidc/             # oidc login + admin-claim mapping
    screenshots/
      none/             # feature-*, auth-noauth-notice, screenshot
      internal/         # auth-setup, auth-login-internal, auth-user-menu, auth-admin-panel, auth-login-page
      oidc/             # oidc-authenticated, auth-login-oidc, screenshot (README hero)
```

### Conventions

- **One screenshot = one named test.** The test name is the PNG basename and the
  `-g` selector for single regeneration. Output goes to `docs/assets/<name>.png`.
- Fixtures are created **per test** via real APIs (AM for active alerts, Jarvis
  test endpoints for resolved/history). The `page` fixture auto-runs
  `am.clearAll()` + `jarvis.reset()` before every test → clean slate.
- Screenshots **freeze the clock** (`freezeClock`, Playwright `page.clock`) and
  pre-dismiss the NoAuthNotice (except the one screenshot that documents it) so
  output is deterministic.
- Use stable **`data-testid`** selectors for assertions (`alert-card`,
  `login-button`, `user-menu`). Add new ones as needed rather than relying on
  text/CSS.
- Populate screenshots with `manyAlerts` so they don't look empty.

## When to run what

| Situation | Command | Notes |
|---|---|---|
| Before pushing a UI/API change | `make e2e` | All 3 modes. Same as CI. ~few min. |
| Iterating on one mode | `make e2e-mode MODE=internal` | Fast feedback. |
| You changed a screen and a doc image is stale | `make e2e-screenshot NAME=<id> [MODE=<m>]` | Regenerate just that PNG, commit it. |
| Refreshing all docs images | `make e2e-screenshots` | Cycles all modes. |
| Stack stuck / port in use | `make e2e-down` | Force `down -v`. |

### What runs in CI

- **`make e2e` (functional, all modes)** runs in `.github/workflows/e2e.yml` on
  every PR and push to `main`, using `COMPOSE_CMD="docker compose"`.
- **Screenshots are NOT run in CI.** They are a documentation artifact; binary
  PNGs would create noisy diffs and pixel-flake. Regenerate them locally and
  commit the PNGs when the UI changes.

## Adding a new test / screenshot

1. Pick the auth mode → the matching `functional/<mode>/` or
   `screenshots/<mode>/` folder.
2. Import from `../../support/fixtures` (gives you `test`, `expect`, `am`,
   `jarvis`, `freezeClock`, `waitForActiveAlerts`) and `../../support/auth` for
   login helpers.
3. Fire fixtures → drive the UI → assert via `data-testid`. For screenshots,
   `freezeClock`, wait for the expected state, then `page.screenshot(...)`.
4. If you need a new resolved/history scenario, extend the seed payload
   (`jarvis.seedResolved([...])`) — backed by `POST /api/v1/test/seed`.
5. Run it: `make e2e-mode MODE=<m>` or `make e2e-screenshot NAME=<id> MODE=<m>`.

## Key environment variables

| Var | Set by | Meaning |
|---|---|---|
| `COMPOSE_CMD` | you / CI | `podman compose` (default) or `docker compose`. |
| `E2E_BASE_URL` | compose | Jarvis URL inside the network (`http://e2e-jarvis:8080`). |
| `E2E_ALERTMANAGER_URL` | compose | Alertmanager URL (`http://e2e-alertmanager:9093`). |
| `E2E_TEST_DIR` / `E2E_SCREENSHOT_DIR` | `e2e-run.sh` | Spec folder for the current mode. |
| `E2E_AUTH_PROVIDER` / `E2E_AUTH_MODE` | `e2e-run.sh` | Jarvis auth config per mode. |
| `E2E_OIDC_*` | `e2e-run.sh` | OIDC issuer/client/redirect/admin-claim (oidc mode). |
| `SCREENSHOTS_DIR` | compose | Where PNGs are written (`../docs/assets`). |

## Troubleshooting

- **`jarvis did not become ready`** — check `podman compose -f compose.e2e.yml logs e2e-jarvis`.
  In oidc mode this usually means discovery failed (mock not up first); the
  script starts `e2e-mock-oidc` and waits before booting Jarvis.
- **OIDC username empty / role not admin** — the token didn't get the injected
  claims. Verify `scripts/mock-oidc-config.json` still matches on `grant_type`.
- **Build error `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`** — host
  `node_modules` leaked into the build context. `.containerignore` must exclude
  `**/node_modules`.
- **`missing services [e2e-playwright]`** under podman-compose — don't put the
  playwright service behind a compose `profile`; podman-compose `run` can't see
  profiled services.

---

## Current test inventory

Quick reference: which spec file covers what. Use this to find the right place for a new test or to understand what already exists.

### Mode: `none`

| Spec file | Groups | What it covers |
|---|---|---|
| `app-shell.spec.ts` | A1–A6 | Nav-tabs, theme toggle, mobile hamburger, WS indicator, polling pause/refresh, cluster status in header |
| `card-view.spec.ts` | B1 | Card view renders polled alerts (smoke test) |
| `alerts-views.spec.ts` | B2–B6, B9 | List↔card toggle, severity ordering, card pagination, fullscreen, resolved view |
| `alerts-views-extended.spec.ts` | B7–B8, B10 | Responsive column binning, empty state, suppressed/silenced view |
| `filters.spec.ts` | C1, C10–C13 | Exact matcher + URL, state restore from URL, `?q=` search, combined search+chips |
| `filters-extended.spec.ts` | C2–C9 | `!=`/`=~`/`!~` operators, regex multi-value, label/value suggestions, label chip → filter, AND matchers, draft→promotion, remove-all, locked default chips |
| `detail-panel.spec.ts` | D1–D2, D5–D11, G2 | Open/close/URL param, labels/annotations, stats & timeline, claim set/release, comments add/delete, claim note edit, AI prompt, section collapse, extend controls |
| `detail-panel-extended.spec.ts` | D4, D12–D14 | Runbook/URL links, AI prompt collapse+copy, section collapse/expand, silence from detail panel |
| `cluster-scoping.spec.ts` | X1–X3 | Cross-cluster isolation for identical fingerprint: stats/history, comments, claims |
| `silences-page.spec.ts` | E1–E7, G1, G3 | List view persist, grouping, show/hide expired, sort, matcher filter, expiry status, re-create, expire single/group |
| `silences-form-extended.spec.ts` | F3–F16 | Operator switch, regex tags+escaping, live match count, overlap warning, zero-match warning, duration presets, spinner normalisation, inline calendar, Now/Reset, end-after-start validation, author editability, reason required, preview summary, results step |
| `silences-form-templates.spec.ts` | F1–F2, F14–F15, F17, G4–G8 | Form open/close (Cancel/ESC/backdrop), cluster guard, templates CRUD (create/apply/edit/delete) |
| `settings.spec.ts` | H1–H11 | All settings: timeFormat, defaultViewMode, resolvedPageSize, defaultFilters, silenceDuration, defaultCreatorName, pollInterval, claimAnimation, reset defaults, persistence |
| `no-auth-notice.spec.ts` | I1 | NoAuth notice appears and dismiss persists |
| `websocket.spec.ts` | J1–J4 | Reconnect indicator (force-close via patched WebSocket), `alerts_update` / `claim_set` / `claim_released` / `comment_added` live events |

### Mode: `internal`

| Spec file | Groups | What it covers |
|---|---|---|
| `login.spec.ts` | I2, I4, I6 | First-run setup + login happy path, write_protect login modal on write attempt, retry flow after modal login |
| `admin.spec.ts` | I10–I14 | Admin panel user list, add-user password validation, role change, delete confirm flow, self-row guards |

### Mode: `oidc`

| Spec file | Groups | What it covers |
|---|---|---|
| `login.spec.ts` | I3, I8–I9 | Full PKCE flow against mock IdP, admin-claim mapping, write_protect SSO modal on write attempt |
