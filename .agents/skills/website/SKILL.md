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

`make website-dev` syncs at startup and then keeps `sync-content.mjs
--watch-only` running next to VitePress: it polls the synced `docs/` pages,
`docs/assets`, `frontend/public` branding and `website/index.md` once a second
(polling, because inotify events from the host never reach a container bind
mount) and re-syncs only the files whose bytes changed. Vite itself needs the
same treatment — `vite.server.watch.usePolling` in `config.mts` — otherwise it
never sees an edit, neither under `website/` nor in the re-synced `content/`.
Adding a page or changing `pages.mjs`/`config.mts` still needs a restart.

---

## Layout

| Path | What it is |
|---|---|
| `website/scripts/pages.mjs` | The manifest: which repo file becomes which route (`PAGES`), plus the old→new route map for redirect stubs (`REDIRECTS`). Imported by both the sync script and the VitePress config. |
| `website/scripts/sync-content.mjs` | Prebuild: copies the sources into `content/`, rewrites links, copies `docs/assets/*` and the branding files. |
| `website/index.md` | Home page (hero, feature grid, showcase). The only authored page. |
| `website/.vitepress/config.mts` | Site config: `base`, nav, sidebar, search, edit links, dead-link policy, per-page OG/Twitter tags (`transformHead`), sitemap generation (`buildEnd`). |
| `website/.vitepress/theme/` | Custom theme: `Layout.vue`, `style.css` (palette), `components/MeshCanvas.vue`. |
| `website/content/`, `website/.vitepress/dist\|cache`, `website/node_modules/` | Generated — all gitignored (also in `.dockerignore`/`.containerignore`). |

---

## Adding a new doc page

1. Write the doc where it belongs (`docs/<name>.md`).
2. Add an entry to `PAGES` in `website/scripts/pages.mjs`
(`{ src: 'docs/<name>.md', route: '<category>/<name>' }`; add `title` only
when the file has no `# ` heading or needs a different nav title). `route`
may be nested (e.g. `howto/retention`) — the site is organised by reader
intent (Diátaxis: Getting Started / Install / Operate / Reference / Concepts /
Help / Project), not by source file, and `sync-content.mjs` creates whatever
   directory depth `route` needs.
3. Add it to the `sidebar` (and `nav` if it is a top-level entry) in
   `website/.vitepress/config.mts`, under the section matching its category.
4. `make website` — the build fails on dead internal links, so a link to the
   new page from another doc is verified automatically.

Both steps are needed: `PAGES` controls what gets synced *and* how links
between docs are rewritten; the sidebar controls navigation.

A `docs/*.md` file missing from `PAGES` fails `scripts/check-agent-context.sh`
(pre-commit hook + CI) rather than going silently unpublished.

---

## Redirecting an old route

When a restructure renames or removes a route, add an entry to `REDIRECTS` in
`website/scripts/pages.mjs`: `{ from: '<old-route>', to: '<new-route>' }`.
`sync-content.mjs` turns each into a stub page at `<old-route>.md` with a
`<meta http-equiv="refresh">` to `<new-route>` and a canonical link — the only
option here, since `cleanUrls: true` + GitHub Pages means there is no
server-side redirect. `to` must be a live `PAGES` route and `from` must not
collide with one; the sync script throws otherwise. The `<meta>`/`<link>`
targets need the full `/jarvis/<route>` path (raw HTML, not processed by
VitePress); the stub's own markdown fallback link must **not** repeat that
prefix — it goes through VitePress's normal link handling, which already
adds `base`, so prefixing it there double-counts and the dead-link check
flags it.

---

## How link rewriting works

`rewriteLinks()` in `sync-content.mjs` resolves every markdown link relative
to its **source** file and rewrites it:

