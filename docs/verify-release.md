# Verify Release Artifacts

Every Jarvis release ships a keyless [cosign](https://docs.sigstore.dev/)
signature, GitHub build provenance, and an SPDX software bill of materials
(SBOM). Verify them before installation or upgrade so you do not have to trust
an image or chart tag by name alone.

Verification answers three different questions:

- **Signature:** was this exact artifact signed by Jarvis's GitHub Actions
  release workflow, rather than an unknown identity?
- **Provenance:** was it built from the expected repository and workflow?
- **SBOM:** which packages and versions are inside the release, so you can
  audit policy and investigate a disclosed vulnerability without unpacking
  the image?

Skipping these checks leaves room for a compromised registry account, a
replaced mutable tag, or an artifact from an unexpected build process to look
like an official release. Verification does not prove that the source code is
bug-free or non-malicious; it establishes artifact identity and traceability.

## Container image

Use the immutable digest published in the
[release notes](https://github.com/kj187/jarvis/releases), not a tag:

```bash
cosign verify ghcr.io/kj187/jarvis@sha256:<digest> \
  --certificate-identity="https://github.com/kj187/jarvis/.github/workflows/release.yml@refs/tags/v<version>" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

Verify GitHub's build attestation as a separate provenance check:

```bash
gh attestation verify oci://ghcr.io/kj187/jarvis:<version> --repo kj187/jarvis
```

The identity names the exact workflow file and the release tag it ran for, so
a signature from any other workflow (such as `ci.yml`) or from a branch does
not verify. Replace `<version>` with the release version, for example
`v2.0.0`. Never loosen it to a pattern like `kj187/jarvis/.*`: that accepts
every workflow in the repository.

After verification, pinning the digest in Compose or Kubernetes also prevents
the selected artifact from changing on a later pull.

## Helm chart

The OCI chart is signed independently from the app image because the two have
independent versions:

```bash
cosign verify ghcr.io/kj187/charts/jarvis:<chart-version> \
  --certificate-identity-regexp='^https://github\.com/kj187/jarvis/\.github/workflows/chart-release\.yml@refs/(heads/main|tags/v[0-9].*)$' \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

The chart is signed by `chart-release.yml`. App releases run it from the
release tag; chart-only releases run it on `main`, so the pattern accepts
exactly those two refs and no other workflow.

Verifying the chart does not replace verification of the container image it
deploys; verify both artifacts.

## Software bill of materials

`sbom.spdx.json` and its signature bundle are attached to every GitHub
release. The SBOM is also embedded in the image manifest and can be inspected
with `docker buildx imagetools inspect`.

```bash
cosign verify-blob sbom.spdx.json \
  --bundle sbom.spdx.json.sigstore.json \
  --certificate-identity="https://github.com/kj187/jarvis/.github/workflows/release.yml@refs/tags/v<version>" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

Keep the verified SBOM with your deployment evidence or feed it into your
normal vulnerability and license-policy tooling.

## Smoke test for maintainers

`scripts/verify-release-smoke.sh [vX.Y.Z]` runs the three verifications above
against a published release and also checks that a signature identity from
another workflow (`ci.yml`) or ref is rejected. Run it after every release; it
needs network access, `cosign`, `crane` and `gh`.

## Where to go next

- [Install with Compose](deploy-compose.md)
- [Install on Kubernetes](deploy-kubernetes.md)
- [Upgrade](upgrade.md)
