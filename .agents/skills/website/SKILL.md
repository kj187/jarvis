---
name: website
description: Build, change and deploy the Jarvis documentation website (VitePress in website/, content synced from the repo's own markdown, GitHub Pages). Use when docs change, a new doc file is added, the site's look or structure changes, the Pages deployment misbehaves — and as part of every feature PR, so the published docs never go stale.
---

# Jarvis — Documentation Website

The site at `https://kj187.github.io/jarvis/` is a VitePress app in
`website/`. It **renders the repository's own markdown** — the docs are never
duplicated. Base rules (no `console.log`, doc-sync duty, PR workflow) live in
the root `AGENTS.md`.

Because the site publishes `docs/` on every push to `main`, this file is part
of the feature workflow, not a separate chore: every feature updates the docs
in its own PR (`.agents/skills/add-feature/SKILL.md` → last step,
`.agents/skills/pr-workflow/SKILL.md` → documentation check), and a new file
under `docs/` is only visible once it is registered here.

---

## The one rule

**Markdown files in the repo are the single source of truth.** Nothing under
`website/content/` is hand-written or committed — a prebuild script
regenerates it on every `sync`/`dev`/`build`. If a doc needs fixing, fix it in
`docs/`, `README.md`, … — never in `website/`.

The only hand-authored page is `website/index.md` (the home page); it is
copied into `content/` unchanged.

---

## Commands

```bash
make website        # build to website/.vitepress/dist (fails on dead internal links)
make website-dev    # hot-reload preview on http://localhost:5174/jarvis/
```

Both run containerized (`node:22-alpine`, no local Node/pnpm needed).
`--user 0` is required so `node_modules/` and `dist/` end up owned by the host
user; `git` is installed inside the container because the build reads each
page's last commit time via `git log`.

`make website-dev` syncs once at startup. Editing a file under `docs/` while
it runs does **not** re-sync — restart it (editing files under `website/`
does hot-reload).

---

## Layout

| Path | What it is |
|---|---|
| `website/scripts/pages.mjs` | The manifest: which repo file becomes which route. Imported by both the sync script and the VitePress config. |
| `website/scripts/sync-content.mjs` | Prebuild: copies the sources into `content/`, rewrites links, copies `docs/assets/*` and the branding files. |
| `website/index.md` | Home page (hero, feature grid, showcase). The only authored page. |
| `website/.vitepress/config.mts` | Site config: `base`, nav, sidebar, search, edit links, dead-link policy. |
| `website/.vitepress/theme/` | Custom theme: `Layout.vue`, `style.css` (palette), `components/MeshCanvas.vue`. |
| `website/content/`, `website/.vitepress/dist\|cache`, `website/node_modules/` | Generated — all gitignored (also in `.dockerignore`/`.containerignore`). |

---

## Adding a new doc page

1. Write the doc where it belongs (`docs/<name>.md`).
2. Add an entry to `PAGES` in `website/scripts/pages.mjs`
   (`{ src: 'docs/<name>.md', route: '<name>' }`; add `title` only when the
   file has no `# ` heading or needs a different nav title).
3. Add it to the `sidebar` (and `nav` if it is a top-level entry) in
   `website/.vitepress/config.mts`.
4. `make website` — the build fails on dead internal links, so a link to the
   new page from another doc is verified automatically.

Both steps are needed: `PAGES` controls what gets synced *and* how links
between docs are rewritten; the sidebar controls navigation.

---

## How link rewriting works

`rewriteLinks()` in `sync-content.mjs` resolves every markdown link relative
to its **source** file and rewrites it:

| Link target | Becomes |
|---|---|
| another file listed in `PAGES` | the website route (`/features`) |
| any other repo file | `https://github.com/kj187/jarvis/blob/main/<path>` |
| an image under `docs/assets/` | `./assets/<file>` (copied into `content/assets/`) |
| `frontend/public/logo.png` | `/logo.png` |
| any other image | `https://raw.githubusercontent.com/kj187/jarvis/main/<path>` |
| `http(s):`, `mailto:`, `#fragment` | unchanged |

Passes run in this order and must stay that way: linked badges
(`[![alt](img)](target)` — the README's shields), then images, then plain
links, then bare `<img src="…">`, then bare `<source srcset="…">` (the
README's theme-aware `<picture>` screenshot). The plain-link regex stops at
the first `]`, so without the badge pass first it mangles nested syntax.

After `rewriteLinks()`, `convertThemePictures()` runs once more over the
whole file: it turns the README's GitHub-native `<picture>` +
`prefers-color-scheme` screenshot into the `.dark-only`/`.light-only` divs
the site already uses for the homepage's card-view shot. GitHub has no
concept of the site's manual light/dark switch (`appearance: 'dark'` in
`config.mts`) — it can only follow the OS/browser theme via
`prefers-color-scheme` — so the same markup needs two different theme
mechanisms depending on where it renders. Must run after the srcset rewrite,
since it matches on the already-rewritten `./assets/…` paths.

---

## Look & feel

- The palette in `theme/style.css` is a **hand-made copy** of the app's
  tokens (`frontend/src/index.css`, `@theme` for dark and
  `[data-theme="light"]` for light) — VitePress CSS variables and Tailwind
  `@theme` tokens are different systems, so changing the app palette means
  updating this file too.
- Dark is the default (`appearance: 'dark'`).
- `theme/components/MeshCanvas.vue` **imports the pure geometry from the app**
  (`frontend/src/lib/owlMesh.ts`) instead of re-implementing it — do not copy
  that logic into `website/`. `mode="owl"` draws the logo contour,
  `mode="neural"` random drifting nodes. It reads its colors from the VitePress
  CSS variables, respects `prefers-reduced-motion` and cleans up on unmount.
- `Layout.vue` injects the backdrop into the `layout-top` slot on the home
  page only. It sits at `z-index: 0`; `.VPHome` gets `z-index: 1` so hero,
  feature cards and showcase stay above it.
- Feature icons on the home page are inline SVG **strings**. VitePress only
  renders string icons (`v-html`); an object `icon: { svg: … }` is silently
  ignored because object icons go through `VPImage` and expect `src`.
  No emoji.
- Screenshots of the app are theme-specific, so the home page ships both and
  toggles them with `.light-only` / `.dark-only` (defined in `theme/style.css`
  — VitePress has no such utility of its own). A screenshot placed on the home
  page therefore needs a light counterpart in the screenshot suite;
  `card-view` / `card-view-light` in
  `frontend/e2e/screenshots/none/card-view.screenshot.spec.ts` is the pattern.
- Headings inside hand-written blocks on the home page render a visible `#`:
  VitePress hides heading anchors via `.vp-doc .header-anchor`, and the home
  layout is not `.vp-doc`. `theme/style.css` hides them for `.home-showcase`;
  a new block needs the same rule. Further `##` sections of the home page go
  inside the same `.home-showcase` wrapper; `.home-showcase h2:not(:first-child)`
  gives them their top spacing.
- **`theme/components/HomeScreenshot.vue`** renders the card-view screenshot
  (same theme toggling as above) via the `home-hero-after` slot in
  `Layout.vue`, so it appears between the hero and the feature grid. This is
  the only way to place anything there: `VPHome` always renders the page's
  own Content (the `<div class="home-showcase">` block) *after* the feature
  grid, regardless of where it sits in `index.md`'s source — a screenshot
  meant to show "before the feature grid" cannot be placed there in markdown.
  It imports the PNGs directly (`../../../content/assets/...`), which exist
  once `pnpm run sync` has run (both `dev` and `build` do this first).
- The feature grid's first two entries in `index.md`'s `features:` list are
  rendered larger and spanning two of four grid columns each — the remaining
  four stay compact, one column each — via `.VPHomeFeatures .items` overrides
  in `theme/style.css`, keyed on `:nth-child(-n + 2)`. This is deliberate,
  unequal visual weight (W11g: "let the two or three strongest capabilities
  dominate"), not a bug — **the two strongest differentiators must stay
  first** in the YAML list, or the CSS promotes the wrong boxes. Only applies
  at 768px and up; below that, the grid falls back to VitePress's own
  single/two-column stack untouched.
- **Display face:** Sora, self-hosted from `theme/fonts/sora-variable-latin.woff2`
  (SIL OFL 1.1, license text alongside it in `theme/fonts/OFL.txt`) — decision 9
  (W11h) approved a display face for the hero and section headings only, with
  Inter staying the sole face everywhere else; no Google Fonts origin (strict
  CSP, `docs/security.md`). One file backs both `@font-face` weight
  declarations (600 and 700) in `theme/style.css` — it is the variable font
  Google Fonts itself serves, and the browser picks the requested weight off
  its own `wght` axis, same as Google's own generated CSS does; there is no
  separate 700-only file to fetch. Applied via `--vp-font-family-display` to
  `.VPHero .name`/`.text`, `.home-showcase h2`, and `.VPFeature .title` (the
  feature-grid box titles) — deliberately the same three targets shown in the
  maintainer-approved font trial, not "every heading everywhere". A different
  display face swaps the two `src: url(...)` lines and the font files; it does
  not need new selectors.

---

## Deployment

`.github/workflows/docs.yml` builds and deploys to GitHub Pages on push to
`main` (path-filtered to the docs sources and `website/**`) and on
`workflow_dispatch`. All actions are SHA-pinned — `ratchet check` runs in CI.

`fetch-depth: 0` on the checkout is required: without full history the
last-updated timestamps are empty.

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
| Assets 404 under a different host | `base: '/jarvis/'` is hardcoded for the Pages path. Absolute paths in `head`/frontmatter must include it. |
| `dist/` owned by root | The `--user 0` flag is missing from the podman invocation. |

---

## Doc-sync duty

Changing the site's structure, theme or sync script → update **this file**.
Changing the Make targets → `.agents/testing.md`. The website is not part of
the application architecture, so `.agents/architecture.md` stays untouched.
