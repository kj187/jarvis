# Upgrade

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
