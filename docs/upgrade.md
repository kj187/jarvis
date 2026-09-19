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
`ghcr.io/kj187/jarvis:1.12.0`), then pull and recreate the service:

```bash
podman compose pull && podman compose up -d
```

Docker users can replace `podman` with `docker`. See
[Install with Compose](deploy-compose.md) for the complete setup.

### Kubernetes with Helm

Upgrade the chart separately, using the chart version from the release notes:

```bash
helm upgrade jarvis oci://ghcr.io/kj187/charts/jarvis --version 2.0.0 --reuse-values
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
