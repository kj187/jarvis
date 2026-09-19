#!/usr/bin/env node
// Prebuild step for the docs website (.agents/skills/website/SKILL.md).
//
// Single source of truth: nothing under website/content/ is ever hand-edited
// or committed (gitignored, regenerated every `pnpm sync`/`dev`/`build`).
// This script copies the real repo docs in, rewriting links so the site
// stays navigable:
//   - a link to another copied file  -> the website route (/features, ...)
//   - a link to any other repo file  -> https://github.com/kj187/jarvis/blob/main/<path>
//   - an image under docs/assets/    -> /assets/<file> (public dir, copied alongside)
//
// Run: node scripts/sync-content.mjs (from website/), or `pnpm run sync`.
// With `--watch` it keeps running and re-syncs whenever a source file changes
// (`--watch-only` skips the initial sync). `pnpm run dev` uses this, so editing
// docs/ or website/index.md hot-reloads.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES, REDIRECTS, ROUTE_BY_SOURCE } from './pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const WEBSITE_ROOT = path.resolve(__dirname, '..')
const CONTENT_DIR = path.join(WEBSITE_ROOT, 'content')
const PUBLIC_DIR = path.join(CONTENT_DIR, 'public')
// Public-dir copy: routes now nest (e.g. concepts/architecture), so a
// markdown-relative `./assets/x.svg` no longer resolves at a fixed depth.
// Absolute `/assets/x.svg` (served from the public dir, base-prefixed by
// VitePress at runtime) works from any route depth.
const PUBLIC_ASSETS_DIR = path.join(PUBLIC_DIR, 'assets')
// Flat copy: theme/components/HomeScreenshot.vue bundles two of these PNGs
// via a direct relative import (`../../../content/assets/...`), which Vite
// must resolve at build time — it needs the flat copy to keep existing.
const ASSETS_DIR = path.join(CONTENT_DIR, 'assets')
const GITHUB_BLOB = 'https://github.com/kj187/jarvis/blob/main'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'])

function readSource(relPath) {
  const abs = path.join(REPO_ROOT, relPath)
  if (!fs.existsSync(abs)) throw new Error(`sync-content: missing source file ${relPath}`)
  return fs.readFileSync(abs, 'utf8')
}

/** Resolves a markdown link target to a repo-relative path, from the file that contains it. */
function resolveRepoRelative(target, sourceFile) {
  const clean = target.split(/[?#]/)[0]
  if (!clean) return null
  if (clean.startsWith('/')) return clean.slice(1) // repo-root-relative, e.g. README's "docs/assets/x.png"
  const sourceDir = path.dirname(sourceFile)
  return path.normalize(path.join(sourceDir, clean)).split(path.sep).join('/')
}

function fragmentOf(target) {
  const m = target.match(/[#].*$/)
  return m ? m[0] : ''
}

/** Rewrites every markdown link/image target in `body`, relative to `sourceFile` (repo-relative path). */
function rewriteLinks(body, sourceFile) {
  const rewriteTarget = (target, isImage) => {
    if (/^(https?:|mailto:)/.test(target)) return target
    if (target.startsWith('#')) return target
    const repoRel = resolveRepoRelative(target, sourceFile)
    if (!repoRel) return target
    const frag = fragmentOf(target)
    const ext = path.extname(repoRel).toLowerCase()

    if (IMAGE_EXT.has(ext)) {
      if (repoRel === 'frontend/public/logo.png') return '/logo.png'
      if (repoRel.startsWith('docs/assets/')) return `/assets/${path.basename(repoRel)}`
      // Unrecognized image source: link to the raw file on GitHub instead of a 404.
      return `https://raw.githubusercontent.com/kj187/jarvis/main/${repoRel}`
    }
    if (isImage) return `https://raw.githubusercontent.com/kj187/jarvis/main/${repoRel}${frag}`

    const route = ROUTE_BY_SOURCE.get(repoRel)
    if (route) return `${route}${frag}`
    return `${GITHUB_BLOB}/${repoRel}${frag}`
  }

  // Linked badges ([![alt](img)](target)) first: the plain-link pattern below
  // would stop at the inner `]` and leave the outer target untouched.
  body = body.replace(
    /\[(!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\))\]\(([^)\s]+)(\s+"[^"]*")?\)/g,
    (m, image, target, title) => `[${image}](${rewriteTarget(target, false)}${title ?? ''})`,
  )
  // Images first (![alt](target)), then plain links ([text](target)) — image
  // syntax would otherwise also match the plain-link pattern.
  body = body.replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (m, alt, target, title) => {
    return `![${alt}](${rewriteTarget(target, true)}${title ?? ''})`
  })
  body = body.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (m, text, target, title) => {
    return `[${text}](${rewriteTarget(target, false)}${title ?? ''})`
  })
  // Bare HTML <img src="docs/assets/...">, used by a couple of docs.
  body = body.replace(/<img([^>]*?)\ssrc="([^"]+)"/g, (m, attrs, target) => {
    return `<img${attrs} src="${rewriteTarget(target, true)}"`
  })
  // <source srcset="docs/assets/...">, used by theme-aware <picture> blocks.
  body = body.replace(/<source([^>]*?)\ssrcset="([^"]+)"/g, (m, attrs, target) => {
    return `<source${attrs} srcset="${rewriteTarget(target, true)}"`
  })
  return body
}

