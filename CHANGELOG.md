# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial open source release of Jarvis
- Realtime alert view via WebSocket (card and list layout)
- Persistent alert history stored in SQLite (WAL mode)
- Alert claiming — assign yourself to an alert so the team sees who is on it
- Alert comments — fingerprint-bound notes that survive restarts and re-fires
- Full label-based filtering with `=` / `!=` / `=~` / `!~` matchers, URL-serialized
- Alert detail panel (labels, annotations, firing history, statistics)
- Multi-cluster support via `JARVIS_CLUSTER_N_*` environment variables
- Silence management — create, edit, extend, delete; full Alertmanager proxy
- 60s grace period to prevent ghost-resolves
- Single self-contained binary: Go backend embeds the Vite frontend build
- Distroless container image with read-only filesystem and no-new-privileges
- GitHub Actions CI pipeline (Go tests + lint + govulncheck; frontend tests + build)

[Unreleased]: https://github.com/kj187/jarvis/compare/HEAD...HEAD
