# Upgrade and rollback

Before changing versions, [verify the release artifacts](verify-release.md).
That page explains what signatures, provenance, and the SBOM prove, which
risks they reduce, and provides commands for both the image and Helm chart.

---

## Upgrading

Upgrading is a version change. The app image and Helm chart have independent
version numbers, so use the release notes to select both deliberately.

### Podman or Docker Compose

Change the image tag in your Compose file (the current release is
`ghcr.io/kj187/jarvis:2.0.0`), then pull and recreate the service:

```bash
podman compose pull && podman compose up -d
```

Docker users can replace `podman` with `docker`. See
[Install with Compose](deploy-compose.md) for the complete setup.

### Kubernetes with Helm

Upgrade the chart separately, using the chart version from the release notes:

```bash
helm upgrade jarvis oci://ghcr.io/kj187/charts/jarvis --version 2.1.0 --reuse-values
```

Review [Install on Kubernetes](deploy-kubernetes.md) and the
[Helm chart changelog](../charts/jarvis/CHANGELOG.md) before rollout.

**Database migrations run automatically at startup.** They are forward-only
and additive; on PostgreSQL with several replicas they are serialized, so a
rolling deploy is safe. There is no separate migration command to run.

**Read the release notes first.** Every release states its breaking changes
explicitly — the [app changelog](https://github.com/kj187/jarvis/blob/main/CHANGELOG.md)
and the [chart changelog](https://github.com/kj187/jarvis/blob/main/charts/jarvis/CHANGELOG.md)
each carry a *Breaking Changes* section, and it says "No breaking changes."
when there are none. The two version numbers are independent: the chart has
its own major version and can break while the app does not.

**Downgrading a live database is not supported.** A newer schema may contain
changes an older binary does not understand. Before upgrading, create and
validate a version-matched database backup by following
[Backup and restore](backup.md). In particular, never copy only a live SQLite
database file: Jarvis uses WAL mode and committed data may still be in the WAL.

**What survives an upgrade:** everything in the database — alert history,
occurrence counts, claims, comments, saved silence templates, and user
accounts and settings when authentication is enabled. Active alerts come back
from Alertmanager on the first poll after the restart. Alerts that resolve
*during* the downtime are reconciled on startup rather than lost.

Because those records are retained **forever** by default, also review
[Data retention](retention.md) when upgrading a long-running installation.

---

## Upgrading from 2.0.0

The following changes affect your configuration and monitoring.

**Sessions are invalidated.** Every session token (cookie) expires and users
must log in again. This happens because the session JWT now includes the
issuer (`iss`) and audience (`aud`) claims; tokens issued before this version
are rejected on the next request. Expect a brief wave of 401 errors during a
rolling deploy with mixed old and new pods.

**Logout now signs out everywhere.** When a user logs out, their token version
is bumped, which invalidates all other sessions they hold — on this pod and
every replica. If you share accounts (wallboards, dedicated login), all
devices see the logout immediately.

**No more iframe embedding.** The security headers now include `frame-ancestors
'none'` (along with `X-Frame-Options: DENY`), which prevents any embedding in
an `<iframe>`. If you embedded Jarvis in another application, this no longer
works by design.

**WebSocket connections are capped per pod.** By default, 500 concurrent
connections per pod; going over the limit returns `503`. Set
`JARVIS_WS_MAX_CONNECTIONS` if you need a different limit. Dropped connections
reconnect on their own.

**Manual polls are rate-limited.** `POST /api/v1/poll` (manual trigger) returns
`429` if called more than once every 5 seconds on the same pod. This protects
the recorder's loop and Alertmanager from being pounded by scripts. The
interval is global per pod, not per client.

**Origin checks apply to writes.** Mutating requests (`POST`, `PUT`, `PATCH`,
`DELETE`) on routes like `/api/v1/silences` now check the `Origin` header like
the WebSocket upgrade does. If you have a reverse proxy that rewrites the `Host`
header without setting `JARVIS_ALLOWED_ORIGINS`, writes fail with `403
cross-origin request rejected`. See [Running behind a proxy](reverse-proxy.md) —
the fix is the same as for dead WebSockets: set the browser's URL in
`JARVIS_ALLOWED_ORIGINS`.

**The `jarvis_snapshot_stale` metric fires on leader health too.** This metric
(and the `JarvisSnapshotStale` alert) now indicates staleness when any
configured Alertmanager cluster is unreachable — not only on followers. If you
have an alert rule for this, expect it to fire during upstream outages (by
design) and not just after Jarvis itself fails.

**Helm chart: probes now use `/health/live` and `/health/ready`.** If you
override the app image tag to an older version in the chart values, the probes
fail because those endpoints did not exist. Do not mix old app versions with
new chart versions without testing the probes first.

## Rolling back an upgrade

A rollback means restoring both the old application version and the database
backup made immediately before the upgrade. Do not start the old version
against a database already migrated by the new version.

Use this order:

1. Stop Jarvis completely. On Kubernetes, scale the deployment to zero so no
   leader or follower can migrate or write the database during restoration.
2. Restore the pre-upgrade SQLite backup or PostgreSQL dump by following
   [Backup and restore](backup.md).
3. Start the old app version. For Compose, restore the old image tag and
   recreate the service. For Helm, restore the database while Jarvis remains
   scaled to zero, then run `helm rollback` and scale the deployment back up.
4. Confirm `/health`, cluster status, polling metrics, and recent history
   before reopening normal access.

For Helm, inspect the revision and roll the release back to the version that
matches the restored database:

```bash
helm history jarvis
helm rollback jarvis <revision> --wait
```

If the previous chart revision would immediately create pods, keep the
deployment scaled to zero until the database restore is complete, then perform
the rollback and scale it to the replica count recorded before the upgrade.
