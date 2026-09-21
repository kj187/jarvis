---
name: website
description: Build, change and deploy the Jarvis documentation website (VitePress in website/, content synced from the repo's own markdown, GitHub Pages). Use when a doc page is added or renamed, the site's look or structure changes, or the Pages deployment or build misbehaves.
---

# Jarvis — Documentation Website

The site at `https://kj187.github.io/jarvis/` is a VitePress app in `website/`
that **renders the repository's own markdown**. It publishes `docs/` on every
push to `main`; doc updates for a feature belong to the feature's PR
(`AGENTS.md` → Workflow Rule 6, `.agents/doc-sync.md`), a new file under
`docs/` is only visible once registered as below.

## The one rule

**Markdown files in the repo are the single source of truth.** Nothing under
`website/content/` is hand-written or committed — `sync` regenerates it on
every `dev`/`build`. Fix a doc in `docs/`, `README.md`, … never in `website/`.
The only authored page is `website/index.md` (home).

## Commands

```bash
make website        # build to website/.vitepress/dist (fails on dead internal links)
make website-dev    # hot-reload preview on http://localhost:5174/jarvis/
cd website && pnpm test   # helper tests (media wiring, PAGES completeness)
```

Both `make` targets run containerized (`node:22-alpine`); the container flags
and why they are needed are commented in the `Makefile`. Adding a page or
changing `pages.mjs`/`config.mts` needs a `make website-dev` restart.

## Layout

| Path | What it is |
|---|---|
| `website/scripts/pages.mjs` | Manifest: which repo file becomes which route (`PAGES`), old→new route map for redirect stubs (`REDIRECTS`) |
| `website/scripts/sync-content.mjs` | Prebuild: copies sources into `content/`, rewrites links and images (rules in its header and `rewriteLinks` comments) |
| `website/.vitepress/config.mts` | Site config: nav, sidebar, search, edit links, dead-link policy, OG/Twitter tags, sitemap |
| `website/.vitepress/theme/` | Custom theme (`Layout.vue`, `style.css`, `components/`) |
| `website/content/`, `.vitepress/dist\|cache`, `node_modules/` | Generated, gitignored |

## Adding a new doc page

1. Write the doc (`docs/<name>.md`).
2. Add `{ src: 'docs/<name>.md', route: '<category>/<name>' }` to `PAGES` in
   `website/scripts/pages.mjs` (`title` only when there is no `# ` heading or a
   different nav title is needed). The site is organised by reader intent
   (Getting Started / Install / Operate / Reference / Concepts / Help /
   Project), `route` may be nested.
3. Add it to the `sidebar` (and `nav` for a top-level entry) in
   `website/.vitepress/config.mts`.
4. `make website` — dead internal links fail the build.

`website/scripts/pages.test.mjs` fails (in `pnpm test`, run by the Docs Website
workflow) for a `docs/*.md` file missing from `PAGES`.

## Redirecting an old route

A renamed or removed route gets `{ from, to }` in `REDIRECTS`
(`pages.mjs`): GitHub Pages with `cleanUrls` has no server-side redirect, so
the sync script writes a meta-refresh stub. `to` must be a live `PAGES` route,
`from` must not collide with one. Details on the `/jarvis/` prefix in the stub:
comment in `sync-content.mjs`.

## Reference material (load only when the task needs it)

| Task | Load |
|---|---|
| Site theme, colours, fonts, layout components, SEO metadata | `.agents/skills/website/references/theme-and-seo.md` |
| Deployment (Pages workflow, base path), build/dead-link/asset failures | `.agents/skills/website/references/deployment-and-troubleshooting.md` |

Changing the site's structure, theme or sync script → update this file;
Make targets → `.agents/testing.md`.
