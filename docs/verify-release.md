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
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

Verify GitHub's build attestation as a separate provenance check:

```bash
gh attestation verify oci://ghcr.io/kj187/jarvis:<version> --repo kj187/jarvis
```

After verification, pinning the digest in Compose or Kubernetes also prevents
the selected artifact from changing on a later pull.

## Helm chart

The OCI chart is signed independently from the app image because the two have
independent versions:

```bash
cosign verify ghcr.io/kj187/charts/jarvis:<chart-version> \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

Verifying the chart does not replace verification of the container image it
deploys; verify both artifacts.

## Software bill of materials

`sbom.spdx.json` and its signature bundle are attached to every GitHub
release. The SBOM is also embedded in the image manifest and can be inspected
with `docker buildx imagetools inspect`.

```bash
cosign verify-blob sbom.spdx.json \
  --bundle sbom.spdx.json.sigstore.json \
  --certificate-identity-regexp="https://github.com/kj187/jarvis/.*" \
  --certificate-oidc-issuer="https://token.actions.githubusercontent.com"
```

Keep the verified SBOM with your deployment evidence or feed it into your
normal vulnerability and license-policy tooling.

## Where to go next

- [Install with Compose](deploy-compose.md)
- [Install on Kubernetes](deploy-kubernetes.md)
- [Upgrade](upgrade.md)