/**
 * Rewrites a theme-aware `<picture>` (the README's `prefers-color-scheme`
 * sources) into the `.dark-only`/`.light-only` divs used elsewhere on the
 * site. GitHub picks a `<picture>` source from the OS/browser theme, which is
 * the right call for a README rendered there — but the website's light/dark
 * switch is a manual toggle independent of that preference (`appearance:
 * 'dark'` default in config.mts), so following the OS theme there shows the
 * wrong image whenever it doesn't match the page's actual toggle state. Must
 * run after `rewriteLinks` so the captured `srcset`s are already `/assets/…`.
 */
function convertThemePictures(body) {
  const PICTURE_RE =
    /<picture>\s*<source media="\(prefers-color-scheme: dark\)" srcset="([^"]+)">\s*<source media="\(prefers-color-scheme: light\)" srcset="([^"]+)">\s*<img[^>]*\salt="([^"]*)"[^>]*>\s*<\/picture>/g
  return body.replace(PICTURE_RE, (m, darkSrc, lightSrc, alt) => {
    return `<div class="dark-only">\n\n![${alt}](${darkSrc})\n\n</div>\n<div class="light-only">\n\n![${alt}](${lightSrc})\n\n</div>`
  })
}

/** True if `body` already starts (after optional blank lines) with a Markdown `# ` heading. */
function hasMarkdownH1(body) {
  return /^\s*#\s+\S/.test(body)
}

/** A meta-refresh + canonical-link stub for an old route, per the REDIRECTS map in pages.mjs. */
function redirectStub(to) {
  // The <meta>/<link> tags are raw HTML, so they need the full base-prefixed
  // path; the markdown body link goes through VitePress's own link handling,
  // which already prepends `base` — prefixing it here would double it and
  // trip the dead-link check (it resolves against the unprefixed route).
  const absoluteTarget = `/jarvis/${to}`
  return `---
title: Redirecting…
head:
  - - meta
    - http-equiv: refresh
      content: '0; url=${absoluteTarget}'
  - - link
    - rel: canonical
      href: 'https://kj187.github.io${absoluteTarget}'
---

This page has moved. Redirecting to [${to}](/${to})…
`
}

// Writes/copies only when the bytes differ, so a watch re-sync touches just
// the files that really changed — VitePress' HMR then reloads one page
// instead of the whole site.
function writeIfChanged(dest, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) return
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, buf)
}
const copyIfChanged = (src, dest) => writeIfChanged(dest, fs.readFileSync(src))

