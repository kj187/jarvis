# Jarvis

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/kj187/jarvis/actions/workflows/ci.yml/badge.svg)](https://github.com/kj187/jarvis/actions/workflows/ci.yml)

**Jarvis** is an open source web frontend for Prometheus Alertmanager — interactive, realtime, and self-hosted.

It was inspired by [Karma](https://github.com/prymitive/karma), which is a great project. However, I was missing features that matter for day-to-day on-call work: full persistence across restarts, the ability to comment on individual alerts, a claiming system so the team knows who is handling what, and a solid foundation to build further operational tooling on top of. Jarvis is the result.

> **AI Disclaimer** — Jarvis is a 100% AI vibe-coded project, created entirely with the help of AI coding assistants. It is provided as-is, without any warranty of any kind — correctness, fitness for a particular purpose, or production readiness. Use at your own risk.
>
> That said, security was taken seriously throughout: OWASP Top 10 mitigations, strict CSP, read-only container filesystem, no-new-privileges, and more. See [SECURITY.md](SECURITY.md) for the full picture.

Contributions, bug reports, and feature requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

- **Realtime alerts** via WebSocket — no page reload required
- **Persistent history** — full alert lifecycle stored in SQLite (firing → suppressed → resolved)
- **Card and List View** — grouped by severity, sortable
- **Label-based filtering** — `=` / `!=` / `=~` / `!~` matcher chips, URL-serialized
- **Alert Detail Panel** — labels, annotations, firing history, stats
- **Claiming** — assign an alert to yourself so the team sees who is on it
- **Comments** — fingerprint-bound notes that survive restarts and re-fires
- **Silences** — create, edit, extend, delete; full Alertmanager proxy
- **Multi-cluster** — poll multiple Alertmanager instances simultaneously
- **Grace period** — 60s ghost-resolve prevention
- **Single binary** — Go backend embeds the Vite build; one container

## Quick Start

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env — set at minimum JARVIS_CLUSTER_1_ALERTMANAGER_URL

# 2. Development (hot-reload)
podman compose -f compose.dev.yml up
# Frontend: http://localhost:5173
# Backend:  http://localhost:8080

# 3. Production
podman compose up --build -d
# http://localhost:8080
```

## Configuration

See [.env.example](.env.example) for all options. Key settings:

| Variable | Default | Description |
|---|---|---|
| `JARVIS_PORT` | `8080` | HTTP port |
| `JARVIS_POLL_INTERVAL` | `15s` | Alertmanager poll interval |
| `JARVIS_DB_PATH` | `/data/jarvis.db` | SQLite database path |
| `JARVIS_ALLOWED_ORIGINS` | _(same-origin)_ | CORS + WebSocket origin whitelist |
| `JARVIS_CLUSTER_1_NAME` | — | Cluster name |
| `JARVIS_CLUSTER_1_ALERTMANAGER_URL` | — | Internal Alertmanager URL |
| `JARVIS_CLUSTER_1_HOST_ALIAS` | — | Browser-visible AM URL (optional) |

Add additional clusters with `JARVIS_CLUSTER_2_*`, `JARVIS_CLUSTER_3_*`, etc.

## Tech Stack

**Backend**: Go 1.24 · Echo v4 · SQLite (modernc.org/sqlite, CGO-free) · gorilla/websocket

**Frontend**: React 19 · TypeScript 5.7 · Vite 6 · Tailwind CSS v4 · Zustand v5 · TanStack Query v5

**Infrastructure**: Podman multi-stage build · distroless/static-debian12

## Documentation

- [docs/TESTING.md](docs/TESTING.md) — how to run tests
- [docs/SECURITY.md](docs/SECURITY.md) — security measures
- [CONTRIBUTING.md](CONTRIBUTING.md) — contribution guidelines
- [SECURITY.md](SECURITY.md) — responsible disclosure

## License

[Apache 2.0](LICENSE) — Julian Kleinhans
