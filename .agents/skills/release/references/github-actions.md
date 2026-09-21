# What GitHub Actions does automatically (after tag push)

Background reference for `.agents/skills/release/SKILL.md` — read this when
debugging a failed release workflow run (step 18/19), not during a normal
release.

From `.github/workflows/release.yml`:

Three jobs, strictly in this order — a failure stops everything after it, so
neither a chart nor a GitHub Release ever points at an image that wasn't
built.

**Job `build-and-push`:**
1. Derive image tags via `docker/metadata-action` → `{{version}}` (e.g.
   `1.2.3`) + `{{major}}.{{minor}}` (e.g. `1.2`) + `latest` (metadata-action
   `latest=auto` default on semver tags). **No `v` prefix.**
2. Build multi-arch image (`linux/amd64` + `linux/arm64`) from `Containerfile`
   (multi-stage), with BuildKit SBOM + provenance (`mode=max`), push to GHCR.
3. Sign the image keylessly with **cosign** (GitHub OIDC).
4. Publish **SLSA build provenance** to the GitHub attestations API
   (`actions/attest-build-provenance`, also pushed to the registry) →
   consumers can `gh attestation verify oci://ghcr.io/kj187/jarvis:X.Y.Z --repo kj187/jarvis`.
5. Outputs the image digest for the later jobs.

**Job `chart`** (stable tags only; calls `.github/workflows/chart-release.yml`
via `workflow_call` with `require_image: true`) — see *Helm chart workflow*
below.

**Job `release`** (after `build-and-push`, and `chart` unless skipped for a
pre-release):
1. Generate a standalone **SPDX SBOM** (syft, installed via
   `anchore/sbom-action/download-syft`, run directly against the pushed image
   digest) → `sbom.spdx.json`.
2. Sign it keylessly: `cosign sign-blob --bundle sbom.spdx.json.sigstore.json`
   — consumers verify with `cosign verify-blob`; the `*.sigstore.json` asset
   is also what OpenSSF Scorecard's *Signed-Releases* check looks for.
3. Build the release body: stable tags **require**
   `.github/release-notes/vX.Y.Z.md` (the job fails without it — no silent
   CHANGELOG fallback), then appends image pull + digest, cosign verify,
   `gh attestation verify`, Helm install + chart CHANGELOG link + chart cosign
   verify, and SBOM verify. Pre-release tags use the notes file
   (`.github/release-notes/vX.Y.Z.md`, base version without `-rc.N`) when it
   exists and is not empty; otherwise fall back to an auto-generated
   commit-log body. Either way, they get an `image.tag` override hint instead
   of the chart section — see the Release Candidates section in `SKILL.md`.
4. Create the GitHub Release via `gh release create --notes-file
   release-body.md --verify-tag` with `sbom.spdx.json` +
   `sbom.spdx.json.sigstore.json` as assets — `--latest` for a real release,
   `--prerelease` for a pre-release tag. Releases are immutable: if a release
   for the tag already exists, the job fails — never overwrite a published
   release; delete it manually first if a re-release is really intended.

**Helm chart workflow** (`.github/workflows/chart-release.yml`):
- Entry points: `workflow_call` from `release.yml` (app releases, after the
  image) and push to `main` touching `charts/**` / `workflow_dispatch`
  (chart-only releases, see `SKILL.md`). Runs are serialized
  (`concurrency: chart-publish`).
- Reads `version` and `appVersion` from `charts/jarvis/Chart.yaml` — chart
  versioning is **decoupled** from the app version and maintained manually.
- Existence guard: if that chart version is already in the registry, the run
  skips publishing (published chart versions are immutable, never overwritten).
- Image guard: publishes only if `ghcr.io/kj187/jarvis:<appVersion>` exists.
  Missing → the release PR merge run skips with a notice (the release
  workflow publishes after the build); the `workflow_call` run fails.
- Otherwise: `helm lint` → `helm package` → `helm push` to
  `oci://ghcr.io/kj187/charts` → keyless **cosign** signature (GitHub OIDC).
- The signing step runs whenever the version exists in the registry and
  verifies before signing, so a `workflow_dispatch` re-run heals a
  published-but-unsigned version.