function main({ clean = true } = {}) {
  // A watch re-sync must not wipe content/ — VitePress would see every page
  // vanish and reappear.
  if (clean) fs.rmSync(CONTENT_DIR, { recursive: true, force: true })
  fs.mkdirSync(CONTENT_DIR, { recursive: true })
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })
  fs.mkdirSync(PUBLIC_ASSETS_DIR, { recursive: true })
  fs.mkdirSync(ASSETS_DIR, { recursive: true })

  // route may be nested (e.g. 'deploy/compose'), so the target directory
  // isn't guaranteed to exist yet.
  const writeContentFile = (route, text) => {
    writeIfChanged(path.join(CONTENT_DIR, `${route}.md`), text)
  }

  for (const page of PAGES) {
    let body = readSource(page.src)
    body = rewriteLinks(body, page.src)
    body = convertThemePictures(body)
    const needsTitle = page.title || !hasMarkdownH1(body)
    const frontmatter = needsTitle ? `---\ntitle: ${page.title ?? page.route}\n---\n\n` : ''
    writeContentFile(page.route, frontmatter + body)
  }

  const liveRoutes = new Set(PAGES.map((p) => p.route))
  for (const { from, to } of REDIRECTS) {
    if (liveRoutes.has(from)) {
      throw new Error(`sync-content: redirect source '${from}' collides with a live PAGES route`)
    }
    if (!liveRoutes.has(to)) {
      throw new Error(`sync-content: redirect target '${to}' for '${from}' is not a live PAGES route`)
    }
    writeContentFile(from, redirectStub(to))
  }

  // docs/assets/*.{png,svg,...} referenced by the image links rewritten above.
  // Copied to both the public dir (served at /assets/..., what markdown links
  // now point to) and the flat content/assets/ dir (what HomeScreenshot.vue
  // bundles two of these via a direct relative import).
  const assetsSrc = path.join(REPO_ROOT, 'docs', 'assets')
  if (fs.existsSync(assetsSrc)) {
    for (const file of fs.readdirSync(assetsSrc)) {
      const ext = path.extname(file).toLowerCase()
      if (IMAGE_EXT.has(ext)) {
        copyIfChanged(path.join(assetsSrc, file), path.join(PUBLIC_ASSETS_DIR, file))
        copyIfChanged(path.join(assetsSrc, file), path.join(ASSETS_DIR, file))
      }
    }
  }

  // Branding: logo + favicons from frontend/public/, served at the site root.
  const frontendPublic = path.join(REPO_ROOT, 'frontend', 'public')
  for (const file of ['logo.png', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']) {
    const src = path.join(frontendPublic, file)
    if (fs.existsSync(src)) copyIfChanged(src, path.join(PUBLIC_DIR, file))
  }

  // Site-only pages (not synced from any repo doc — hand-authored under
  // website/, just copied into the regenerated content/ dir so VitePress's
  // srcDir has everything in one place).
  for (const file of ['index.md']) {
    copyIfChanged(path.join(WEBSITE_ROOT, file), path.join(CONTENT_DIR, file))
  }

  console.log(
    `sync-content: wrote ${PAGES.length} pages + ${REDIRECTS.length} redirects + assets to ${path.relative(WEBSITE_ROOT, CONTENT_DIR)}/`,
  )
}

// Everything main() reads: the synced pages, docs/assets, the branding files
// and website/index.md. Polled instead of fs.watch: inside the container the
// repo is a bind mount, where inotify events from the host never arrive.
function sourceSignature() {
  const files = [
    ...PAGES.map((p) => path.join(REPO_ROOT, p.src)),
    path.join(WEBSITE_ROOT, 'index.md'),
    path.join(REPO_ROOT, 'frontend', 'public'),
    path.join(REPO_ROOT, 'docs', 'assets'),
  ]
  const parts = []
  for (const f of files) {
    try {
      const st = fs.statSync(f)
      parts.push(`${f}:${st.mtimeMs}:${st.size}`)
      if (st.isDirectory()) {
        for (const child of fs.readdirSync(f)) {
          const cs = fs.statSync(path.join(f, child))
          parts.push(`${child}:${cs.mtimeMs}:${cs.size}`)
        }
      }
    } catch {
      parts.push(`${f}:missing`)
    }
  }
  return parts.join('|')
}

const watchOnly = process.argv.includes('--watch-only') // dev: initial sync already ran
if (!watchOnly) main()

if (watchOnly || process.argv.includes('--watch')) {
  let last = sourceSignature()
  console.log('sync-content: watching docs/ and website/index.md for changes')
  setInterval(() => {
    const now = sourceSignature()
    if (now === last) return
    last = now
    try {
      main({ clean: false })
    } catch (err) {
      // A half-saved file or a bad link must not kill the dev server.
      console.error(`sync-content: ${err.message}`)
    }
  }, 1000)
}