| Link target | Becomes |
|---|---|
| another file listed in `PAGES` | the website route (`/reference/features`) |
| any other repo file | `https://github.com/kj187/jarvis/blob/main/<path>` |
| an image under `docs/assets/` | `/assets/<file>` (public dir — routes now nest to any depth, e.g. `concepts/architecture`, so a page-relative `./assets/…` no longer resolves at a fixed depth; also copied flat into `content/assets/` for `HomeScreenshot.vue`'s direct import) |
| `frontend/public/logo.png` | `/logo.png` (derived from `design/assets/logo.svg` by `scripts/logo-assets.py`) |
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
since it matches on the already-rewritten `/assets/…` paths.

---

## Look & feel

- The palette in `theme/style.css` is a **hand-made copy** of the app's
  tokens (`frontend/src/index.css`, `@theme` for dark and
  `[data-theme="light"]` for light) — VitePress CSS variables and Tailwind
  `@theme` tokens are different systems, so changing the app palette means
  updating this file too.
- Contrast roles: `--vp-c-text-3` is decorative/large-text only (≈3.1:1 light,
  3.6:1 dark — the mesh lines and VitePress placeholders use it); any label or
  body copy we style ourselves uses `--vp-c-text-2`. Coral is darkened in light
  mode (`hsl(6 65% 46%)`, 4.7:1 on `--vp-c-bg`) — keep small coral text ≥ 4.5:1.
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
- The homepage hero image and Owl mesh are shifted slightly right on desktop
  (`.VPHero .image` and `.hero-mesh-backdrop`) to keep the dense visual away
  from the copy. The hand-written `.home-showcase` adds its breakpoint padding
  *outside* a 1152px content width (`max-width` = content + current padding),
  so its text edges align with the hero, screenshot, and feature grid.
- **`.home-hero-screenshot`'s padding/max-width split mirrors `VPHero.vue` on
  purpose.** `VPHero` puts its horizontal padding on the full-bleed outer
  `.VPHero` element and centers a `max-width: 1152px` `.container` *inside*
  that already-padded area — so on viewports wider than 1152px + padding,
  the container's own auto margins add extra inset on top of the padding.
  Putting the padding and the `max-width` on the *same* element (as the
  screenshot wrapper used to) skips that extra inset, so the screenshot's
  left edge drifts right of the hero text/buttons above it at wide
  viewports. The fix keeps padding on `.home-hero-screenshot` and moves
  `max-width`/`margin: 0 auto` onto the `img`s inside it, reproducing the
  same two-step centering — never collapse them back onto one element.
- **`theme/components/HomeScreenshot.vue`** renders an automatic five-scene
  product tour via the `home-hero-after` slot in `Layout.vue`, so it appears
  between the hero and the feature grid. Every scene imports a dark/light PNG
  pair directly from `../../../content/assets/...`; the site's current theme
  selects the matching image. The last scene (`split: true`, "Dark & light")
  is the exception: it stacks both themes of one screenshot behind a
  `clip-path` divider so light mode is always visible. The `tour-*` PNG pairs
  come from `frontend/e2e/screenshots/none/home-tour.screenshot.spec.ts`
  (`make e2e-screenshot NAME=home-tour`); a new scene needs a dark and a light
  PNG plus the matching count in `scripts/media.test.mjs`. Scenes advance every nine seconds with a slow
  horizontal slide; a labelled tab row under the image shows the active scene's
  progress bar and a pause/play button. Reduced-motion preference disables autoplay,
  while an explicit play action still starts it. The plain-language product
  explainer follows the scene frame without an inset or rule — not in the hero
  and not duplicated in `index.md`. `content/assets` exists once `pnpm run
  sync` has run (both `dev` and `build` do this first).
- **`theme/components/HomeVideo.vue`** owns the linked product-intro cover and
  renders through `Layout.vue`'s `home-features-after` slot. Keep it after the
  feature grid: placing a full screenshot and a full video back-to-back above
  the feature explanation makes the first viewport visually top-heavy.
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
- **Documentation images open in a lightbox.** `ImageLightbox.vue` uses one
  delegated click handler for images inside `main`; linked images keep their
  link behavior, and `.no-lightbox` is the explicit opt-out. The homepage
  screenshots use the same viewer.
- **Videos use a linked 16:9 YouTube cover**, not an iframe: YouTube rejects
  embeds without an accepted HTTP Referer (player error 153), which makes
  local previews and privacy-hardened browsers unreliable. The homepage intro
  lives in `HomeScreenshot.vue`; reusable documentation covers use
  `.video-cover`.
  `docs/videos.md` is the permanent index for the product intro and release
  videos, while each release video also stays in its GitHub release notes.
- **Mermaid diagrams are rendered as light/dark pairs** by `make diagrams`
  (`<name>-light.svg`, `<name>-dark.svg`, transparent background). Source docs
  use a `prefers-color-scheme` `<picture>` for GitHub; `convertThemePictures`
  translates it to the site's manual `.light-only`/`.dark-only` switch.

---

## SEO metadata

`config.mts`'s `transformHead` emits per-page OG/Twitter tags (title tracks
`pageData.title`, so it follows the same "Page | Jarvis" pattern as the
`<title>` tag); `buildEnd` writes `dist/sitemap.xml` from `PAGES` + the home
route. Both are hand-rolled rather than a VitePress sitemap plugin — the
route set is fully known upfront, so a dependency buys nothing. `REDIRECTS`
stubs are intentionally left out of the sitemap (they are not canonical
pages).

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

---

## Doc-sync duty

Changing the site's structure, theme or sync script → update **this file**.
Changing the Make targets → `.agents/testing.md`. The website is not part of
the application architecture, so `.agents/architecture.md` stays untouched.
