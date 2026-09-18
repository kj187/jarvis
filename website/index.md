---
layout: home
title: Jarvis
titleTemplate: An Alertmanager Frontend for Day-to-Day Infrastructure Operations

hero:
  name: Jarvis
  text: An Alertmanager Frontend for <span class="nowrap">Day-to-Day</span> Infrastructure Operations
  tagline: When the alert disappears but <span class="accent">the questions remain</span>.
  image:
    src: /logo.png
    alt: Jarvis
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kj187/jarvis

features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>'
    title: History you can trust
    details: Every lifecycle transition is stored in SQLite or PostgreSQL. A missed poll or an Alertmanager outage is never recorded as a resolution — no phantom resolves, no inflated occurrence counts.
    link: /concepts/alert-lifecycle
    linkText: How the history stays clean
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>'
    title: Every cluster, live
    details: All your Alertmanager clusters in one realtime view, pushed over WebSocket. Point Jarvis at every member of an HA cluster and it deduplicates the alerts.
    link: /deploy/alertmanager#alertmanager-ha-clusters
    linkText: Multi-cluster and HA
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>'
    title: Claim and comment
    details: Claim an alert so your team sees who is on it. Comments stay bound to the alert and survive restarts and re-fires.
    link: /reference/features#alert-detail-panel
    linkText: The detail panel
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>'
    title: Silence with confidence
    details: Preview exactly which alerts a silence will hit before you create it, Fast-Silence straight from the alert list, and templates for recurring maintenance.
    link: /reference/features#create-silence
    linkText: Silences
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>'
    title: Saved filters, your way
    details: Filter with Alertmanager matchers, save the sets you use, mark one as your default, and share any filtered view as a URL.
    link: /reference/features#label-filters
    linkText: Filters
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z"/><path d="M10 21.9V14L2.1 9.1"/><path d="m10 14 11.9-6.9"/><path d="M14 19.8v-8.1"/><path d="M18 17.5V9.4"/></svg>'
    title: One container, your infrastructure
    details: Frontend and backend ship as a single image. SQLite needs no external service; switch to PostgreSQL to run several replicas. A Helm chart is included.
    link: /deploy/compose
    linkText: Installation
---

<div class="home-showcase">

## Focused by design

Jarvis is the part between an alert firing and a human deciding what to do about it. It
does not graph metrics, send notifications or manage tickets, and it is not meant to.
[What is in scope — and what never will be](/concepts/scope)

Every line is held to the same bar as any other production code: static analysis and
vulnerability scans in CI, a strict Content Security Policy and a hardened, read-only
container.
[How Jarvis is secured](/concepts/security)

Current release image: `ghcr.io/kj187/jarvis:1.12.0`.

</div>
