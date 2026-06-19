<a name="v1.3.1"></a>
## [v1.3.1](https://github.com/kj187/jarvis/compare/v1.3.0...v1.3.1) (2026-06-19)

### Bug Fixes

* **helm:** use Recreate update strategy when SQLite PVC enabled

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

