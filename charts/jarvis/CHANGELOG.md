# Changelog — Jarvis Helm Chart

All notable changes to the Jarvis Helm chart (`oci://ghcr.io/kj187/charts/jarvis`) are documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the chart follows [Semantic Versioning](https://semver.org/). The chart version is decoupled from the Jarvis app version; `appVersion` is the image tag the chart deploys by default. The app changelog lives in the [repository root](../../CHANGELOG.md).

Every chart version lists a **Breaking Changes** section, even when there are none. A breaking change is anything that can make `helm install`/`helm upgrade` fail or change the behavior of an existing release without the user changing their values: removed or renamed values, changed defaults, new validations that reject previously accepted values, new resources that need extra permissions, or changed selector labels. A breaking change always bumps the chart's major version.

Entries up to and including 1.7.6 were reconstructed from the git history when this file was introduced; their breaking-change classification was assessed retroactively.

## [Unreleased]

### Breaking Changes

- No breaking changes.

### Added

- `clusters[].auth.*` values for per-cluster upstream Alertmanager authentication: OAuth2 client credentials, bearer token, basic auth, and custom headers — rendered as the existing `JARVIS_CLUSTER_<n>_*` variables the backend already reads. `oauth2.clientSecret`, `bearerToken` and `basicAuth.password` are stored in the chart's Secret, never the ConfigMap; `clusters[].auth.existingSecret` sources them from an externally managed Secret instead, consistent with `database.existingSecret` and `auth.existingSecret`. Setting `oauth2.clientId` without `oauth2.tokenUrl` fails the render, mirroring the backend's own startup validation instead of failing silently at runtime.

### Changed

- The Kubernetes section of [docs/authentication-alertmanager.md](../../docs/authentication-alertmanager.md) and the chart README now document `clusters[].auth.*` directly instead of the `extraEnv` workaround; `extraEnv` is kept as a documented fallback for chart versions before this one.
- The ingress section points at the new [reverse-proxy guide](../../docs/reverse-proxy.md) and states that `config.allowedOrigins` must name the URL the browser uses — the WebSocket annotations alone are not enough. Documentation only, no rendered change.
- `artifacthub.io/links`'s Documentation entry now points at the published docs site (`https://kj187.github.io/jarvis/`) instead of the `docs/` tree on GitHub, following the docs restructure into a reader-intent site. Metadata only, no rendered change.
- Comments in `values.yaml` and the template files pointing at `docs/persistence.md` now point at `docs/postgres-ha.md`, following the same restructure. Comments and a test suite name only, no rendered change.

### Fixed

- The values table in the chart README documents six values that existed but were listed nowhere: `podLabels`, `persistence.annotations`, `updateStrategy.type`, `autoscaling.minReplicas`, `autoscaling.maxReplicas` and `autoscaling.targetCPUUtilizationPercentage`. `updateStrategy.type` matters most — its auto-selection (`Recreate` with a PVC, `RollingUpdate` otherwise) was explained only in a `values.yaml` comment and therefore reached neither the website nor Artifact Hub. Documentation only, no rendered change.

## [2.0.0] - 2026-09-15

### Breaking Changes

- SQLite (`database.dsn` is a file path) combined with `replicaCount > 1` or `autoscaling.enabled` now fails the render **regardless of `persistence.enabled`**. Previously the guard only fired with a PVC, so the default emptyDir setup rendered fine — while every pod polled Alertmanager independently and kept its own divergent history. Migration: set `replicaCount: 1` or switch to PostgreSQL (`database.dsn: postgres://...`, see [docs/persistence.md](../../docs/persistence.md)). ([#194](https://github.com/kj187/jarvis/pull/194))
- `auth.provider` other than `none` now fails the render unless `auth.secretKey` or `auth.existingSecret` is set, and `auth.provider: oidc` additionally requires `auth.oidc.issuer`, `auth.oidc.clientId` and `auth.oidc.redirectUrl`. Such releases previously rendered, but the pod never started (`CreateContainerConfigError`). Migration: set the missing values. ([#193](https://github.com/kj187/jarvis/pull/193))

### Changed

- `appVersion` bumped to `1.12.0`.
- The chart now ships its own `CHANGELOG.md`; the Artifact Hub links point to both the chart and the app changelog.
- The chart is published only after the image for its `appVersion` exists — as part of an app release, or on its own for chart-only releases. The README documents the versioning rules (breaking change → major).
- `Chart.yaml` comments point to the release process at its new location (`.agents/skills/release/SKILL.md`); comment-only, no rendered change.

### Fixed

- The generated Secret renders `dsn`, `secret-key` and `oidc-client-secret` independently. Setting `database.existingSecret` no longer suppresses the auth secret key the Deployment references. ([#192](https://github.com/kj187/jarvis/pull/192))

## [1.7.6] - 2026-09-09

### Breaking Changes

No breaking changes.

### Changed

- `appVersion` bumped to `1.11.0`.

## [1.7.5] - 2026-09-05

### Breaking Changes

No breaking changes.

### Changed

- `appVersion` bumped to `1.10.1`.

## [1.7.4] - 2026-09-05

### Breaking Changes

No breaking changes.

### Changed

- `appVersion` bumped to `1.10.0`.

## [1.7.3] - 2026-08-17

### Breaking Changes

No breaking changes.

### Changed

- `appVersion` bumped to `1.9.3`.

## [1.7.2] - 2026-07-17

### Breaking Changes

No breaking changes.

### Changed

- `appVersion` bumped to `1.9.2`.

## [1.7.1] - 2026-07-16

### Breaking Changes

No breaking changes.

### Added

- `database.maxOpenConns` (default `10`) → `JARVIS_DB_MAX_OPEN_CONNS`, caps the PostgreSQL connection pool per pod. Ignored for SQLite. ([#120](https://github.com/kj187/jarvis/pull/120))

### Changed

- `appVersion` bumped to `1.9.1`.

## [1.7.0] - 2026-07-15

### Breaking Changes

- `leaderElection.podLabel.enabled` defaults to `true`: the chart now renders a `Role` (pods: `get`, `patch`) and a `RoleBinding`, and the pod mounts its ServiceAccount token (`automountServiceAccountToken: true` at pod level) so the leader can label itself. Installations whose Helm user may not create RBAC resources, or that rely on the token not being mounted, must set `leaderElection.podLabel.enabled: false`. ([#112](https://github.com/kj187/jarvis/pull/112))

### Added

- Leader pod label `jarvis.kj187.de/role=leader` (PostgreSQL multi-replica), with `POD_NAME`/`POD_NAMESPACE` injected via the Downward API. ([#112](https://github.com/kj187/jarvis/pull/112))
- `podDisruptionBudget.enabled` / `podDisruptionBudget.minAvailable` and a `topologySpreadConstraints` passthrough for HA deployments. ([#113](https://github.com/kj187/jarvis/pull/113))
- `metrics.serviceMonitor.relabelings`, `metricRelabelings`, `annotations` and `honorLabels`. ([#117](https://github.com/kj187/jarvis/pull/117))

### Changed

- `appVersion` bumped to `1.9.0`.

## [1.6.2] - 2026-07-13

### Breaking Changes

No breaking changes.

### Changed

- `appVersion` bumped to `1.8.0`.

## [1.6.1] - 2026-07-09

### Breaking Changes

No breaking changes.

### Changed

- `appVersion` bumped to `1.7.0`.

## [1.6.0] - 2026-07-04

### Breaking Changes

No breaking changes.

### Added

- Prometheus scraping for `/metrics`: an opt-in `ServiceMonitor` (`metrics.serviceMonitor.enabled`) and `prometheus.io/*` pod annotations (`metrics.podAnnotations`).
- Artifact Hub annotations (category, license, links) in `Chart.yaml`.

### Changed

- Chart versioning is decoupled from the app version: the chart is published by its own workflow on changes under `charts/` and signed keylessly with cosign. Previous chart versions were identical to the app version.
- `appVersion` bumped to `1.6.0`.

## [1.5.0] - 2026-06-26

### Breaking Changes

No breaking changes.

### Changed

- Chart README recommends PostgreSQL for Kubernetes deployments.
- `appVersion` bumped to `1.5.0`. Chart versions 1.5.1–1.5.3 only bumped `appVersion` to the matching app release.

## [1.4.0] - 2026-06-22

### Breaking Changes

No breaking changes.

### Changed

- `auth` values point to the split user-authentication docs (`docs/authentication-user.md`).
- `appVersion` bumped to `1.4.0`.

## [1.3.1] - 2026-06-19

### Breaking Changes

- SQLite with `persistence.enabled: true` combined with `replicaCount > 1` or `autoscaling.enabled` now fails the render. This was released as a patch at the time.

### Added

- `updateStrategy.type`; when empty, the Deployment strategy is auto-selected: `Recreate` with `persistence.enabled`, `RollingUpdate` otherwise.

### Fixed

- Rolling updates with an RWO volume (e.g. EBS) no longer force a volume detach that caused `SQLITE_IOERR_READ`.

### Changed

- `appVersion` bumped to `1.3.1`. Chart version 1.3.0 only bumped `appVersion`.

## [1.2.0] - 2026-06-18

### Breaking Changes

No breaking changes.

### Added

- `extraEnv`, `extraVolumes`, `extraVolumeMounts` and `serviceAccountTokenProjection` (projected, audience-scoped ServiceAccount token, e.g. for Vault/JWT). All disabled by default.

### Changed

- `appVersion` bumped to `1.2.0`. Chart version 1.1.0 only bumped `appVersion`.

## [1.0.2] - 2026-06-16

### Breaking Changes

No breaking changes (first published chart version).

### Added

- Initial chart: Deployment, Service, ConfigMap, Secret, PVC, HPA, ServiceAccount and Ingress (nginx and Traefik WebSocket examples).
- User authentication values: `auth.provider` (`none`/`internal`/`oidc`), `auth.mode` (`write_protect`/`full_protect`), `auth.secretKey`/`auth.existingSecret`, OIDC settings.
- helm-unittest suite.

Chart versions 1.0.3–1.0.5 only bumped `appVersion` to the matching app release.

[Unreleased]: https://github.com/kj187/jarvis/compare/v1.12.0...HEAD
[2.0.0]: https://github.com/kj187/jarvis/compare/v1.11.0...v1.12.0
[1.7.6]: https://github.com/kj187/jarvis/compare/v1.10.1...v1.11.0
[1.7.5]: https://github.com/kj187/jarvis/compare/v1.10.0...v1.10.1
[1.7.4]: https://github.com/kj187/jarvis/compare/v1.9.3...v1.10.0
[1.7.3]: https://github.com/kj187/jarvis/compare/v1.9.2...v1.9.3
[1.7.2]: https://github.com/kj187/jarvis/compare/v1.9.1...v1.9.2
[1.7.1]: https://github.com/kj187/jarvis/compare/v1.9.0...v1.9.1
[1.7.0]: https://github.com/kj187/jarvis/compare/v1.8.0...v1.9.0
[1.6.2]: https://github.com/kj187/jarvis/compare/v1.7.0...v1.8.0
[1.6.1]: https://github.com/kj187/jarvis/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/kj187/jarvis/compare/v1.5.3...v1.6.0
[1.5.0]: https://github.com/kj187/jarvis/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/kj187/jarvis/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/kj187/jarvis/compare/v1.3.0...v1.3.1
[1.2.0]: https://github.com/kj187/jarvis/compare/v1.1.0...v1.2.0
[1.0.2]: https://github.com/kj187/jarvis/compare/v1.0.0...v1.0.2
