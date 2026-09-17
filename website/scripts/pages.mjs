// Shared page manifest: which repo doc becomes which website route.
// Split out from sync-content.mjs so the VitePress config (which imports
// this for "Edit this page on GitHub" links) doesn't also pull in — and
// bundle — the sync script's filesystem side effects.

/**
 * Source markdown files to copy, and the website route each becomes.
 * `route` is also the output path (route.md, nested directories allowed)
 * under content/. Organised by reader intent (Diátaxis), not by source file
 * — see .agents/skills/website/SKILL.md.
 */
export const PAGES = [
  // Getting Started
  { src: 'docs/demo.md', route: 'demo' },
  { src: 'docs/first-steps.md', route: 'start/first-steps' },

  // Tasks (how-to)
  { src: 'docs/deploy-compose.md', route: 'deploy/compose' },
  { src: 'docs/deploy-kubernetes.md', route: 'deploy/kubernetes' },
  { src: 'docs/reverse-proxy.md', route: 'deploy/reverse-proxy' },
  { src: 'docs/authentication-user.md', route: 'howto/user-auth' },
  { src: 'docs/authentication-alertmanager.md', route: 'howto/upstream-auth' },
  { src: 'docs/postgres-ha.md', route: 'howto/postgres-ha' },
  { src: 'docs/migrate-postgres.md', route: 'howto/migrate-postgres' },
  { src: 'docs/retention.md', route: 'howto/retention' },
  { src: 'docs/monitoring.md', route: 'howto/monitoring' },
  { src: 'docs/upgrade.md', route: 'howto/upgrade' },

  // Reference
  { src: 'docs/features.md', route: 'reference/features' },
  { src: 'docs/configuration.md', route: 'reference/configuration' },
  { src: 'docs/metrics.md', route: 'reference/metrics' },
  { src: 'charts/jarvis/README.md', route: 'reference/helm-values' },
  { src: 'docs/compatibility.md', route: 'reference/compatibility' },
  { src: 'CHANGELOG.md', route: 'reference/changelog', title: 'Changelog' },
  { src: 'charts/jarvis/CHANGELOG.md', route: 'reference/helm-changelog', title: 'Helm Chart Changelog' },

  // Concepts (explanation)
  { src: 'docs/architecture.md', route: 'concepts/architecture' },
  { src: 'docs/alert-lifecycle.md', route: 'concepts/alert-lifecycle' },
  { src: 'docs/sqlite-limits.md', route: 'concepts/sqlite-limits' },
  { src: 'docs/security.md', route: 'concepts/security' },
  { src: 'docs/glossary.md', route: 'concepts/glossary' },
  { src: 'docs/scope.md', route: 'concepts/scope' },

  // Help
  { src: 'docs/troubleshooting.md', route: 'help/troubleshooting' },
  { src: 'docs/faq.md', route: 'help/faq', title: 'FAQ' },

  // Project
  { src: 'CONTRIBUTING.md', route: 'project/contributing' },
  { src: 'docs/testing-e2e.md', route: 'project/testing-e2e' },
  { src: 'docs/ai-agents.md', route: 'project/ai-agents' },
  { src: 'SECURITY.md', route: 'project/security-policy', title: 'Security Policy' },
]

/** repo-relative source path -> website route (with leading slash), for link rewriting. */
export const ROUTE_BY_SOURCE = new Map(PAGES.map((p) => [p.src, `/${p.route}`]))

/**
 * Old route -> new route. A restructure that renames or removes a route adds
 * an entry here; `sync-content.mjs` turns each into a stub page at the old
 * route that meta-refreshes to the new one, so external links and bookmarks
 * still land somewhere instead of 404ing. `cleanUrls: true` + GitHub Pages
 * means there is no server-side redirect, so this is the only mechanism.
 */
export const REDIRECTS = [
  { from: 'getting-started', to: 'demo' },
  { from: 'installation', to: 'deploy/compose' },
  { from: 'configuration', to: 'reference/configuration' },
  { from: 'features', to: 'reference/features' },
  { from: 'alert-lifecycle', to: 'concepts/alert-lifecycle' },
  { from: 'authentication-user', to: 'howto/user-auth' },
  { from: 'authentication-alertmanager', to: 'howto/upstream-auth' },
  { from: 'persistence', to: 'howto/postgres-ha' },
  { from: 'retention', to: 'howto/retention' },
  { from: 'metrics', to: 'reference/metrics' },
  { from: 'security', to: 'concepts/security' },
  { from: 'architecture', to: 'concepts/architecture' },
  { from: 'helm-chart', to: 'reference/helm-values' },
  { from: 'changelog', to: 'reference/changelog' },
  { from: 'helm-chart-changelog', to: 'reference/helm-changelog' },
  { from: 'contributing', to: 'project/contributing' },
  { from: 'testing-e2e', to: 'project/testing-e2e' },
  { from: 'ai-agents', to: 'project/ai-agents' },
  { from: 'security-policy', to: 'project/security-policy' },
  { from: 'scope', to: 'concepts/scope' },
]
