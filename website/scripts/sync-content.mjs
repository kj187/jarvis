#!/usr/bin/env node
// Prebuild step for the docs website (.agents/skills/website/SKILL.md).
//
// Single source of truth: nothing under website/content/ is ever hand-edited
// or committed (gitignored, regenerated every `pnpm sync`/`dev`/`build`).
// This script copies the real repo docs in, rewriting links so the site
// stays navigable:
//   - a link to another copied file  -> the website route (/features, ...)
//   - a link to any other repo file  -> https://github.com/kj187/jarvis/blob/main/<path>
//   - an image under docs/assets/    -> ./assets/<file> (copied alongside)
//
// Run: node scripts/sync-content.mjs (from website/), or `pnpm run sync`.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES, ROUTE_BY_SOURCE } from './pages.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const WEBSITE_ROOT = path.resolve(__dirname, '..')
const CONTENT_DIR = path.join(WEBSITE_ROOT, 'content')
const PUBLIC_DIR = path.join(CONTENT_DIR, 'public')
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
      if (repoRel.startsWith('docs/assets/')) return `./assets/${path.basename(repoRel)}`
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
  return body
}

/** True if `body` already starts (after optional blank lines) with a Markdown `# ` heading. */
function hasMarkdownH1(body) {
  return /^\s*#\s+\S/.test(body)
}

function main() {
  fs.rmSync(CONTENT_DIR, { recursive: true, force: true })
  fs.mkdirSync(CONTENT_DIR, { recursive: true })
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })
  fs.mkdirSync(ASSETS_DIR, { recursive: true })

  for (const page of PAGES) {
    let body = readSource(page.src)
    body = rewriteLinks(body, page.src)
    const needsTitle = page.title || !hasMarkdownH1(body)
    const frontmatter = needsTitle ? `---\ntitle: ${page.title ?? page.route}\n---\n\n` : ''
    fs.writeFileSync(path.join(CONTENT_DIR, `${page.route}.md`), frontmatter + body)
  }

  // docs/assets/*.{png,svg,...} referenced by relative image links above.
  const assetsSrc = path.join(REPO_ROOT, 'docs', 'assets')
  if (fs.existsSync(assetsSrc)) {
    for (const file of fs.readdirSync(assetsSrc)) {
      const ext = path.extname(file).toLowerCase()
      if (IMAGE_EXT.has(ext)) {
        fs.copyFileSync(path.join(assetsSrc, file), path.join(ASSETS_DIR, file))
      }
    }
  }

  // Branding: logo + favicons from frontend/public/, served at the site root.
  const frontendPublic = path.join(REPO_ROOT, 'frontend', 'public')
  for (const file of ['logo.png', 'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']) {
    const src = path.join(frontendPublic, file)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PUBLIC_DIR, file))
  }

  // Site-only pages (not synced from any repo doc — hand-authored under
  // website/, just copied into the regenerated content/ dir so VitePress's
  // srcDir has everything in one place).
  for (const file of ['index.md']) {
    fs.copyFileSync(path.join(WEBSITE_ROOT, file), path.join(CONTENT_DIR, file))
  }

  console.log(`sync-content: wrote ${PAGES.length} pages + assets to ${path.relative(WEBSITE_ROOT, CONTENT_DIR)}/`)
}

main()
