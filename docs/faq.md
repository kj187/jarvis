# FAQ

Questions that come up before installing. Once it runs and something is
wrong, [Troubleshooting](troubleshooting.md) is the better page.

- [How is this different from Karma?](#how-is-this-different-from-karma)
- [Does Jarvis change anything in Alertmanager?](#does-jarvis-change-anything-in-alertmanager)
- [Is it safe to point at a production Alertmanager?](#is-it-safe-to-point-at-a-production-alertmanager)
- [How much load does it add upstream?](#how-much-load-does-it-add-upstream)
- [Do I need PostgreSQL?](#do-i-need-postgresql)
- [Do I need Prometheus?](#do-i-need-prometheus)
- [Does Jarvis send notifications?](#does-jarvis-send-notifications)
- [Can I run it without a login?](#can-i-run-it-without-a-login)
- [What happens to my data when I upgrade?](#what-happens-to-my-data-when-i-upgrade)
- [Will it keep growing into an incident-management tool?](#will-it-keep-growing-into-an-incident-management-tool)
- [Can I serve it under a sub-path?](#can-i-serve-it-under-a-sub-path)

---

## How is this different from Karma?

Karma is a good project and Jarvis was inspired by it. The difference is what
happens *after* you look at an alert.

Most Alertmanager UIs are read-only dashboards: they show what is firing right
now, and when the alert clears it is gone. Jarvis records the lifecycle —
every firing, every resolve, per alert — and adds the things a team needs to
work an alert together: **claiming** it so nobody duplicates the effort, and
**comments** that stay with the alert across firings.

So the question to ask is whether you want a better view of the current state,
or a working surface with memory. If it is the former, Karma is lighter.

---

## Does Jarvis change anything in Alertmanager?

Almost nothing. Jarvis only ever writes silences:

- `POST /api/v2/silences` when you create one
- `DELETE /api/v2/silence/{id}` when you expire one

That is the complete list of write operations. Claims, comments, alert history,
saved filters and settings live in Jarvis's own database and never leave it.
Alerts themselves are only ever read.

If you never create a silence from Jarvis, it is a pure reader.

---

## Is it safe to point at a production Alertmanager?

That is the intended use. Two properties make it predictable:

- **Reads are polled, not proxied.** Every client-facing endpoint is served
  from Jarvis's own in-memory snapshot of the last poll. Opening ten browser
  tabs adds zero requests upstream.
- **Writes are explicit.** Only a user creating or expiring a silence causes a
  write, and it goes to Alertmanager the same way the Alertmanager UI would.

It also means Jarvis is not a single point of failure for alerting itself:
notifications are Alertmanager's job and are unaffected by Jarvis being down.

---

## How much load does it add upstream?

Per poll interval (`JARVIS_POLL_INTERVAL`, default 15 seconds) and per
cluster: one `GET /api/v2/alerts` and one `GET /api/v2/silences`, plus a
`GET /api/v2/status` health check per configured member. With an HA pair,
members are tried in order and the first success wins, so the alert and
silence fetches stay at one request each in normal operation.

The number is independent of how many people have Jarvis open. If that is
still too much, raise the poll interval — the grace period scales with it
automatically.

---

## Do I need PostgreSQL?

Only if you run more than one replica.

SQLite is the default and needs no setup at all: one container, one file, done.
It is the right choice for a single instance, which covers most deployments.

PostgreSQL becomes mandatory as soon as there are several pods —
`replicaCount > 1` or an HPA. SQLite has a single writer, and several pods
would each poll Alertmanager and keep their own diverging history, so the Helm
chart refuses to render that combination rather than deploying it. The
reasoning and the migration path are in
[Persistence & high availability](persistence.md).

---

## Do I need Prometheus?

No. Jarvis talks to Alertmanager, never to Prometheus. The optional
per-cluster `PROMETHEUS_URL` is metadata exposed on the cluster API; Jarvis
itself sends no requests to it.

Jarvis does *expose* Prometheus metrics about itself at `/metrics` if you want
to scrape them — see [Metrics](metrics.md) — but nothing requires you to.

---

## Does Jarvis send notifications?

No, and it will not. Routing and delivering notifications is exactly what
Alertmanager is for, and duplicating it would mean two systems disagreeing
about who was paged. See [Project scope](scope.md).

---

## Can I run it without a login?

Yes — `JARVIS_AUTH_PROVIDER=none` is the default, and everything is open. That
is fine behind a VPN or an authenticating proxy.

With `internal` or `oidc`, you additionally choose how much is protected:
`write_protect` (anyone may look, only signed-in users may act) or
`full_protect` (login required for everything). Details in
[User authentication](authentication-user.md).

---

## What happens to my data when I upgrade?

Schema migrations run automatically at startup, and alert history, claims,
comments and settings survive. Downgrading is not supported — a newer schema
is not readable by an older binary. Back up the database before a major
upgrade; for SQLite that is copying one file. See
[Installation → Upgrading](installation.md#upgrading).

---

## Will it keep growing into an incident-management tool?

No. What Jarvis is for, and what it deliberately will not become — ticketing,
on-call scheduling, alerting rules, automation — is written down in
[Project scope](scope.md), including the litmus test used to judge new
feature requests.

---

## Can I serve it under a sub-path?

No. The frontend requests `/api/v1/…` and `/ws` as absolute paths, so Jarvis
needs its own hostname or subdomain rather than
`https://ops.example.com/jarvis/`. See
[Running behind a proxy](reverse-proxy.md#jarvis-must-own-the-root-path).
