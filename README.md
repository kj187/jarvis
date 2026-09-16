<p align="center">
  <img src="frontend/public/logo.png" alt="Jarvis logo" width="180" />
</p>

<h1 align="center">Jarvis</h1>

<p align="center"><i>Interactive, realtime, self-hosted Alertmanager UI</i></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/kj187/jarvis/releases/latest"><img src="https://img.shields.io/github/v/release/kj187/jarvis" alt="Release" /></a>
  <a href="https://github.com/kj187/jarvis/actions/workflows/ci.yml"><img src="https://github.com/kj187/jarvis/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/kj187/jarvis"><img src="https://api.scorecard.dev/projects/github.com/kj187/jarvis/badge" alt="OpenSSF Scorecard" /></a>
  <a href="https://www.bestpractices.dev/projects/13469"><img src="https://www.bestpractices.dev/projects/13469/baseline" alt="OpenSSF Baseline" /></a>
  <a href="https://codecov.io/gh/kj187/jarvis"><img src="https://codecov.io/gh/kj187/jarvis/graph/badge.svg" alt="Coverage" /></a>
</p>

**Jarvis** is an open source web frontend for Prometheus Alertmanager — interactive, realtime, and self-hosted.

It was inspired by [Karma](https://github.com/prymitive/karma), which is a great project. However, I was missing features that matter for day-to-day on-call work: full persistence across restarts, the ability to comment on individual alerts, a claiming system so the team knows who is handling what, and a solid foundation to build further operational tooling on top of. Jarvis is the result.

 ![Jarvis Screenshot](docs/assets/screenshot.png)

<p align="center">
  <a href="https://www.youtube.com/watch?v=gssfmws8B6o"><img src="https://img.youtube.com/vi/gssfmws8B6o/maxresdefault.jpg" alt="Jarvis in two and a half minutes (video)" width="720"></a>
</p>

<p align="center"><i>Two and a half minutes through Jarvis: every cluster live, the full alert history, claims and comments, and silences with a preview.</i></p>

## Why Jarvis?

Most Alertmanager UIs are read-only dashboards. Jarvis is built for teams that need to *act* on alerts, not just observe them:

- **Realtime alerts** via WebSocket — no page reload required
- **Persistent history** — full alert lifecycle stored in SQLite or PostgreSQL (firing → suppressed → resolved)
- **Claiming** — assign an alert to yourself so the team sees who is on it
- **Comments** — fingerprint-bound notes that survive restarts and re-fires
- **Alert Detail Panel** — labels, annotations, link buttons, firing history, stats, claim, comments, AI-prompt
- **Alerts & Silences pages** — dedicated nav tabs, each with card / list view and a distraction-free fullscreen mode
- **Card and List View** — custom grouping by label (toolbar **Grouped** control, searchable label picker), per-group expand/collapse, drag-and-drop section reordering, sortable list columns
- **Label-based filtering** — `=` / `!=` / `=~` / `!~` matcher chips, shareable via URL in Alertmanager matcher syntax (`?filter={severity="critical"}`)
- **Saved filters** — save your matcher chips under a name, re-apply them with one click, and mark one as the default applied when you open Jarvis; stored with your user settings
- **Silences** — dedicated management page: grouping, show/hide expired, sort, create, edit, extend, delete, re-create; full Alertmanager proxy
- **Fast-Silence** — one-click, form-free silence on any active alert; hover the button, pick a duration (5m to 1w)
- **Silence templates** — reusable matcher sets for recurring maintenance windows
- **Alert search** — full-text search across alert names and label values; results update as you type
- **Dark / Light theme** — toggle between dark and light mode; preference is persisted in localStorage
- **Multi-cluster** — poll multiple Alertmanager instances simultaneously
- **Alertmanager HA** — point one cluster at all members of an Alertmanager HA gossip cluster; alerts are deduplicated by fingerprint and the cluster stays healthy as long as any member responds
- **Per-cluster upstream auth** — authenticate against protected Alertmanagers via OAuth2 client credentials (auto-refresh), bearer token, basic auth or custom headers
- **Grace period** — ghost-resolve prevention scaled to the poll interval (`max(60s, 2 × poll interval)`)
- **Single binary** — Go backend embeds the Vite build; one container
- **User authentication** — optional UI login, three modes: `none` (open), `internal` (built-in user management with admin panel), `oidc` (Keycloak, Authentik, Dex, any OIDC provider)

Worried about feature creep? Jarvis has a deliberately focused scope — what it is and what it will never become is written down in **[docs/scope.md](docs/scope.md)**.

### Built with AI
> Jarvis was developed entirely using AI coding assistants. This is an intentional workflow choice, not a shortcut: the codebase follows established Go and React best practices, enforces security standards through automated tooling (gosec, govulncheck, golangci-lint, pnpm audit) on every commit and in CI, and applies defense-in-depth measures (strict CSP, read-only container filesystem, no-new-privileges). See [SECURITY.md](SECURITY.md) for details.

## Features

Card view, list view, label filters, saved filters, silence management, alert history, detail panel, user settings, and more — see **[docs/features.md](docs/features.md)** for the full feature reference.


## Getting Started

**No clone needed — runs entirely from the published image.**

All you need is Podman or Docker, and **a reachable Alertmanager** — the
snippet below does not start one. Replace `http://alertmanager:9093` with your
own instance; if it runs outside this compose network, use its real address.

Just looking around? [docs/demo.md](docs/demo.md) brings up Jarvis
*and* a throwaway Alertmanager filled with realistic alerts in five minutes.

```yaml
services:
  jarvis:
    image: ghcr.io/kj187/jarvis:1.12.0
    ports:
      - "8080:8080"
    volumes:
      - jarvis_data:/data
    environment:
      JARVIS_CLUSTER_1_NAME: dev
      JARVIS_CLUSTER_1_ALERTMANAGER_URL: http://alertmanager:9093
    restart: unless-stopped

volumes:
  jarvis_data:
```

```bash
podman compose up -d
```

Now open <http://localhost:8080>.

On Kubernetes, the Helm chart is published to GHCR as an OCI artifact:

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version 2.0.0 \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

The hardened compose file, Kubernetes details, signature verification and
upgrade notes are in **[docs/installation.md](docs/installation.md)**; every
environment variable is listed in
**[docs/configuration.md](docs/configuration.md)**.

## Supported Alertmanager Versions

Jarvis uses the **Alertmanager HTTP API v2** exclusively (`/api/v2/alerts`, `/api/v2/silences`, `/api/v2/status`). API v2 was introduced in Alertmanager **0.16.0**.

| Requirement | Version |
|---|---|
| Minimum | 0.16.0 |
| Tested with | 0.27.x · 0.28.x |

Any release shipping API v2 should work. If you run into a compatibility issue with a specific version, please [open an issue](https://github.com/kj187/jarvis/issues).

## Documentation

Everything below is also published at **<https://kj187.github.io/jarvis/>**.

**Getting started**

- [docs/demo.md](docs/demo.md) — try it locally: Jarvis plus a throwaway Alertmanager and 18 demo alerts, in five minutes
- [docs/installation.md](docs/installation.md) — Compose, Kubernetes/Helm, signature verification, upgrading
- [docs/configuration.md](docs/configuration.md) — every environment variable, in one place
- [docs/features.md](docs/features.md) — what the UI can do, with screenshots

**Running it**

- [docs/persistence.md](docs/persistence.md) — database backends, multi-replica HA (leader election, snapshot distribution, failover), Kubernetes deployment, SQLite → PostgreSQL migration
- [docs/authentication-user.md](docs/authentication-user.md) — user login: providers (none / internal / OIDC), first-run wizard, roles, sessions, Helm
- [docs/authentication-alertmanager.md](docs/authentication-alertmanager.md) — Alertmanager upstream auth: OAuth2 client credentials, bearer token, basic auth, custom headers
- [docs/metrics.md](docs/metrics.md) — Prometheus `/metrics` endpoint: exported metrics, scrape config, ServiceMonitor
- [docs/retention.md](docs/retention.md) — optional data-retention sweep: what gets deleted, `JARVIS_RETENTION_*` config, sweep order
- [docs/security.md](docs/security.md) — security measures
- [docs/reverse-proxy.md](docs/reverse-proxy.md) — nginx, Traefik, Caddy and ingress: allowed origins and WebSocket passthrough
- [charts/jarvis/README.md](charts/jarvis/README.md) — Helm values reference and deployment examples

**Understanding it**

- [docs/architecture.md](docs/architecture.md) — data-flow overview: who talks to whom, and when (with diagram)
- [docs/alert-lifecycle.md](docs/alert-lifecycle.md) — state machine, grace period, episodes, restart/outage guarantees (with diagram)
- [docs/scope.md](docs/scope.md) — what Jarvis is, and what it will never become

**When something is wrong**

- [docs/troubleshooting.md](docs/troubleshooting.md) — by symptom: no live updates, no alerts, startup failures, render errors
- [docs/faq.md](docs/faq.md) — the questions that come up before installing

**Contributing**

- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup, tests, pull request process
- [docs/testing-e2e.md](docs/testing-e2e.md) — E2E and screenshot stack
- [AGENTS.md](AGENTS.md) — AI-agent entry point: conventions, critical invariants, task router
- [docs/ai-agents.md](docs/ai-agents.md) — working with AI coding agents: layout, skills, tool adapters
- [SECURITY.md](SECURITY.md) — responsible disclosure

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on the development workflow, pull request process, and coding standards.

## License

Apache 2.0 — see [LICENSE](LICENSE)
