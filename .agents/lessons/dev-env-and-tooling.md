# Jarvis Lessons — Dev environment, toolchain, CI, AI tooling

Podman/air dev stack, Go version bumps, release workflow drift, tool adapters. Part of the lessons reference — start at `.agents/lessons.md` (index). Newest first; entry format: symptom → cause → rule.

---

## `make demo-reset` tried to delete the dev stack's volumes — a compose project name comes from the directory

**Symptom**: `make demo-reset` (`podman compose -f compose.demo.yml down -v`)
tried to remove `jarvis_jarvis_gomodcache` and `jarvis_jarvis_pnpmstore` — the
**dev stack's** volumes. It only failed because the dev containers were
running; with the dev stack stopped it would have deleted the Go module and
pnpm caches.
**Cause**: Compose derives the project name from the directory, not from the
file. Every `compose.*.yml` in the repo root is project `jarvis`, so `-v`
removes every volume in that project, whichever file declared it.
**Rule**: A compose file that anyone is ever going to `down -v` gets its own
project: `name: jarvis-demo` in the file **and** `-p jarvis-demo` on the
command (`COMPOSE_DEMO` in the `Makefile`) — the flag is what actually applies
under podman-compose. Volume names then carry the project prefix
(`jarvis-demo_demo_data`), which is also how you verify the isolation:
`podman volume ls`.

---

## Containers in the podman machine saw stale files right after a host rewrite

**Symptom**: Release-video steps failed nondeterministically: the voice
container's `soundfile.write` raised `System error` into a freshly created
output directory; `node e2e/video/build-video.mjs` hit `ENOENT` right after the
file was edited; a retry seconds later worked.
**Cause**: The macOS podman machine shares the checkout via virtiofs. A path
that the host just replaced (`rm -rf` + `mkdir`, or an editor/`perl -pi`
writing a new inode) is briefly stale inside a container started immediately
afterwards.
**Rule**: Scripts empty directories instead of recreating them
(`find <dir> -type f -delete`); after rewriting a file, give the next
container run a few seconds. Related: the default 2 GB machine has little
headroom for rendering — stop the dev stack if ffmpeg still ends with exit
137 (render memory rules: the release-video entry in `media-and-video.md`).

---

## The dev stack's frontend kept disappearing during e2e and video work

**Symptom**: `jarvis_frontend_1` was gone after an unrelated command, and the
next `podman exec jarvis_frontend_1 …` (pre-commit hook,
`make test-frontend-unit`) failed with "no such container".
**Cause**: Two different blunt instruments. `podman compose -f
compose.e2e.yml down -v` tears down by project name, and both compose files
derive the same project name from the directory, so the e2e teardown reaches
into the dev stack. And any cleanup that filters by image
(`podman rm -f $(podman ps -aq --filter ancestor=node:22-alpine)`) catches the
dev frontend, which runs that very image.
**Rule**: Remove containers by **name**, never by image and never via a
compose project shared with another stack. Recover with
`podman compose -f compose.dev.yml up -d frontend` (~20 s until Vite logs
"ready in").

---

## AI tools overlap in what they read — a symlinked adapter loads the same instructions twice

**Symptom**: With a tool's own instructions file symlinked to `AGENTS.md`, a
CLI smoke test of that tool reported the full `AGENTS.md` text twice in its
context, plus a stray one-line import meant for a different tool. Separately,
the slash-command names documented for one tool no longer matched how its
commands were actually invoked.
**Cause**: Tools do not read disjoint file sets. One tool reads `AGENTS.md`
*and* its own instructions file *and* another tool's root file (without
resolving that file's import syntax); skill directories are scanned under
several tool-specific roots, so a symlinked skill root can surface the same
skill twice unless the tool deduplicates by name. The smallest
project-instruction limit among the supported tools is 32 KiB combined,
including the user's global file, so duplicated or oversized instructions are
silently truncated.
**Rule**: Give a tool an adapter only when it reads neither `AGENTS.md` nor
`.agents/skills/`, and never mirror `AGENTS.md` into a file that tools also
reading `AGENTS.md` pick up — drop such files instead. A directory symlink for
skills is fine where the tools scanning both roots were verified to list each
skill once (the adapter table in `docs/ai-agents.md` records what was
verified). Verify tool behavior against current vendor docs and a real session
before documenting it — invocation syntax and discovery paths change between
releases. Enforced by `scripts/check-agent-context.sh`.

---

## Bumping the pinned Go version: pick a patch govulncheck considers clean

**Symptom**: Raising CI's `go-version` from `1.25.13` to `1.26.5` (forced by
`golang.org/x/crypto` v0.56.0 requiring Go ≥ 1.26) made the `govulncheck` CI
step fail — 6 stdlib CVEs (`GO-2026-5026`, `GO-2026-5972`, …), all "Fixed in:
go1.26.6".
**Cause**: `actions/setup-go` with an exact `go-version` sets
`GOTOOLCHAIN=local`, so the `go X.Y.0` directive in `go.mod` never triggers a
toolchain download — the CI runs on exactly the pinned patch. A `.5` patch
that predates the latest stdlib security fixes fails `govulncheck ./...`
(`.github/workflows/ci.yml`). `go build`/`go test`/`golangci-lint` stay green;
only govulncheck catches it.
**Rule**: When bumping the CI Go pin, run `govulncheck ./...` under the exact
target patch first (`go install golang.org/dl/goX.Y.Z@latest && goX.Y.Z
download`, then `PATH=$(goX.Y.Z env GOROOT)/bin:$PATH govulncheck ./...`) and
pick the newest patch that reports 0 called vulnerabilities. Same reason the
CHANGELOG shows a history of "pin Go to 1.25.11 to fix stdlib CVEs". The
`go.mod` directive stays at `X.Y.0` (the minimum), CI pins the patch.

---

## Release workflow steps only run on tag push — test drift stays hidden

**Symptom**: `release.yml` failed at "Create GitHub Release" during v1.6.0:
`no matches found for sbom.spdx.json`. The pinned `anchore/sbom-action` SHA
does not support `output-file`/`upload-artifact`/`upload-release-assets`
(inputs silently ignored as "unexpected"), so no SBOM file was written.
**Cause**: The step was added without ever executing — `release.yml` only
triggers on tag push, so broken steps surface at release time.
**Rule**: SBOM is now generated by running syft directly
(`anchore/sbom-action/download-syft` + `syft ... > sbom.spdx.json`). When a
release fails after the tag exists: fix on a branch, merge, then **move the
tag** (`git tag -f`, force-push) — the workflow runs from the tag's commit,
so re-pushing the old tag would rerun the broken workflow. Only safe while
no GitHub Release was published (releases are immutable; images/charts are
tag-overwritable).

---

## Dev backend (air) does not see host edits on Podman/macOS — restart it before testing backend changes

**Symptom**: A backend change (new query param, changed redirect) has no effect
in the `make up` dev stack, while frontend edits hot-reload fine. Found while
testing the SSO popup: the popup kept landing on `/` and loaded the whole app,
because the callback still ran the pre-change code.

**Cause**: file-change events from the macOS host do not reach the container's
bind mount, so `air` never rebuilds (its log showed the last `building...`
hours before the edit). Vite's HMR works because it polls.

**Fix / check**: `podman restart jarvis_backend_1` after backend edits, then
verify the new behaviour directly (e.g. `curl -si localhost:8080/auth/oidc/start?popup=1`
shows `|popup` in the `jarvis_oidc_state` cookie). When "the fix does nothing",
compare `air`'s last build time in `podman logs jarvis_backend_1` with your edit.
