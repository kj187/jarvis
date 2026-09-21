# Website — Deployment and troubleshooting

Reference for the `website` skill — start at `../SKILL.md`. Load this only when the task matches the title.

---

## Deployment

`.github/workflows/docs.yml` builds and deploys to GitHub Pages on push to
`main` (path-filtered to the docs sources and `website/**`) and on
`workflow_dispatch`. It runs the website helper tests before the build. All
actions are SHA-pinned — `ratchet check` runs in CI.

`fetch-depth: 0` on the checkout is required: without full history the
last-updated timestamps are empty.

`pnpm test` also compares the published image/chart versions in the release
examples with `charts/jarvis/Chart.yaml`; a release cannot leave one of the
known documentation pins stale without failing the docs workflow.

**One-time repo setting:** Settings → Pages → Source: **GitHub Actions**.
Without it the deploy job fails.

The pre-commit hook does **not** build the site (too slow). Breakage shows up
in the docs workflow.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Found dead link ./foo/bar` | The target is not in `PAGES` and not recognized as a repo file, or a link syntax the rewriter misses. Fix `PAGES` or `rewriteLinks()` — never edit the doc just to please the website. |
| Dead link on an example URL | `ignoreDeadLinks` in `config.mts` holds the allow-list (currently `localhost`). Keep it a narrow regex; internal links stay strict. |
| `ReferenceError: <x> is not defined` at build | `themeConfig` is serialized to the client, so functions in it lose their closure. Do the work in `transformPageData` instead (that is why the edit link is a `:path` string pattern). |
| `ERR_PNPM_IGNORED_BUILDS` | `website/pnpm-workspace.yaml` must allow the `esbuild` build script (`allowBuilds` + `onlyBuiltDependencies`), same as `frontend/`. |
| `The language 'x' is not loaded` | Shiki has no grammar for that fence language. Map it in `markdown.languageAlias` to a real grammar — an alias to `txt` **breaks** the build. `promql` has no grammar and warns harmlessly. |
| Images 404 in production | Only `docs/assets/*` is copied. Anything else becomes a raw.githubusercontent link; move the image to `docs/assets/` if it belongs to the docs. |
| `Could not resolve "./assets/…"` at build | A page linked its image with a relative `./assets/…` path instead of letting `rewriteLinks()` produce `/assets/…`. Relative paths only resolve from a flat `content/*.md` — any nested route (`concepts/…`, `howto/…`) breaks. Fix the source doc's image markdown, don't hand-edit the rewriter's output. |
| Assets 404 under a different host | `base: '/jarvis/'` is hardcoded for the Pages path. Absolute paths in `head`/frontmatter must include it. |
| `dist/` owned by root | The `--user 0` flag is missing from the podman invocation. |
