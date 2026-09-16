---
layout: home
title: Jarvis
titleTemplate: The open-source web UI for Prometheus Alertmanager

hero:
  name: Jarvis
  text: The working surface for the alert lifecycle
  tagline: A web UI for Prometheus Alertmanager — see every alert across your clusters, understand its history, claim it, silence it, and talk about it with your team.
  image:
    src: /logo.png
    alt: Jarvis
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/kj187/jarvis

features:
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>'
    title: See everything, live
    details: Every configured Alertmanager cluster in one realtime view, pushed over WebSocket — no page reloads.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>'
    title: Full alert history
    details: Every lifecycle transition survives restarts — occurrence counts, firing patterns, labels and annotations.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>'
    title: Claim and comment
    details: Claim an alert so your team knows who's on it, and leave persistent comments with what you learned.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="m2 2 20 20"/></svg>'
    title: Silence with confidence
    details: Alertmanager-accurate silence matching, overlap detection and reusable templates for recurring maintenance.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>'
    title: Saved filters, your way
    details: Save matcher sets, star a default, and share Alertmanager-style filter URLs with your team.
  - icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
    title: Built for teams
    details: User authentication, settings that follow your account, and a Helm chart for production deployment.
---

<div class="home-showcase">

## The alert list you actually work in

<div class="dark-only">

![Jarvis card view in dark theme — alerts grouped into a multi-column card grid, each card showing severity, labels, a firing sparkline and claim and silence buttons](./assets/feature-card-view.png)

</div>
<div class="light-only">

![Jarvis card view in light theme — alerts grouped into a multi-column card grid, each card showing severity, labels, a firing sparkline and claim and silence buttons](./assets/feature-card-view-light.png)

</div>

Claim an alert with one click, silence it from the card, group by any label,
and keep the filters you use every day one keystroke away.

[Explore all features](/features) · [Run it locally](/demo)

</div>
