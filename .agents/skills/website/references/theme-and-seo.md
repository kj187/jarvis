# Website — Look & feel and SEO metadata

Reference for the `website` skill — start at `../SKILL.md`. Load this only when the task matches the title.

---

## Look & feel

The rules for colour, type, radii and contrast are the same as for the app — see
`.agents/skills/design-system/SKILL.md` and `docs/design-system.md`.

The reading pages get only light touches (end of `theme/style.css`, "Documentation body"):
rounded tables/code/callouts, a brand-blue accent on tip/info callouts, and a 2 px brand-blue
keyboard focus ring. Do not restyle VitePress wholesale; the landing page carries the brand.

- The palette comes from the single token source `design/tokens.json`:
  `node scripts/design-tokens.mjs` writes `theme/generated-tokens.css`
  (the `--vp-c-*` variables and `--jarvis-coral`), which `theme/style.css`
  imports. Change a colour in `tokens.json`, never in the generated file;
  the pre-commit hook and CI run the script with `--check`.
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
