# Upgrade

Before changing versions, [verify the release artifacts](verify-release.md).
That page explains what signatures, provenance, and the SBOM prove, which
risks they reduce, and provides commands for both the image and Helm chart.

---

## Upgrading

Upgrading is a version change. The app image and Helm chart have independent
version numbers, so use the release notes to select both deliberately.

### Podman or Docker Compose

Change the image tag in your Compose file, then pull and recreate the service:

```bash
podman compose pull && podman compose up -d
```

Docker users can replace `podman` with `docker`. See
[Install with Compose](deploy-compose.md) for the complete setup.

### Kubernetes with Helm

Upgrade the chart separately, using the chart version from the release notes:

```bash
helm upgrade jarvis oci://ghcr.io/kj187/charts/jarvis --version <new-version> --reuse-values
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

**Downgrading is not supported.** A newer schema may contain changes an older
binary does not understand. If you need a way back, snapshot the database
before upgrading: copy the SQLite file, or take a PostgreSQL dump.

**What survives an upgrade:** everything in the database — alert history,
occurrence counts, claims, comments, saved silence templates, and user
accounts and settings when authentication is enabled. Active alerts come back
from Alertmanager on the first poll after the restart. Alerts that resolve
*during* the downtime are reconciled on startup rather than lost.

Because those records are retained **forever** by default, also review
[Data retention](retention.md) when upgrading a long-running installation.
