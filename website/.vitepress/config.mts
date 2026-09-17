import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { PAGES } from '../scripts/pages.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SITE_URL = 'https://kj187.github.io/jarvis/'
const SITE_DESCRIPTION = 'The open-source web UI for Prometheus Alertmanager'

// repo-relative source path for each synced route, so "Edit this page on
// GitHub" and "Last updated" point at the real file (docs/features.md),
// never at the regenerated website/content/features.md copy.
const SOURCE_BY_ROUTE = new Map<string, string>([
  ...PAGES.map((p): [string, string] => [p.route, p.src]),
  ['index', 'website/index.md'],
])

/** Commit time of a repo file in ms, or undefined outside a git checkout. */
function gitLastUpdated(repoRelPath: string): number | undefined {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', repoRelPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim()
    return out ? Number(out) * 1000 : undefined
  } catch {
    return undefined
  }
}

export default defineConfig({
  title: 'Jarvis',
  description: SITE_DESCRIPTION,
  base: '/jarvis/',
  srcDir: 'content',
  appearance: 'dark',
  lastUpdated: true,
  cleanUrls: true,
  // Strict for every internal link; only the docs' example URLs are exempt.
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  markdown: {
    // Shiki has no `env` grammar; `promql` has none either and falls back to
    // plain text on its own (harmless build warning).
    languageAlias: { env: 'dotenv' },
  },

  // themeConfig is serialized to the client, so the edit link cannot close
  // over SOURCE_BY_ROUTE — point filePath at the real source here instead.
  transformPageData(pageData) {
    const src = SOURCE_BY_ROUTE.get(pageData.relativePath.replace(/\.md$/, ''))
    if (!src) return
    return { filePath: src, lastUpdated: gitLastUpdated(src) }
  },

  // Per-page OG/Twitter tags (title/description follow the page like the
  // browser tab does; url/image are site-wide). transformHead runs at build
  // time with pageData already resolved, unlike themeConfig which is
  // serialized to the client and cannot see pageData.title.
  transformHead({ pageData }) {
    const route = pageData.relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '')
    const url = `${SITE_URL}${route}`
    const title = route ? `${pageData.title} | Jarvis` : 'Jarvis'
    const description = pageData.description || SITE_DESCRIPTION
    const image = `${SITE_URL}logo.png`
    return [
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'Jarvis' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:image', content: image }],
      ['meta', { name: 'twitter:card', content: 'summary' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: image }],
    ]
  },

  // No sitemap plugin: the route set is fully known upfront (PAGES + index +
  // REDIRECTS), so a hand-written sitemap avoids an extra dependency.
  buildEnd(siteConfig) {
    const routes = ['', ...PAGES.map((p) => p.route)]
    const urls = routes.map((r) => `  <url><loc>${SITE_URL}${r}</loc></url>`).join('\n')
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
    fs.writeFileSync(path.join(siteConfig.outDir, 'sitemap.xml'), xml)
  },

  head: [
    ['link', { rel: 'icon', href: '/jarvis/favicon.ico' }],
    ['link', { rel: 'apple-touch-icon', href: '/jarvis/apple-touch-icon.png' }],
    ['link', { rel: 'sitemap', type: 'application/xml', href: '/jarvis/sitemap.xml' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Demo', link: '/demo' },
      { text: 'Deploy', link: '/deploy/compose' },
      { text: 'Reference', link: '/reference/features' },
      { text: 'Concepts', link: '/concepts/architecture' },
      {
        text: 'Changelog',
        items: [
          { text: 'App', link: '/reference/changelog' },
          { text: 'Helm Chart', link: '/reference/helm-changelog' },
        ],
      },
      { text: 'GitHub', link: 'https://github.com/kj187/jarvis' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Try it locally (demo)', link: '/demo' },
          { text: 'First steps in the UI', link: '/start/first-steps' },
        ],
      },
      {
        text: 'Tasks',
        items: [
          { text: 'Deploy with Compose', link: '/deploy/compose' },
          { text: 'Deploy on Kubernetes', link: '/deploy/kubernetes' },
          { text: 'Behind a proxy / ingress', link: '/deploy/reverse-proxy' },
          { text: 'Set up user login', link: '/howto/user-auth' },
          { text: 'Connect a protected Alertmanager', link: '/howto/upstream-auth' },
          { text: 'PostgreSQL & HA', link: '/howto/postgres-ha' },
          { text: 'Migrate from SQLite', link: '/howto/migrate-postgres' },
          { text: 'Configure retention', link: '/howto/retention' },
          { text: 'Set up monitoring', link: '/howto/monitoring' },
          { text: 'Upgrade', link: '/howto/upgrade' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Features', link: '/reference/features' },
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'Metrics', link: '/reference/metrics' },
          { text: 'Helm values', link: '/reference/helm-values' },
          { text: 'Compatibility', link: '/reference/compatibility' },
          { text: 'Changelog', link: '/reference/changelog' },
          { text: 'Helm chart changelog', link: '/reference/helm-changelog' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Architecture', link: '/concepts/architecture' },
          { text: 'Alert lifecycle', link: '/concepts/alert-lifecycle' },
          { text: 'Why SQLite is single-replica', link: '/concepts/sqlite-limits' },
          { text: 'Security model', link: '/concepts/security' },
          { text: 'Glossary', link: '/concepts/glossary' },
          { text: 'Project scope', link: '/concepts/scope' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Troubleshooting', link: '/help/troubleshooting' },
          { text: 'FAQ', link: '/help/faq' },
        ],
      },
      {
        text: 'Project',
        items: [
          { text: 'Contributing', link: '/project/contributing' },
          { text: 'E2E & screenshot testing', link: '/project/testing-e2e' },
          { text: 'Working with AI agents', link: '/project/ai-agents' },
          { text: 'Security policy', link: '/project/security-policy' },
        ],
      },
    ],

    search: { provider: 'local' },

    socialLinks: [{ icon: 'github', link: 'https://github.com/kj187/jarvis' }],

    editLink: {
      pattern: 'https://github.com/kj187/jarvis/edit/main/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message:
        'Released under the Apache 2.0 License. Jarvis is not affiliated with Prometheus or Alertmanager.',
      copyright: 'Copyright © 2026 Julian Kleinhans',
    },
  },
})
