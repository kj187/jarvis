# Jarvis

> **Built with AI** — Jarvis was developed entirely using AI coding assistants. This is an intentional workflow choice, not a shortcut: the codebase follows established Go and React best practices, enforces security standards through automated tooling (gosec, govulncheck, golangci-lint, pnpm audit) on every commit and in CI, and applies defense-in-depth measures (strict CSP, read-only container filesystem, no-new-privileges). See [SECURITY.md](SECURITY.md) for details.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/kj187/jarvis/actions/workflows/ci.yml/badge.svg)](https://github.com/kj187/jarvis/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/kj187/jarvis)](https://github.com/kj187/jarvis/releases/latest)
[![Go Version](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](backend/go.mod)
[![Backend Coverage](https://codecov.io/gh/kj187/jarvis/branch/main/graph/badge.svg?flag=backend)](https://codecov.io/gh/kj187/jarvis)
[![Frontend Coverage](https://codecov.io/gh/kj187/jarvis/branch/main/graph/badge.svg?flag=frontend)](https://codecov.io/gh/kj187/jarvis)

**Jarvis** is an open source web frontend for Prometheus Alertmanager — interactive, realtime, and self-hosted.

It was inspired by [Karma](https://github.com/prymitive/karma), which is a great project. However, I was missing features that matter for day-to-day on-call work: full persistence across restarts, the ability to comment on individual alerts, a claiming system so the team knows who is handling what, and a solid foundation to build further operational tooling on top of. Jarvis is the result.

![Jarvis Screenshot](docs/assets/screenshot.png)


## Why Jarvis?

Most Alertmanager UIs are read-only dashboards. Jarvis is built for teams that need to *act* on alerts, not just observe them:

- **Realtime alerts** via WebSocket — no page reload required
- **Persistent history** — full alert lifecycle stored in SQLite (firing → suppressed → resolved)
- **Claiming** — assign an alert to yourself so the team sees who is on it
- **Comments** — fingerprint-bound notes that survive restarts and re-fires
- **Alert Detail Panel** — labels, annotations, firing history, stats
- **Card and List View** — grouped by severity, sortable
- **Label-based filtering** — `=` / `!=` / `=~` / `!~` matcher chips, URL-serialized
- **Silences** — create, edit, extend, delete; full Alertmanager proxy
- **Multi-cluster** — poll multiple Alertmanager instances simultaneously
- **Grace period** — 60s ghost-resolve prevention
- **Single binary** — Go backend embeds the Vite build; one container

## Views

### Card View

Alerts grouped by severity, with inline claim and silence actions.

![Card View](docs/assets/feature-card-view.png)

The card view is the default landing page and the primary interface for active alert triage. Each card represents one alert fingerprint and is designed to give you enough context to decide what to do next — without opening a detail panel.

**What each card shows:**
- Severity badge (critical / warning / info) with color coding
- Alert name and the cluster it originates from
- All active labels as chips — clickable to instantly add a label filter
- How long the alert has been firing (e.g. "firing for 2h 14m")
- Claim banner — shows who has claimed the alert and since when, if anyone has

**Actions available directly on the card:**
- **Silence** — opens the silence form pre-filled with this alert's labels
- **Detail** — click anywhere on the alert entry to slide open the full detail panel; claim and all other actions are available there

Within each severity section, groups are sorted alphabetically by alert name. The view updates in real time via WebSocket: new alerts appear, resolved alerts disappear, and claim/silence state refreshes without any page reload.

---

### List View

Compact table layout with sortable columns — useful when dealing with many alerts at once.

![List View](docs/assets/feature-list-view.png)

The list view is optimized for situations where you have a lot of alerts and need to scan and sort quickly rather than focus on individual cards. It trades visual weight for density.

Alerts are grouped into severity sections (critical / warning / info). Within each section, groups are collapsed by alert name. Expand a group to see individual alert instances.

**Columns:**
- **Alert Name** — sortable; shows alert count per group, common labels, and cluster names
- **State** — firing / suppressed / resolved (hidden when a single state tab is active)
- **Time** — sortable; earliest start time within the group
- **Actions** — silence or expire/extend an existing silence without opening the detail panel
- **Claim** — shows how many alerts in the group have been claimed

**Sorting** is available on the **Alert Name** and **Time** columns — click a header to sort ascending, click again for descending.

Switching between card and list view is instant. The selected view mode is persisted in localStorage so your preference survives page refreshes, and URL parameters can override it for direct links.

---

### Label Filters

Chip-based label matchers (`=` `!=` `=~` `!~`) that compose into a filter expression and are serialized into the URL for sharing.

![Label Filters](docs/assets/feature-filter.png)

Jarvis exposes the full Alertmanager matcher syntax as an interactive chip UI. You do not need to know or type the syntax — you pick a label from the dropdown, choose an operator, and enter a value. The resulting matcher appears as a chip and is applied immediately.

**Supported operators:**
| Operator | Meaning |
|---|---|
| `=` | Exact match |
| `!=` | Negative exact match |
| `=~` | Regex match |
| `!~` | Negative regex match |

**How filters compose:**
- Multiple matchers are ANDed — an alert must match all chips to be shown
- Regex matchers are validated client-side before being applied
- Clicking a label chip on any alert card instantly adds an exact-match filter for that label

**URL serialization:**
The complete filter state is encoded into the URL as query parameters. This means:
- You can bookmark a filtered view and return to it directly (e.g. `?matchers=[{"name":"env","operator":"=","value":"prod"}]`)
- You can copy the URL and share it with a teammate — they land on exactly the same filtered list
- Filters survive page reloads and view mode changes

---

### User Settings

Per-user preferences stored in the browser — no server config required.

![Settings Panel](docs/assets/feature-settings-panel.png)

Open the Settings panel by clicking the **⚙ gear icon** in the top-right area of the header (next to "Create silence"). Settings are persisted in `localStorage` and apply immediately without a page reload.

#### Available settings

| Setting | Description |
|---|---|
| **Time format** | Switch between *Relative* ("6 days ago") and *Absolute* ("Jun 4, 2025, 12:30 PM") timestamps. A live preview updates as you toggle. |
| **Default view** | Choose whether the app starts in *Card* or *List* view on every page load. |
| **Resolved page size** | Number of resolved alerts shown per page (10 / 25 / 50 / 100). Set via the per-page selector in the resolved view; persisted in localStorage. |
| **Default filter** | Label matchers that are always active — see below. |
| **Default silence duration** | Pre-selected duration when the silence creation form opens (15 min to 3 days). |
| **Creator name** | Pre-fills the "Created by" field in new silences. |
| **Poll interval** | How often Jarvis polls Alertmanager — choose 5 / 10 / 15 / 20 / 25 / 30 / 60 seconds via a slider. |

#### Default filters — permanent header chips

![Locked filter chip in header](docs/assets/feature-settings-locked-filter.png)

Default filters appear as **locked chips** in the filter row of the header. They behave like regular label matchers but cannot be removed from the header — they stay active at all times, across page reloads and view changes.

A **lock icon** and dimmed appearance distinguish them from manually added filters. Hovering over a locked chip shows the tooltip: *"Default filter set in Settings — open Settings (⚙) to change or remove."*

To remove or modify a default filter, open Settings → Default Filter → click **×** on the chip, or clear the list and save.

---

### Suppressed View

Silenced alerts displayed with active silence duration and expiry time.

![Suppressed View](docs/assets/feature-suppressed.png)

Suppressed alerts are the ones currently covered by an active Alertmanager silence. Rather than hiding them entirely, Jarvis keeps them visible in a dedicated tab so the on-call engineer always has a complete picture of what is happening — including what is being intentionally ignored and why.

**Each suppressed alert shows:**
- The alert name, labels, and severity — same as the active view
- The silence that is covering it: matcher set, creator, comment, and creation time
- A countdown to silence expiry
- A direct link to edit or extend the silence

**Why this matters in practice:**
During an incident it is common to silence a group of alerts to avoid noise while working on a fix. Without a dedicated suppressed view, those alerts become invisible. If the silence expires while the underlying issue is still present, alerts suddenly re-fire and the on-call engineer may not realize they were silenced at all. Jarvis keeps this state visible and transparent at all times.

> Silences approaching expiry (≤ 15 minutes) are automatically reclassified as active — see [Expiring Silence](#expiring-silence) below.

---

### Resolved View

Full alert history persisted in SQLite — survives container restarts and Alertmanager reconnects.

![Resolved View](docs/assets/feature-resolved.png)

The resolved view is Jarvis's history log. Every alert that has ever fired is recorded in SQLite with its complete lifecycle, and the resolved view shows all alerts that have reached a `resolved` state. This is the core capability that separates Jarvis from in-memory-only UIs.

Alerts are displayed as a flat list sorted by resolution time (newest first). A **page browser** at the top and bottom allows navigation through large result sets. The **per-page selector** (10 / 25 / 50 / 100) is persisted in localStorage so your preference is remembered across sessions.

**What is stored per alert:**
- First seen timestamp (when it first fired, ever)
- Last seen timestamp (most recent firing)
- Full label set at time of firing
- All state transitions: `firing` → `suppressed` → `resolved`, with timestamps
- Occurrence count across all firings
- Comments and claim history

**Why persistence matters:**
- **Post-incident review:** After an incident you can look up exactly when an alert first fired, how long it stayed active, and how many times it re-fired before resolution — without relying on Prometheus or Grafana.
- **Noise analysis:** Recurring alerts with high occurrence counts are easy to identify and prioritize for permanent fixes.
- **Restarts are safe:** The history is not lost when Jarvis restarts, when Alertmanager is down for maintenance, or when the container is updated.
- **Grace period:** If an alert resolves and re-fires within 60 seconds (e.g. due to a missed poll), Jarvis reopens the existing event instead of creating a phantom new one — keeping the history clean.

---

### Alert Detail Panel

Per-alert drawer with labels, annotations, firing history, occurrence stats, claim ownership, silence controls, and comments.

![Alert Detail Panel](docs/assets/feature-detail-panel.png)

The detail panel is the central hub for working with a single alert. It slides in from the right side of the screen without navigating away from the alert list, so you can open it, take action, close it, and move to the next alert without losing context.

**Sections in the detail panel:**

**Labels & Annotations**
- Complete label set, rendered as key-value pairs
- All annotations, including `description` and `summary`
- Runbook link: if the alert has a `runbook` label and `JARVIS_RUNBOOK_BASE_URL` is configured, a clickable runbook button is rendered (`RUNBOOK_BASE_URL` + label value)

**Stats & Timeline**
- First seen / last seen timestamps
- Total occurrence count
- Duration of the current firing period
- Full event timeline: every state transition (`firing`, `suppressed`, `resolved`) with exact timestamps

**Claim ownership**
- Claim the alert to signal to your team that you are actively handling it
- The claim is stored in Jarvis's database and survives page refreshes and restarts
- Other team members can see who has claimed an alert on both the card and list view
- Unclaim at any time

When an alert is claimed, the owner's name appears as a chip in the detail panel header and as an "In progress" banner on the alert card. The claim history is recorded in the History table.

![Alert Detail Panel — Claimed](docs/assets/feature-detail-claimed.png)

**Silence controls**
- Create a new silence directly from the panel — the form opens pre-filled with the alert's labels
- Extend or delete an existing silence if the alert is currently suppressed

**Comments**
- Write freeform notes bound to the alert's fingerprint
- Comments persist across re-fires: if the alert resolves and fires again later, the comment history is still there
- Useful for documenting investigation steps, linking to tickets, or leaving context for the next person on-call

---

### Create Silence

Matcher builder with duration picker and a live preview of which alerts the silence will affect.

![Create Silence](docs/assets/feature-silence-create.png)

The silence creation form is designed to make it fast and safe to create silences without mistakes. The most dangerous part of silencing is being too broad — silencing more than you intended. Jarvis mitigates this with an interactive matcher builder and a live preview that shows exactly what will be silenced before you commit.

**Matcher builder:**
- Select any label key from a dropdown populated with labels from your current alerts
- Choose the operator (`=` / `!=` / `=~` / `!~`)
- Enter the value — regex values are validated immediately
- Add as many matchers as needed; all are ANDed

**Duration:**
- A days / hours / minutes spinner — set any duration you need
- Or switch to calendar mode to pick an exact end date and time
- Start time defaults to now but can be adjusted

**Live match count:**
- A counter next to the matcher rows shows how many currently firing alerts match — updates as you edit matchers
- Full affected-alert list is shown on the separate **Preview step** before submitting, so you can verify the blast radius before creating the silence

Silences are sent directly to Alertmanager via Jarvis's API proxy and are effective immediately. No need to open the native Alertmanager UI.

---

### Silence from Alert

One-click silence creation pre-filled from an alert's labels — no manual matcher entry.

![Silence from Alert](docs/assets/feature-silence-from-alert.png)

During an active incident, switching to the Alertmanager UI to create a silence costs time and focus. Jarvis eliminates this by letting you create a silence directly from any alert, with all matchers pre-filled.

**How it works:**
1. Open an alert's detail panel (or click "Silence" directly on a card)
2. The silence form opens with the alert's full label set pre-populated as exact-match matchers
3. Review the matchers — remove labels to broaden the scope, or switch to regex for flexibility
4. Set a duration and submit

**Common patterns:**
- **Precise silence:** Keep all labels → silences only this exact alert instance
- **Broader silence:** Remove `instance` label → silences all instances of this alert
- **Pattern silence:** Change `=` to `=~` on the job label → silences all alerts from a job matching a regex

The live preview updates as you modify matchers, so you always know exactly which alerts the silence will cover before creating it.

---

### Expiring Silence

Alerts with a silence that expires within 15 minutes are surfaced as active so they don't catch the team off guard.

![Expiring Silence](docs/assets/feature-alert-expiring-silence.png)

This is one of Jarvis's most operationally important behaviors, and one that does not exist in most Alertmanager frontends.

**The problem it solves:**
You create a 4-hour silence during an incident and fix the underlying issue — but the fix turns out to be incomplete. The silence expires, the alert re-fires, and the on-call engineer gets paged. In a noisy environment this is easy to miss, especially at 3am.

**What Jarvis does:**
Any alert that is currently suppressed but whose covering silence expires within **15 minutes** is automatically reclassified as active and moved to the top of the active alert list. A distinct warning indicator shows that the alert is "expiring soon" rather than freshly firing.

**This gives the on-call engineer time to:**
- Extend the silence if the fix is still in progress
- Verify that the underlying issue is actually resolved
- Hand off context to the next person before going off-call

The 15-minute threshold is intentional: long enough to act, short enough to not cause premature noise. The reclassification logic runs entirely in the frontend (`lib/alertUtils.ts`) and updates in real time as silences approach expiry.

---

### Active Silence

Suppressed alerts show the exact silence that covers them, including remaining duration.

![Active Silence](docs/assets/feature-alert-active-silence.png)

When an alert is suppressed, the question "why is this not firing?" should have an immediate, visible answer. Jarvis surfaces the complete context of the covering silence directly on the alert — no need to navigate to a separate silences page or open the native Alertmanager UI.

**What is shown for each suppressed alert:**
- **Silence ID** — with a direct link to edit it
- **Matchers** — the exact matchers that cover this alert, so you can understand the scope
- **Created by** — who created the silence and when
- **Comment** — the reason/note left when the silence was created
- **Expiry countdown** — how much time is left before the silence expires, updated in real time
- **Actions** — extend or delete the silence with a single click

**Why this matters:**
In teams with multiple on-call engineers or frequent handoffs, it is common to find an alert suppressed by a silence that nobody on the current shift remembers creating. Surfacing the full silence metadata directly on the alert makes it immediately clear what is covered, why, and for how long — without any additional navigation.

## Supported Alertmanager Versions

Jarvis uses the **Alertmanager HTTP API v2** exclusively (`/api/v2/alerts`, `/api/v2/silences`, `/api/v2/status`). API v2 was introduced in Alertmanager **0.16.0**.

| Requirement | Version |
|---|---|
| Minimum | 0.16.0 |
| Tested with | 0.27.x · 0.28.x |

Any release shipping API v2 should work. If you run into a compatibility issue with a specific version, please [open an issue](https://github.com/kj187/jarvis/issues).

## Development

> Works with both Podman and Docker — replace `podman` with `docker` in all commands if needed.

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env — set at minimum JARVIS_CLUSTER_1_ALERTMANAGER_URL

# 2. Activate pre-commit hooks (once after clone)
git config core.hooksPath .githooks

# 3. Start development stack (hot-reload)
podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173
# Backend:  http://localhost:8080

# 4. Production build
podman compose up --build -d
# http://localhost:8080
```

### Running tests

```bash
make test-all        # backend (go test -race) + frontend (vitest) + helm lint + helm unittest

make test-backend    # go test -race ./...
make test-frontend   # pnpm test (requires dev container running)
make helm-lint       # helm lint charts/jarvis/
make helm-test       # helm unittest charts/jarvis/ (requires helm-unittest plugin)
```

Helm unit tests run without a Kubernetes cluster. Install the plugin once:

```bash
helm plugin install https://github.com/helm-unittest/helm-unittest
```

## Configuration

See [.env.example](.env.example) for all options. Key settings:

| Variable | Default | Description |
|---|---|---|
| `JARVIS_PORT` | `8080` | HTTP port |
| `JARVIS_POLL_INTERVAL` | `15s` | Alertmanager poll interval |
| `JARVIS_DB_DSN` | `/data/jarvis.db` | Database DSN — SQLite file path **or** `postgres://` URL (see below) |
| `JARVIS_ALLOWED_ORIGINS` | _(same-origin)_ | Comma-separated list of allowed origins for CORS and WebSocket connections (e.g. `https://jarvis.example.com`). Only needed when the browser-visible URL differs from the backend's own host — for example during local development (`http://localhost:5173`) or when a reverse proxy rewrites the hostname. Not needed in the default single-binary production deployment, where the Go server serves the embedded frontend from the same origin. |
| `JARVIS_RUNBOOK_BASE_URL` | — | Base URL for runbook links (alert label `runbook` is appended) |
| `JARVIS_CLUSTER_1_NAME` | — | Cluster display name |
| `JARVIS_CLUSTER_1_ALERTMANAGER_URL` | — | Internal Alertmanager URL |
| `JARVIS_CLUSTER_1_PROMETHEUS_URL` | — | Internal Prometheus URL (optional) |
| `JARVIS_CLUSTER_1_HOST_ALIAS` | — | Browser-visible AM URL, if different from internal (optional) |

Add additional clusters with `JARVIS_CLUSTER_2_*`, `JARVIS_CLUSTER_3_*`, etc.

### Database

Jarvis supports two database backends — configured via `JARVIS_DB_DSN`:

**SQLite** (default — no setup required):
```env
JARVIS_DB_DSN=/data/jarvis.db
```

**PostgreSQL** (external, persistent across container recreations):
```env
JARVIS_DB_DSN=postgres://jarvis:secret@postgres:5432/jarvis?sslmode=disable
```

The dialect is detected automatically from the DSN prefix. Schema migrations run on every startup (idempotent — safe to restart). The password in `JARVIS_DB_DSN` is redacted in all log output.

> **Local testing with PostgreSQL** — use `compose.test-dependencies.yml`:
> ```bash
> podman compose -f compose.dev.yml -f compose.test-dependencies.yml up -d
> # Then set in .env:
> # JARVIS_DB_DSN=postgres://jarvis:jarvis@test-postgres:5432/jarvis?sslmode=disable
> ```

## Kubernetes / Helm

Jarvis ships a Helm chart published to GHCR as an OCI artifact alongside the Docker image. No separate Helm registry is needed.

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version <version> \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

For a full values reference, installation examples (SQLite with PVC, PostgreSQL, multi-cluster, ingress-nginx with WebSocket), and upgrade instructions see [charts/jarvis/README.md](charts/jarvis/README.md).

## Tech Stack

**Backend**: Go 1.25 · Echo v4 · SQLite / PostgreSQL (`pgx/v5`, CGO-free) · gorilla/websocket

**Frontend**: React 19 · TypeScript 5.8 · Vite 6 · Tailwind CSS v4 · Zustand v5 · TanStack Query v5

**Infrastructure**: Podman multi-stage build · distroless/static-debian12

## Documentation

- [docs/TESTING.md](docs/TESTING.md) — how to run tests
- [docs/SECURITY.md](docs/SECURITY.md) — security measures
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guidelines
- [SECURITY.md](SECURITY.md) — responsible disclosure

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on the development workflow, pull request process, and coding standards.

## License

Apache 2.0 — see [LICENSE](LICENSE)
