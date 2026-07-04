# Project Scope

This document defines what Jarvis is — and, just as importantly, what it is
not. It exists so that feature decisions stay consistent over time and so
users can trust that the project will not sprawl into a do-everything tool.

## Definition

> **Jarvis is the working surface for the lifecycle of an alert — from the
> moment it fires, through investigation and handling, until it resolves.
> Nothing more, nothing less.**

Monitoring systems detect problems and fire alerts. Alertmanager collects
those alerts and routes notifications. But the moment a human sits down to
*work* with those alerts — understand them, coordinate on them, silence them,
learn from their history — the standard tooling is thin. That moment is
Jarvis. It is the cockpit you open when an alert comes in and you need to act
on it.

## In Scope

Everything that answers the question *"an alert is here — now what?"*:

- **Seeing alerts** — realtime view of all alerts across one or more
  Alertmanager clusters, without page reloads
- **Understanding alerts** — full lifecycle history that survives restarts,
  occurrence counts, firing patterns, labels, annotations, context
- **Organizing alerts** — grouping, sorting, filtering, and searching so a
  wall of alerts stays navigable
- **Coordinating on alerts** — claiming (who is handling this?) and
  persistent comments (what do we know about this?)
- **Muting alerts** — silence management for maintenance windows, including
  reusable templates for recurring maintenance
- **Multiple sources under one roof** — several Alertmanager clusters in a
  single view, including authentication against protected upstreams

Supporting concerns that any in-scope feature may need — user authentication,
persistence, theming, deployment packaging — are in scope as *enablers*, not
as products of their own.

## Out of Scope

Jarvis deliberately does **not**:

- **Create alerts or define alerting rules** — detecting problems is the
  monitoring system's job (Prometheus rules, etc.)
- **Measure or graph anything** — Jarvis is not a metrics dashboard and not a
  Grafana replacement; it shows alerts, not time series
- **Send notifications** — paging, mail, and push stay with Alertmanager and
  its receivers
- **Remediate automatically** — Jarvis is a tool for humans making decisions,
  not an automation or runbook-execution platform
- **Manage incidents or tickets** — an alert is not a ticket; once something
  needs long-lived planning, ownership workflows, or postmortems, it belongs
  in a dedicated system

As a rule of thumb: **everything before the alert (measuring, rules,
triggering) and everything after the alert (escalation, ticketing,
automation) is not Jarvis. Jarvis is the part in between — the moment a human
works with an alert.**

## The Litmus Test

A feature fits the scope if the answer to this question is *yes*:

> *"Does this help someone who is sitting in front of a list of active alerts
> and has to decide what to do?"*

Examples:

| Feature idea | Verdict |
|---|---|
| Comments on alerts | ✅ in scope |
| Silence templates for recurring maintenance | ✅ in scope |
| Per-cluster upstream authentication | ✅ in scope (enabler) |
| Editor for Prometheus alerting rules | ❌ out of scope (before the alert) |
| CPU/memory graphs per host | ❌ out of scope (metrics, not alerts) |
| Auto-restart a service when an alert fires | ❌ out of scope (after the alert) |
| On-call schedule management | ❌ out of scope (incident tooling) |

## Depth over Breadth

The scope is not *small* — it is *focused*. Jarvis is meant to grow **deep**
(making the alert-handling workflow ever better) rather than **broad**
(rebuilding adjacent tools). A steady stream of releases should mean a
sharper tool, not a wider one.
