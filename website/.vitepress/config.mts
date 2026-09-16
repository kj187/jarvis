import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { PAGES } from '../scripts/pages.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

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
  description: 'The open-source web UI for Prometheus Alertmanager',
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

  head: [
    ['link', { rel: 'icon', href: '/jarvis/favicon.ico' }],
    ['link', { rel: 'apple-touch-icon', href: '/jarvis/apple-touch-icon.png' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Installation', link: '/installation' },
      { text: 'Features', link: '/features' },
      { text: 'Architecture', link: '/architecture' },
      { text: 'Helm Chart', link: '/helm-chart' },
      {
        text: 'Changelog',
        items: [
          { text: 'App', link: '/changelog' },
          { text: 'Helm Chart', link: '/helm-chart-changelog' },
        ],
      },
      { text: 'GitHub', link: 'https://github.com/kj187/jarvis' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Overview', link: '/getting-started' },
          { text: 'Try it locally (demo)', link: '/demo' },
          { text: 'Installation', link: '/installation' },
          { text: 'Configuration', link: '/configuration' },
        ],
      },
      {
        text: 'Product',
        items: [
          { text: 'Features', link: '/features' },
          { text: 'Alert Lifecycle', link: '/alert-lifecycle' },
        ],
      },
      {
        text: 'Authentication',
        items: [
          { text: 'User Login', link: '/authentication-user' },
          { text: 'Alertmanager (per cluster)', link: '/authentication-alertmanager' },
        ],
      },
      {
        text: 'Operating Jarvis',
        items: [
          { text: 'Persistence & High Availability', link: '/persistence' },
          { text: 'Data Retention', link: '/retention' },
          { text: 'Metrics', link: '/metrics' },
          { text: 'Security', link: '/security' },
          { text: 'Behind a Proxy', link: '/reverse-proxy' },
        ],
      },
      {
        text: 'Help',
        items: [
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'FAQ', link: '/faq' },
        ],
      },
      {
        text: 'Architecture',
        items: [{ text: 'Who Talks to Whom', link: '/architecture' }],
      },
      {
        text: 'Helm Chart',
        items: [
          { text: 'Chart README', link: '/helm-chart' },
          { text: 'Chart Changelog', link: '/helm-chart-changelog' },
        ],
      },
      {
        text: 'Changelog',
        items: [{ text: 'App Changelog', link: '/changelog' }],
      },
      {
        text: 'Contributing',
        items: [
          { text: 'Contributing Guide', link: '/contributing' },
          { text: 'E2E & Screenshot Testing', link: '/testing-e2e' },
          { text: 'Working with AI Agents', link: '/ai-agents' },
          { text: 'Project Scope', link: '/scope' },
          { text: 'Security Policy', link: '/security-policy' },
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
