// Shared page manifest: which repo doc becomes which website route.
// Split out from sync-content.mjs so the VitePress config (which imports
// this for "Edit this page on GitHub" links) doesn't also pull in — and
// bundle — the sync script's filesystem side effects.

/**
 * Source markdown files to copy, and the website route each becomes.
 * `route` is also the output filename (route.md) under content/.
 */
export const PAGES = [
  { src: 'README.md', route: 'getting-started', title: 'Getting Started' },
  { src: 'docs/demo.md', route: 'demo' },
  { src: 'docs/installation.md', route: 'installation' },
  { src: 'docs/configuration.md', route: 'configuration' },
  { src: 'docs/features.md', route: 'features' },
  { src: 'docs/alert-lifecycle.md', route: 'alert-lifecycle' },
  { src: 'docs/authentication-user.md', route: 'authentication-user' },
  { src: 'docs/authentication-alertmanager.md', route: 'authentication-alertmanager' },
  { src: 'docs/persistence.md', route: 'persistence' },
  { src: 'docs/retention.md', route: 'retention' },
  { src: 'docs/metrics.md', route: 'metrics' },
  { src: 'docs/security.md', route: 'security' },
  { src: 'docs/reverse-proxy.md', route: 'reverse-proxy' },
  { src: 'docs/troubleshooting.md', route: 'troubleshooting' },
  { src: 'docs/faq.md', route: 'faq', title: 'FAQ' },
  { src: 'docs/architecture.md', route: 'architecture' },
  { src: 'charts/jarvis/README.md', route: 'helm-chart' },
  { src: 'CHANGELOG.md', route: 'changelog', title: 'Changelog' },
  { src: 'charts/jarvis/CHANGELOG.md', route: 'helm-chart-changelog', title: 'Helm Chart Changelog' },
  { src: 'CONTRIBUTING.md', route: 'contributing' },
  { src: 'docs/testing-e2e.md', route: 'testing-e2e' },
  { src: 'docs/ai-agents.md', route: 'ai-agents' },
  { src: 'docs/scope.md', route: 'scope' },
  { src: 'SECURITY.md', route: 'security-policy', title: 'Security Policy' },
]

/** repo-relative source path -> website route (with leading slash), for link rewriting. */
export const ROUTE_BY_SOURCE = new Map(PAGES.map((p) => [p.src, `/${p.route}`]))

/**
 * Old route -> new route. A restructure that renames or removes a route adds
 * an entry here; `sync-content.mjs` turns each into a stub page at the old
 * route that meta-refreshes to the new one, so external links and bookmarks
 * still land somewhere instead of 404ing. `cleanUrls: true` + GitHub Pages
 * means there is no server-side redirect, so this is the only mechanism.
 * Empty until a stage actually renames or removes a route.
 */
export const REDIRECTS = []
