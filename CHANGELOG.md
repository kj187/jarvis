<a name="v1.9.0"></a>
## [v1.9.0](https://github.com/kj187/jarvis/compare/v1.8.0...v1.9.0) (2026-07-15)

### Bug Fixes

* **db:** make RecordStatusChange transactional and lock-guarded ([#108](https://github.com/kj187/jarvis/issues/108))
* **frontend:** hide [@claimed](https://github.com/claimed)-by pseudo-label from label chips ([#107](https://github.com/kj187/jarvis/issues/107))

### Documentation

* canonical persistence guide + doc consolidation (D8) ([#116](https://github.com/kj187/jarvis/issues/116))

### Features

* **alerts:** leader-only polling + PostgreSQL snapshot distribution ([#110](https://github.com/kj187/jarvis/issues/110))
* **config:** ServiceMonitor relabelings, annotations, honorLabels ([#117](https://github.com/kj187/jarvis/issues/117))
* **config:** Helm chart HA deployment surface (PDB, topology spread) ([#113](https://github.com/kj187/jarvis/issues/113))
* **config:** leader pod label via Kubernetes API PATCH (no client-go) ([#112](https://github.com/kj187/jarvis/issues/112))
* **config:** PostgreSQL leader election + leader-gated history writes ([#109](https://github.com/kj187/jarvis/issues/109))
* **ws:** cross-pod mutation fanout via PostgreSQL LISTEN/NOTIFY ([#111](https://github.com/kj187/jarvis/issues/111))

<a name="v1.8.0"></a>
## [v1.8.0](https://github.com/kj187/jarvis/compare/v1.7.0...v1.8.0) (2026-07-13)

### Bug Fixes

* **alerts:** bucket heatmap by recorded_at instead of starts_at
* **alerts:** make alert detail panel responsive on narrow viewports
* **api:** 20-min resolved-alert removal timer no longer deletes re-fired alerts
* **config:** bump codeql-action init/autobuild/analyze together to v4.37.0 ([#105](https://github.com/kj187/jarvis/issues/105))
* **db:** scale grace period with JARVIS_POLL_INTERVAL
* **db:** reconcile alerts resolved during a Jarvis restart
* **db:** keep last-known-good alert snapshot on cluster fetch failure
* **db:** dedupe firing episodes in GetFiringStarts by starts_at

### Chores

* **deps:** bump github.com/coreos/go-oidc/v3 in /backend ([#90](https://github.com/kj187/jarvis/issues/90))
* **deps:** bump docker/build-push-action from 7.2.0 to 7.3.0 ([#93](https://github.com/kj187/jarvis/issues/93))
* **deps:** bump golang.org/x/crypto from 0.53.0 to 0.54.0 in /backend ([#92](https://github.com/kj187/jarvis/issues/92))
* **deps:** bump github/codeql-action/upload-sarif ([#89](https://github.com/kj187/jarvis/issues/89))
* **release:** prepare v1.8.0

### Documentation

* **alerts:** regenerate screenshots and rewrite detail-panel docs for tabbed layout ([#100](https://github.com/kj187/jarvis/issues/100))
* **alerts:** add full alert-lifecycle reference, fix stale 60s grace-period mentions

### Features

* **alertmanager:** identify HTTP client as Jarvis via User-Agent
* **alerts:** navigate between group siblings from the detail panel ([#103](https://github.com/kj187/jarvis/issues/103))
* **alerts:** add [@age](https://github.com/age) and [@claimed](https://github.com/claimed)-by advanced filter expressions ([#102](https://github.com/kj187/jarvis/issues/102))
* **alerts:** add Related tab to detail panel ([#101](https://github.com/kj187/jarvis/issues/101))
* **alerts:** rework comments and alert detail panel layout
* **db:** add optional data-retention sweeper ([#104](https://github.com/kj187/jarvis/issues/104))

### Security

* **api:** require auth on /ws websocket upgrade in full_protect mode ([#98](https://github.com/kj187/jarvis/issues/98))

<a name="v1.7.0"></a>
## [v1.7.0](https://github.com/kj187/jarvis/compare/v1.7.0-rc.1...v1.7.0) (2026-07-09)

### Chores

* **release:** prepare v1.7.0

### Features

* **alerts:** add alerts overview modal with top-label breakdown ([#87](https://github.com/kj187/jarvis/issues/87))

<a name="v1.7.0-rc.1"></a>
## [v1.7.0-rc.1](https://github.com/kj187/jarvis/compare/v1.6.0...v1.7.0-rc.1) (2026-07-08)

### Bug Fixes

* **alerts:** redesign Fast-Silence menu, aligned submenu icon ([#79](https://github.com/kj187/jarvis/issues/79))
* **backend:** silence staticcheck SA5011 false positive in registry_test ([#85](https://github.com/kj187/jarvis/issues/85))
* **silences:** use shared fallback refetch interval for cluster health ([#82](https://github.com/kj187/jarvis/issues/82))
* **silences:** eliminate per-client Alertmanager load ([#80](https://github.com/kj187/jarvis/issues/80))
* **silences:** edit real regex matchers as raw text instead of corrupting them ([#70](https://github.com/kj187/jarvis/issues/70))
* **silences:** fix group Fast-Silence scope and reach 100% coverage ([#69](https://github.com/kj187/jarvis/issues/69))
* **silences:** validate matchers server-side and relay AM rejections ([#68](https://github.com/kj187/jarvis/issues/68))
* **silences:** match Alertmanager's anchored-regex semantics exactly ([#67](https://github.com/kj187/jarvis/issues/67))
* **ws:** register clients synchronously to stop losing events after connect

### Chores

* **deps:** bump docker/metadata-action from 6.1.0 to 6.2.0 ([#75](https://github.com/kj187/jarvis/issues/75))
* **deps:** bump anchore/sbom-action/download-syft from 0.9.0 to 0.24.0 ([#76](https://github.com/kj187/jarvis/issues/76))
* **deps:** bump docker/setup-buildx-action from 4.1.0 to 4.2.0 ([#74](https://github.com/kj187/jarvis/issues/74))
* **deps:** bump docker/setup-qemu-action from 4.1.0 to 4.2.0 ([#73](https://github.com/kj187/jarvis/issues/73))
* **deps:** bump docker/login-action from 4.2.0 to 4.4.0 ([#72](https://github.com/kj187/jarvis/issues/72))

### Documentation

* add Mermaid diagrams for lifecycle, OIDC login, and E2E stack ([#81](https://github.com/kj187/jarvis/issues/81))
* make PR-only git workflow explicit with interactive gates for AI agents ([#60](https://github.com/kj187/jarvis/issues/60))
* define project scope, add scope gate and issue-triage command ([#58](https://github.com/kj187/jarvis/issues/58))

### Features

* **alerts:** firing-pattern heatmap for card + detail view ([#84](https://github.com/kj187/jarvis/issues/84))
* **alerts:** add group Fast-Silence and persistent bell action rail ([#61](https://github.com/kj187/jarvis/issues/61))
* **alerts:** support Alertmanager HA gossip clusters with fingerprint dedup ([#59](https://github.com/kj187/jarvis/issues/59))
* **release:** support pre-release (RC) tags in release workflow ([#86](https://github.com/kj187/jarvis/issues/86))

### Tests

* **silences:** add differential E2E specs against real Alertmanager ([#71](https://github.com/kj187/jarvis/issues/71))

<a name="v1.6.0"></a>
## [v1.6.0](https://github.com/kj187/jarvis/compare/v1.5.3...v1.6.0) (2026-07-04)

### Bug Fixes

* **api:** add cluster label to alert events, add per-cluster fetch duration
* **db:** report event creation from RecordStatusChange, fix event metric drift
* **docker:** generate release SBOM via syft directly, sync release docs
* **docker:** chart-release guard and cosign auth

### Chores

* decouple Helm chart versioning, publish and sign via own workflow
* enforce DCO sign-off on all commits via CI check
* update maintainer in Chart.yaml
* add OpenSSF Scorecard workflow
* fail release job instead of overwriting existing release
* harden workflows, move chart publishing out of release.yml
* **ci:** replace unpinned pnpm npm-install with SHA-pinned pnpm/action-setup
* **deps:** bump the minor-patch group across 1 directory with 9 updates ([#52](https://github.com/kj187/jarvis/issues/52))
* **deps:** bump azure/setup-helm from 4.3.1 to 5.0.1 ([#45](https://github.com/kj187/jarvis/issues/45))
* **deps:** bump actions/checkout from 6.0.3 to 7.0.0 ([#42](https://github.com/kj187/jarvis/issues/42))
* **deps:** bump actions/setup-go from 6.4.0 to 6.5.0 ([#46](https://github.com/kj187/jarvis/issues/46))
* **deps:** bump golangci/golangci-lint-action from 9.2.1 to 9.3.0 ([#47](https://github.com/kj187/jarvis/issues/47))
* **deps:** bump gitleaks/gitleaks-action from 2.3.9 to 3.0.0 ([#43](https://github.com/kj187/jarvis/issues/43))
* **deps-dev:** bump eslint from 9.39.4 to 10.6.0 in /frontend ([#50](https://github.com/kj187/jarvis/issues/50))
* **deps-dev:** bump [@types](https://github.com/types)/node from 25.9.3 to 26.0.1 in /frontend ([#49](https://github.com/kj187/jarvis/issues/49))
* **deps-dev:** bump jscpd from 4.2.5 to 5.0.11 in /frontend ([#51](https://github.com/kj187/jarvis/issues/51))
* **release:** prepare v1.6.0
* **security:** consolidate gosec into golangci-lint, move govulncheck to CI-only

### Documentation

* document PR-only main branch workflow
* add maintainers list and coordinated vulnerability disclosure policy
* add OpenSSF Baseline badge to README
* document the prometheus metrics endpoint
* add known gaps in E2E test coverage for future cycles
* migrate issue templates to YAML issue forms
* add code of conduct and PR process, fix README
* replace LICENSE with canonical Apache-2.0 text, add NOTICE
* add lessons.md and enforce doc-sync via PR checklist
* restructure AI agent context into AI-agnostic AGENTS.md/.agents structure
* **readme:** reorganize badges into header and tech stack sections
* **security:** make CVD timeframes best-effort and add private reporting

### Features

* **api:** instrument HTTP requests with prometheus middleware
* **api:** instrument poll cycle, error, duration and event metrics
* **api:** add prometheus metrics endpoint skeleton
* **docker:** add ServiceMonitor and prometheus.io annotations for /metrics
* **frontend:** wire up ESLint flat config as lint gate ([#53](https://github.com/kj187/jarvis/issues/53))
* **release:** fully automate /release flow with attestation and SBOM

### Tests

* add Go native fuzz targets for parser functions
* **e2e:** fix B5 spec for expand/collapse card UX

<a name="v1.5.3"></a>
## [v1.5.3](https://github.com/kj187/jarvis/compare/v1.5.2...v1.5.3) (2026-06-30)

### Bug Fixes

* update Alertmanager, Grafana, and Prometheus URLs to use localhost for local testing
* **alerts:** persist only unlocked label matchers to URL to prevent duplicates
* **api:** log underlying alertmanager error on silence create/delete
* **silences:** strip backslashes from regex matchers on silence recreate

### Documentation

* update CHANGELOG and README for v1.5.3

### Tests

* **silences:** add fixtures to reproduce silence recreate escaping

<a name="v1.5.2"></a>
## [v1.5.2](https://github.com/kj187/jarvis/compare/v1.5.1...v1.5.2) (2026-06-29)

### Bug Fixes

* **claims:** increase claimReleaseDelay from 65 s to 20 min

### Documentation

* update CHANGELOG and README for v1.5.2

### Features

* **frontend:** collapse/expand AlertCard body and show claimed count badge
* **frontend:** replace pagination with expand/collapse in grouped alert cards

<a name="v1.5.1"></a>
## [v1.5.1](https://github.com/kj187/jarvis/compare/v1.5.0...v1.5.1) (2026-06-29)

### Bug Fixes

* **silences:** skip [@receiver](https://github.com/receiver) pseudo-label when filtering silences

### Documentation

* update CHANGELOG and README for v1.5.1

<a name="v1.5.0"></a>
## [v1.5.0](https://github.com/kj187/jarvis/compare/v1.4.0...v1.5.0) (2026-06-26)

### Bug Fixes

* **alerts:** keep silence result visible after creating from a card
* **alerts:** scope history, claims, and comments by cluster
* **claims:** scope claims by cluster to prevent cross-cluster claim bleed
* **docker:** relabel gitleaks config mount for SELinux
* **e2e:** fix two screenshot spec selectors
* **e2e:** use e2e cluster for all silences in screenshot spec
* **e2e:** fix auth-login-page and auth-admin-panel screenshot specs
* **e2e:** remove ensureInternalAdmin from auth-login-page to avoid /setup rate limit
* **e2e:** fix auth-login-page firstRunRedirect and add 429 retry to ensureInternalAdmin
* **e2e:** stabilize CI image build for pnpm
* **e2e:** correct SSO button label in auth-login-oidc screenshot spec
* **e2e:** use alert-group-row testid to expand list view groups in screenshot spec
* **frontend:** remove creator name setting
* **frontend:** polish alert detail panel display
* **frontend:** improve claim badge in alert detail header
* **frontend:** restore Server icon on cluster chip in alert detail
* **frontend:** restore animated snake border on Claim button in alert detail
* **frontend:** simplify resolved list severity display
* **frontend:** use explicit Tailwind classes for link color in linkUtils
* **frontend:** widen empty matcher filter inputs
* **frontend:** stabilize detail prompt caching
* **frontend:** align nav tab labels and lower their vertical position
* **frontend:** restore active tab view mode after switching tabs
* **silences:** align card sections and compact list view
* **silences:** show add-filter control on Silences page

### Chores

* **deps:** bump github.com/coreos/go-oidc/v3 in /backend
* **deps:** bump modernc.org/sqlite from 1.52.0 to 1.53.0 in /backend
* **deps:** bump github.com/labstack/echo/v4 in /backend
* **deps:** bump actions/setup-node from 4.4.0 to 6.4.0
* **deps:** bump docker/login-action from 3.7.0 to 4.2.0
* **deps:** bump docker/metadata-action from 5.10.0 to 6.1.0
* **deps:** bump actions/upload-artifact from 4.6.2 to 7.0.1
* **deps:** bump actions/checkout from 4.3.1 to 6.0.3
* **deps-dev:** bump [@vitejs](https://github.com/vitejs)/plugin-react in /frontend
* **docker:** move Containerfile.dev to repo root, rename dev-dependencies compose

### Code Refactoring

* **frontend:** split alert detail history sections
* **frontend:** extract filter controls into chip-based MatcherChipsBar
* **frontend:** move filter and search controls out of Header into pages

### Documentation

* update CHANGELOG and README for v1.5.0
* refresh README, CONTRIBUTING, testing docs, and screenshots
* extract feature documentation to docs/features.md
* **assets:** refresh screenshots after spec and selector fixes
* **assets:** fix screenshots that previously showed empty/broken state
* **assets:** add screenshots for fullscreen and dark/light theme
* **commands:** align command docs with current test, release and config setup
* **helm:** clarify PostgreSQL recommendation for Kubernetes

### Features

* **alerts:** simplify affected-alerts display and open detail on click
* **alerts:** replace No alerts text with large empty-state icon
* **alerts:** show last-fired time in detail header
* **claims:** let claim owner edit note with immutable history
* **docker:** add healthcheck for backend service and ensure frontend waits for backend readiness
* **docs:** add Dark/Light Theme comparison and Fullscreen section
* **e2e:** add backend test fixtures for silences, comments, claims, templates
* **frontend:** add grouped toggle for card and list alerts
* **frontend:** add configurable alert grouping controls
* **frontend:** add UI store nav state and shared silence-count logic
* **frontend:** add suppressed alerts mode toggle
* **frontend:** make sheet dialogs accessible
* **frontend:** improve login and authenticated user icons
* **frontend:** add Silences page grouping, list view and fullscreen
* **frontend:** show login modal on all write actions when unauthenticated
* **silences:** add search functionality and fullscreen toggle to SilencesPage
* **silences:** show expired silence info box in card view
* **silences:** improve silence cards with re-create, label colors and duration formatting
* **silences:** make matcher and label chips truncatable
* **testing:** add E2E testing with Playwright and isolated Podman stack

### Performance Improvements

* **alerts:** paginate detail timeline on server
* **poll:** reuse connections, batch claim lookups, dedup broadcasts

### Tests

* **api:** broadcast claim over WS in e2e test endpoint
* **api:** relax poll rate limit in e2e builds
* **e2e:** align screenshot specs with docs image references
* **e2e:** fix alerts-views specs B4/B5/B9
* **e2e:** extend silences and search functional coverage
* **e2e:** cover silence actions and stabilize C11 filters
* **e2e:** add silences functional specs for page and templates
* **e2e:** add E2E specs for alerts views, detail panel, and filters
* **e2e:** fix screenshot specs and update docs for current UI
* **e2e:** add rich README hero screenshot spec in oidc mode
* **e2e:** add new spec files for extended functional coverage
* **e2e:** add Group 3 auth screenshot specs (login page, user menu, admin panel)
* **e2e:** fix detail-panel specs D2/D5/D9/D10
* **e2e:** cover silence expiry and recreate flows
* **e2e:** fix filters specs C10/C11
* **e2e:** harden silences page and complete F1 close flows
* **e2e:** fix flaky timing and extend write_protect coverage in existing specs
* **frontend:** add data-testid attributes for E2E selectors
* **frontend:** remove unit-test stack in favor of functional e2e
* **silences:** align SilenceCard and App tests with current behavior

<a name="v1.4.0"></a>
## [v1.4.0](https://github.com/kj187/jarvis/compare/v1.3.1...v1.4.0) (2026-06-22)

### Bug Fixes

* **api:** log 4xx as WARN, 5xx as ERROR in request middleware
* **auth:** improve hydrate resilience on slow backend startup
* **frontend:** ensure CI environment variable is set in docker-compose
* **frontend:** make silence calendar month arrows clickable

### Chores

* **dev:** improve docker-compose for file watching with polling support
* **git:** ignore build artifacts and npm lock file

### Documentation

* update CHANGELOG and README for v1.4.0
* **frontend:** add silence templates docs, screenshots, and fix test suite

### Features

* **alerts:** store and filter all receivers in alert history
* **api:** add REST endpoints for silence template management (CRUD)
* **auth:** map OIDC claim value to admin role
* **config:** add per-cluster Alertmanager upstream authentication
* **frontend:** add silence template management UI with tab interface
* **frontend:** add React Query hooks for silence templates
* **frontend:** add silence template types and API client
* **frontend:** show local timezone below silence time inputs
* **silences:** implement silence template CRUD store operations
* **silences:** add silence template data model and database schema

<a name="v1.3.1"></a>
## [v1.3.1](https://github.com/kj187/jarvis/compare/v1.3.0...v1.3.1) (2026-06-19)

### Bug Fixes

* **helm:** use Recreate update strategy when SQLite PVC enabled

### Documentation

* update CHANGELOG and README for v1.3.1

### Features

* **helm:** reject SQLite PVC with multiple replicas at deploy time

<a name="v1.3.0"></a>
## [v1.3.0](https://github.com/kj187/jarvis/compare/v1.2.0...v1.3.0) (2026-06-19)

### Bug Fixes

* **alerts:** correct "Last fired" when Alertmanager corrupts startsAt
* **db:** handle NULL annotations column in resolved alert scans
* **docker:** use BUILDPLATFORM for frontend/backend stages to avoid QEMU hang
* **frontend:** improve cluster badge styling in AlertDetailPanel
* **frontend:** use getFilterableLabels in Header for filter dropdown
* **screenshots:** correct localStorage key for view mode in Playwright spec
* **scripts:** keep test alerts alive until manually resolved
* **silences:** make affected alerts count larger in matcher badge
* **silences:** filter cluster labels from matcher suggestions, improve zero-match warning
* **silences:** show affected alerts panel between badge and matcher rows
* **silences:** default to all clusters selected, improve cluster chip affordance
* **silences:** remove redundant 'Click to toggle' hint from cluster section
* **silences:** expire old silence when Alertmanager returns a new ID
* **silences:** cluster chips always toggleable, spinner wrap-carry, smaller font
* **silences:** pass all available clusters to SilenceForm from AlertDetailPanel

### Code Refactoring

* **silences:** revert grouped badge, move affected panel above matchers

### Documentation

* update CHANGELOG and README for v1.3.0
* update README for silence form overhaul and AI Prompt feature

### Features

* **config:** add JARVIS_LOG_REQUESTS flag, default off
* **frontend:** show silence extend buttons for all active silences
* **silences:** add expire confirmation modal for all silence views
* **silences:** improve matcher UX with inline affected alert preview
* **silences:** standardize sheet width and improve silence section layout

<a name="v1.2.0"></a>
## [v1.2.0](https://github.com/kj187/jarvis/compare/v1.1.0...v1.2.0) (2026-06-18)

### Documentation

* update CHANGELOG and README for v1.2.0

### Features

* **helm:** add extraEnv, extraVolumes, extraVolumeMounts and projected SA token support

<a name="v1.1.0"></a>
## [v1.1.0](https://github.com/kj187/jarvis/compare/v1.0.5...v1.1.0) (2026-06-18)

### Bug Fixes

* **alerts:** fall back to [@receiver](https://github.com/receiver) label when receivers array is empty
* **frontend:** replace emoji severity labels with CSS colored dots in card grid
* **frontend:** fix hardcoded dark colors and list view hierarchy in light mode
* **frontend:** redesign light mode color palette with proper depth chain
* **frontend:** remove blue card background for claimed alerts and fix expired silence banner color
* **frontend:** redesign dark mode color palette and theme consistency
* **frontend:** use theme-aware background for claimed rows in light mode
* **frontend:** replace 'First seen' with 'Last fired' using alert.startsAt
* **frontend:** consolidate multiple group silences into single button with count
* **release:** update release body to include changelog and container image verification

### Documentation

* update CHANGELOG and README for v1.1.0

### Features

* **api:** expose build version via GET /api/v1/info
* **frontend:** add info tooltips to settings panel
* **frontend:** add setting to disable Claim button snake animation
* **frontend:** add info tooltip to claim form and refine Claim button appearance
* **frontend:** animated snake border on unclaimed Claim button
* **frontend:** make Claim and Silence action buttons more prominent
* **frontend:** add dynamic link buttons from URL-valued labels/annotations
* **frontend:** show local timezone abbreviation next to all timestamps
* **frontend:** show version badge in Settings sheet
* **history:** track externally created silences and preserve createdBy in events
* **screenshots:** add feature screenshots Playwright spec and overhaul tooling

<a name="v1.0.5"></a>
## [v1.0.5](https://github.com/kj187/jarvis/compare/v1.0.4...v1.0.5) (2026-06-16)

### Bug Fixes

* **silences:** group silence recreate prefills wrong cluster and matchers

### Documentation

* update CHANGELOG and README for v1.0.5

<a name="v1.0.4"></a>
## [v1.0.4](https://github.com/kj187/jarvis/compare/v1.0.3...v1.0.4) (2026-06-16)

### Documentation

* update CHANGELOG and README for v1.0.4

### Features

* **alerts:** inline time/silence metadata, extract link rendering to lib, fix severity header contrast

### Tests

* **alerts:** extend fire/resolve scripts with error severity alerts

<a name="v1.0.3"></a>
## [v1.0.3](https://github.com/kj187/jarvis/compare/v1.0.2...v1.0.3) (2026-06-16)

### Bug Fixes

* **alerts:** align action buttons with badge row using pr-8
* **header:** prevent cluster popover from closing on mouse gap

### Documentation

* update CHANGELOG and README for v1.0.3

### Features

* **alerts:** relocate link buttons to summary section and fix runbook URL resolution
* **alerts:** improve detail sheet header and link handling
* **alerts:** add error severity level between critical and warning
* **alerts:** inject [@receiver](https://github.com/receiver) into alert labels on fetch
* **config:** expose RunbookBaseURL via /auth/info endpoint
* **header:** improve cluster instance popover

### Tests

* **scripts:** extend fire-test-alerts with link, dashboard, and inline URL examples

<a name="v1.0.2"></a>
## [v1.0.2](https://github.com/kj187/jarvis/compare/v1.0.1...v1.0.2) (2026-06-16)

### Bug Fixes

* **api:** return empty JSON arrays instead of null for empty slices
* **docker:** strip v prefix from chart appVersion to match image tag

### Documentation

* **release:** update CHANGELOG and README for v1.0.2

<a name="v1.0.1"></a>
## [v1.0.1](https://github.com/kj187/jarvis/compare/v1.0.0...v1.0.1) (2026-06-15)

### Bug Fixes

* **docker:** use VERSION (without v-prefix) in release body pull command

### Documentation

* improve Getting Started section clarity
* add Getting Started section to README and release notes
* replace dual codecov badges with single combined coverage badge
* **release:** update CHANGELOG and README for v1.0.1
* **release:** bump README version as part of release process

### Features

* **api:** serve resolved alerts from DB instead of in-memory buffer
* **db:** add GetAllResolved for persistent resolved alert history
* **frontend:** persistent resolved alert history with correct counts

<a name="v1.0.0"></a>
## v1.0.0 (2026-06-12)

### Bug Fixes

* update exclusions section in golangci-lint configuration
* **alertmanager:** correct DELETE silence endpoint from /silences/:id to /silence/:id
* **alerts:** remove border between common labels and pagination
* **api:** enable structured request access logging via slog
* **api:** enforce max length on all free-text input fields
* **api:** add per-IP rate limiting on mutating endpoints
* **api:** tighten CSP connect-src to 'self' only
* **api:** tighten fingerprint regex to match Alertmanager's actual format
* **backend:** resolve errcheck and noctx violations (golangci-lint v2)
* **backend:** compile errors and Go 1.25 upgrade
* **ci:** lower go directive to 1.24 to unblock golangci-lint
* **ci:** pin Go to 1.25.11 to fix stdlib CVEs GO-2026-5039 and GO-2026-5037
* **ci:** remove toolchain directive and pin Go 1.25.11 in CI
* **ci:** pin helm-unittest plugin to v0.8.2, remove --verify=false
* **ci:** pin all GitHub Actions to commit SHAs via Ratchet
* **ci:** remove toolchain directive and pin golangci-lint version
* **ci:** fix failing tests and unused import errors
* **ci:** add GOPATH/bin to PATH so ratchet is found after go install
* **ci:** resolve all golangci-lint findings
* **ci:** add --verify=false to helm-unittest plugin install
* **ci:** use --ignore-scripts for pnpm + go-version-file
* **ci:** all 4 backend test failures + pnpm esbuild block + go version
* **comments:** use user_id for ownership checks; hide delete icon for others
* **comments:** scope DELETE to fingerprint to prevent cross-alert IDOR
* **config:** pin Helm v3 in CI Helm job
* **deps:** promote golang.org/x/time to direct dependency
* **dev:** fix podman rootless dev environment
* **docker:** rewrite release body step with printf; use gh cli for release creation; exclude bots from contributors
* **docker:** add SBOM attestation, provenance, and keyless image signing
* **docker:** include pnpm-workspace.yaml in Containerfile COPY step
* **docker:** replace invalid 'attestations' input with 'sbom: true' in release workflow
* **docker:** extract release notes from CHANGELOG instead of auto-generating
* **docs:** update Go version badge link in README.md
* **docs:** update Go version badge format in README.md
* **docs:** replace sslmode=disable with sslmode=require in production examples
* **frontend:** resolved list view — remove dimming, actions and claim columns
* **frontend:** remove unused imports and add vite-env.d.ts
* **frontend:** fix alert components for light theme
* **frontend:** remove unused DEFAULT_SETTINGS import in SettingsSheet
* **frontend:** hide view toggle when state filter is not active
* **frontend:** rename AlertCircle → CircleAlert for lucide-react 1.x
* **frontend:** stable sort in resolved view — tie-break by severity then alertname
* **frontend:** force list view for resolved and suppressed state tabs
* **history:** delay claim release by 65s to survive grace-period re-fires
* **security:** update Go toolchain to 1.25.11 to fix stdlib CVEs
* **tests:** repair 4 failing CI tests
* **ui:** break infinite loop in alert count sync effect
* **ui:** remove double scrollbar in Sheet, add consistent scrollbar styling
* **ui:** hide stale endsAt countdown for resolved alerts in AlertCard
* **ui:** default state filter to active on bare URL load
* **ui:** guard byState access with optional chaining

### Chores

* switch license from MIT to Apache 2.0
* add CHANGELOG.md and renovate.json
* ignore *.tsbuildinfo build artifacts
* add GitHub issue templates and PR template
* remove initial development plan
* move git permissions to settings.local.json
* **config:** add Copilot instructions symlink and switch Dependabot to daily
* **deps:** bump github.com/labstack/echo/v4 in /backend
* **deps:** bump docker/build-push-action from 6 to 7
* **deps:** bump golang.org/x/crypto from 0.50.0 to 0.53.0 in /backend ([#16](https://github.com/kj187/jarvis/issues/16))
* **deps:** bump sigstore/cosign-installer from 3.9.1 to 4.1.2 ([#20](https://github.com/kj187/jarvis/issues/20))
* **deps:** replace Renovate with Dependabot
* **deps:** bump actions/setup-go from 5.6.0 to 6.4.0 ([#19](https://github.com/kj187/jarvis/issues/19))
* **deps:** update GitHub Actions and Go dependencies
* **deps:** bump docker/setup-qemu-action from 3.7.0 to 4.1.0 ([#17](https://github.com/kj187/jarvis/issues/17))
* **deps:** bump codecov/codecov-action from 4.6.0 to 7.0.0 ([#18](https://github.com/kj187/jarvis/issues/18))
* **deps:** bump github/codeql-action from 3.36.2 to 4.36.2 ([#15](https://github.com/kj187/jarvis/issues/15))
* **deps:** bump modernc.org/sqlite from 1.34.5 to 1.52.0 in /backend
* **deps:** bump softprops/action-gh-release from 2 to 3
* **deps:** bump lucide-react from 0.511.0 to 1.17.0 in /frontend
* **deps:** bump dorny/test-reporter from 1 to 3
* **deps:** bump docker/setup-buildx-action from 3 to 4
* **deps:** bump the minor-patch group in /frontend with 2 updates
* **deps-dev:** bump [@types](https://github.com/types)/node from 22.19.19 to 25.9.2 in /frontend
* **deps-dev:** bump jsdom from 26.1.0 to 29.1.1 in /frontend
* **deps-dev:** bump [@vitejs](https://github.com/vitejs)/plugin-react in /frontend
* **deps-dev:** bump vite from 6.4.3 to 8.0.16 in /frontend ([#23](https://github.com/kj187/jarvis/issues/23))
* **deps-dev:** bump [@types](https://github.com/types)/node in /frontend in the minor-patch group ([#22](https://github.com/kj187/jarvis/issues/22))
* **deps-dev:** bump typescript from 5.9.3 to 6.0.3 in /frontend ([#25](https://github.com/kj187/jarvis/issues/25))
* **dev:** consolidate test dependencies into single compose file
* **docs:** expand development workflow in CLAUDE.md and add command frontmatter
* **github:** improve open source project hygiene
* **make:** rename targets and add screenshots target

### Code Refactoring

* **alerts:** move filters and alert count to header store
* **history:** replace episode model with immutable append-only audit log
* **ui:** extract labelColorStyle to LabelChip and deduplicate claim invalidation
* **ui:** improve column distribution logic in AlertCardGrid
* **ui:** remove redundant Alerts nav button, simplify Header
* **ui:** extract LabelChip and silence helpers to shared modules

### Documentation

* document PostgreSQL support, resolved pagination, and update screenshots
* update CHANGELOG for v1.0.0
* add claude code skills and mark plan as completed
* update CHANGELOG for v1.0.0
* update CLAUDE.md with release workflow and Dependabot; add tmp/ to .gitignore
* add authentication reference and update project docs
* expand README with feature documentation and screenshots
* refresh screenshots and update README
* **auth:** add UI screenshots to authentication docs
* **frontend:** document search and theme; rename silence comment label to reason
* **helm:** add Traefik WebSocket ingress example alongside nginx
* **readme:** add prominent no-auth warning and deployment security section
* **readme:** remove authentication warning and emphasize security measures
* **readme:** add authentication to Why Jarvis feature list

### Features

* initial Jarvis implementation
* **alerts:** unique per-label colors via HSL hash
* **alerts:** redesign AlertCard with grouped entries, label chips, and pagination
* **alerts:** compact masonry layout with greedy bin-packing
* **alerts:** show common group labels in card header
* **alerts:** make claimed alerts visually prominent
* **alerts:** replace nested entry cards with divide-y row layout
* **alerts:** move pagination above entries, remove hint text
* **api:** enforce authentication on write endpoints
* **api:** wire auth provider into server, router, and config
* **auth:** add JARVIS_AUTH_MODE for configurable protection level
* **auth:** add authentication infrastructure
* **backend:** immediate poll trigger and silence event audit log
* **db:** add users table migration
* **db:** add PostgreSQL support via DSN-based dialect detection
* **dev:** add test Alertmanager for local development
* **docker:** add container image and cosign verify block to GitHub Release body
* **frontend:** SilenceForm redesign, silence history tab, AlertDetailPanel overhaul
* **frontend:** make header responsive with mobile hamburger menu
* **frontend:** add dark/light theme toggle
* **frontend:** integrate auth into alert UI components
* **frontend:** add user settings panel and flat resolved view
* **frontend:** add auth store, login/setup UI, and admin panel
* **frontend:** add summary/description section to alert detail panel
* **frontend:** paginated resolved view with configurable page size
* **header:** redesign header UX with inline filter editing and live poll indicator
* **helm:** add Helm chart and OCI publish workflow
* **helm:** add auth configuration to Helm chart
* **history:** preserve resolved alerts in-memory for 20-minute window
* **history:** seed resolved alerts on startup and expose lastResolvedAt
* **ui:** move view toggle next to state nav, show per-state counts in pills
* **ui:** improve silence form label autocomplete and affected badge
* **ui:** rewrite AlertListView with severity sections and expandable groups
* **ui:** add inline claim/release and silence controls to AlertListRow
* **ui:** add AI prompt section and paginated history in AlertDetailPanel
* **ui:** replace Silences nav with inline Silence button, default active filter

### Security

* add gitleaks secret scanning

### Tests

* **backend:** add test coverage for api, cluster, and history packages
* **frontend:** add comprehensive unit tests for components, hooks, store, and utils
* **helm:** add helm-unittest suite and integrate into Makefile, pre-commit, CI
* **history:** add lifecycle integration tests for immutable audit log

