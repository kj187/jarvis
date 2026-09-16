# Installation

Jarvis runs as a single container: the frontend is embedded in the Go binary,
and SQLite needs no external service. Everything below works with Podman and
Docker alike — replace `podman` with `docker` in any command.

- [Docker / Podman Compose](#docker--podman-compose) — the usual starting point
- [Kubernetes / Helm](#kubernetes--helm) — for cluster deployments
- [Verify what you are running](#verify-what-you-are-running) — signatures and SBOM
- [Upgrading](#upgrading) — what to expect between versions

This page assumes you have an Alertmanager to point Jarvis at. If you do not,
or you are still evaluating, the [local demo](demo.md) starts Jarvis and
a throwaway Alertmanager with demo alerts in five minutes.

The image tag used on this page is the current release. Available tags are
listed on the [releases page](https://github.com/kj187/jarvis/releases).

---

## Docker / Podman Compose

No clone and no build step — everything runs from the published image.

**This snippet does not start an Alertmanager.** It assumes you have one and
that Jarvis can reach it: `http://alertmanager:9093` only resolves if such a
service exists on the same compose network. Point it at your own instance
instead — and if you just want to see Jarvis working first, the
[local demo](demo.md) starts both, with demo alerts.

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
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  jarvis_data:
```

```bash
podman compose up -d
```

Jarvis is now on <http://localhost:8080>. It polls Alertmanager every 15
seconds; alerts appear without a reload.

**The volume matters.** `/data` holds the SQLite database with the alert
history, claims and comments. Without it, every restart starts from an empty
history — the alerts themselves come back from Alertmanager, but everything
Jarvis recorded about them is gone.

**At least one cluster is required.** `JARVIS_CLUSTER_1_NAME` and
`JARVIS_CLUSTER_1_ALERTMANAGER_URL` are the minimum; Jarvis refuses to start
without them. Add more clusters with `JARVIS_CLUSTER_2_*`,
`JARVIS_CLUSTER_3_*` and so on, and see
[Configuration](configuration.md) for everything else.

### Running it behind a different URL

When the browser reaches Jarvis under a name other than the backend's own
host — a reverse proxy, an ingress, a different port — set the origins that
are allowed to talk to it, otherwise the WebSocket connection is rejected:

```yaml
environment:
  JARVIS_ALLOWED_ORIGINS: https://jarvis.example.com
```

---

## Kubernetes / Helm

The Helm chart is published to GHCR as an OCI artifact next to the image, so
no separate Helm repository has to be added.

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version 2.0.0 \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

**Pick the database before you scale.** SQLite is single-replica by design.
Any `replicaCount > 1`, an HPA, or a PodDisruptionBudget needs PostgreSQL —
every pod would otherwise poll Alertmanager on its own and keep a diverging
history. The chart fails the render rather than deploying that:

```bash
helm install jarvis oci://ghcr.io/kj187/charts/jarvis \
  --version 2.0.0 \
  --set replicaCount=3 \
  --set database.dsn='postgres://jarvis:secret@postgres:5432/jarvis?sslmode=require' \
  --set clusters[0].name=production \
  --set clusters[0].alertmanagerUrl=http://alertmanager:9093
```

Leader election, snapshot distribution and failover behaviour are described in
[Persistence & high availability](persistence.md).

The full values reference and worked examples — SQLite with a PVC, PostgreSQL,
multi-cluster, ingress-nginx with WebSocket support, external secrets — live
in the [chart README](https://github.com/kj187/jarvis/blob/main/charts/jarvis/README.md).

---

## Verify what you are running

Every release ships a keyless [cosign](https://docs.sigstore.dev/) signature,
GitHub build provenance and an SPDX SBOM. Verifying is optional but cheap.

**Image signature** — use the digest from the
[release notes](https://github.com/kj187/jarvis/releases), not the tag:

```bash
cosign verify ghcr.io/kj187/jarvis@sha256:<digest> \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

**Build provenance:**

```bash
gh attestation verify oci://ghcr.io/kj187/jarvis:1.12.0 --repo kj187/jarvis
```

**Helm chart signature:**

```bash
cosign verify ghcr.io/kj187/charts/jarvis:2.0.0 \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

**SBOM** — attached to every release as `sbom.spdx.json` with its signature
bundle, and embedded in the image manifest
(`docker buildx imagetools inspect`):

```bash
cosign verify-blob sbom.spdx.json \
  --bundle sbom.spdx.json.sigstore.json \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

---

## Upgrading

Upgrading is a tag change. Pull the new image, restart, done:

```bash
podman compose pull && podman compose up -d
```

```bash
helm upgrade jarvis oci://ghcr.io/kj187/charts/jarvis --version <new-version> --reuse-values
```

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

---

## Where to go next

- [Configuration](configuration.md) — every environment variable
- [Features](features.md) — what the UI can do
- [User authentication](authentication-user.md) — login via built-in accounts or OIDC
- [Alertmanager authentication](authentication-alertmanager.md) — for a protected upstream
- [Persistence & high availability](persistence.md) — PostgreSQL, multi-replica, failover
- [Metrics](metrics.md) — the Prometheus endpoint
