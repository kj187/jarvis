# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-12

### Added
- Initial open source release of Jarvis
- Realtime alert view via WebSocket (card and list layout)
- Persistent alert history stored in SQLite (WAL mode, single-writer)
- PostgreSQL support via DSN-based dialect detection (`JARVIS_DB_DSN=postgres://...`)
- Alert claiming — assign yourself to an alert so the team sees who is on it
- Alert comments — fingerprint-bound notes that survive restarts and re-fires
- Full label-based filtering with `=` / `!=` / `=~` / `!~` matchers, URL-serialized
- Alert detail panel (labels, annotations, firing history, statistics, AI prompt section)
- Summary/description section in alert detail panel
- Multi-cluster support via `JARVIS_CLUSTER_N_*` environment variables
- Silence management — create, edit, extend, delete; full Alertmanager proxy
- Silence history tab in alert detail panel
- Inline claim/release and silence controls in list view
- 60s grace period to prevent ghost-resolves
- Immutable append-only audit log for full alert lifecycle history
- 20-minute in-memory window for recently resolved alerts (survives brief poll gaps)
- Immediate poll trigger after silence create/edit/delete actions
- Paginated resolved view with configurable page size
- Per-state alert counts displayed in navigation pills
- User settings panel (page size, view preferences)
- Authentication via `JARVIS_AUTH_MODE` — `none` (default) or `local` (username/password)
- Login/setup UI and admin panel for local auth mode
- Dark/light theme toggle
- Responsive header with mobile hamburger menu
- Helm chart with OCI publish workflow (`oci://ghcr.io/kj187/charts/jarvis`)
- Test Alertmanager in dev compose for local development without a live cluster
- Single self-contained binary: Go backend embeds the Vite frontend build
- Distroless container image with read-only filesystem and no-new-privileges
- SBOM attestation, provenance attestation, and keyless image signing on all releases
- GitHub Actions CI pipeline (Go tests + lint + govulncheck; frontend tests + build)
- Helm chart unit tests via helm-unittest integrated into CI and pre-commit

### Fixed
- Fingerprint regex tightened to match Alertmanager's actual format
- Structured request access logging via `slog`
- CSP `connect-src` restricted to `'self'` only
- Stable sort in resolved view — tie-break by severity then alertname
- Claim release delayed by 65 s to survive grace-period re-fires
- Comment ownership checks use `user_id`; delete icon hidden for other users' comments
- Alert card and list components display correctly in light theme
- Force list view for resolved and suppressed state tabs (card layout not useful there)
- View toggle hidden when state filter is not active
- Default state filter set to `active` on bare URL load

### Security
- Per-IP rate limiting on all mutating endpoints
- Maximum length enforcement on all free-text input fields (claims, comments, silence matchers)
- Comment `DELETE` scoped to fingerprint to prevent cross-alert IDOR
- `sslmode=require` enforced in all production PostgreSQL documentation examples

[Unreleased]: https://github.com/kj187/jarvis/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/kj187/jarvis/releases/tag/v1.0.0
