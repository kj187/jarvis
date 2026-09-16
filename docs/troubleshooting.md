# Troubleshooting

Organised by what you see, not by which component is responsible. Each entry
names the symptom, what actually causes it, and what to check.

- [The UI loads but nothing ever updates](#the-ui-loads-but-nothing-ever-updates)
- [No alerts appear at all](#no-alerts-appear-at-all)
- [Jarvis exits immediately on start](#jarvis-exits-immediately-on-start)
- [The database will not open](#the-database-will-not-open)
- [`helm install` fails before anything is deployed](#helm-install-fails-before-anything-is-deployed)
- [PostgreSQL: "remaining connection slots are reserved"](#postgresql-remaining-connection-slots-are-reserved)
- [Hourly `connection lost, reconnecting` in the logs](#hourly-connection-lost-reconnecting-in-the-logs)
- [An alert re-fired but the occurrence count did not move](#an-alert-re-fired-but-the-occurrence-count-did-not-move)
- [Every alert briefly resolved at once](#every-alert-briefly-resolved-at-once)
- [A silence was created but matches nothing](#a-silence-was-created-but-matches-nothing)

---

## The UI loads but nothing ever updates

**Symptom.** The alert list renders, but new alerts only appear after a manual
reload. The browser console shows `WebSocket connection to 'wss://…/ws'
failed`. The Jarvis log has `ws upgrade` with an error.

**Cause.** The WebSocket upgrade was rejected because the browser's `Origin`
did not match. Unset, `JARVIS_ALLOWED_ORIGINS` permits same-origin requests
only — which is never true behind a proxy, where the browser sends
`https://jarvis.example.com` and the backend sees its own internal host.

**Check.**

1. `JARVIS_ALLOWED_ORIGINS` contains the exact URL you type in the browser —
   scheme, host and port, no trailing slash, no wildcard.
2. `https://` and `http://` are different origins. So are `:8080` and no port.
3. The proxy forwards `Upgrade` and `Connection` and speaks HTTP/1.1 upstream.

Full configuration per proxy: [Running behind a proxy](reverse-proxy.md).

**Related symptom.** If the connection establishes and then drops every few
seconds in a loop, the proxy's read timeout is too short — the WebSocket is
idle by design between alert changes.

---

## No alerts appear at all

**Symptom.** Jarvis is up, the UI works, the alert list stays empty — and
Alertmanager has firing alerts.

**Cause and check, in the order worth trying:**

1. **Jarvis cannot reach Alertmanager.** The log line is
   `poll cluster failed` with the cluster name and the underlying error.
   The URL is resolved **from inside the Jarvis container**, not from your
   machine: `http://localhost:9093` in `JARVIS_CLUSTER_1_ALERTMANAGER_URL`
   points at the container itself. Use the service name
   (`http://alertmanager:9093`) or a routable address.
2. **Alertmanager requires authentication.** A proxy in front of it answers
   `401`/`403` and the poll fails the same way. Configure
   [upstream authentication](authentication-alertmanager.md).
3. **The alerts are silenced.** Suppressed alerts are hidden by the default
   filter. Check the silences view.
4. **Wrong cluster.** `GET /api/v1/clusters` shows what Jarvis thinks it is
   polling and whether each member is up.

Jarvis polls every `JARVIS_POLL_INTERVAL` (default 15s), so allow one interval
before concluding anything.

---

## Jarvis exits immediately on start

Configuration is validated at startup and a bad value is fatal — deliberately,
so a misconfigured deployment fails visibly instead of running half-blind. The
message names the variable:

| Message | Fix |
|---|---|
| `JARVIS_CLUSTER_1_ALERTMANAGER_URL is required when NAME is set` | Every configured cluster needs a URL |
| `JARVIS_CLUSTER_1_ALERTMANAGER_URL: duplicate member URL` | The same member listed twice in one cluster |
| `JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL is required when OAUTH2_CLIENT_ID is set` | OAuth2 upstream auth needs a token endpoint |
| `JARVIS_SECRET_KEY must be at least 32 bytes when JARVIS_AUTH_PROVIDER=…` | `openssl rand -hex 32` |
| `invalid JARVIS_AUTH_MODE=…: must be write_protect or full_protect` | Typo in the mode |
| `invalid JARVIS_POLL_INTERVAL` | Needs a Go duration: `15s`, `1m` |
| `invalid JARVIS_DB_MAX_OPEN_CONNS` | Integer ≥ 1 |

At least one cluster is always required; Jarvis does not start without one.
Every variable is listed in [Configuration](configuration.md).

An unreachable Alertmanager is **not** a startup error — Jarvis starts and
keeps retrying on each poll.

---

## The database will not open

**SQLite** — `open sqlite: …` or `apply pragma "PRAGMA journal_mode=WAL": …`

The container runs as a non-root user (UID 65532) with a read-only root
filesystem. The `/data` mount must be writable by that user, and it must be a
real volume: a read-only mount, a missing directory or a host directory owned
by root all produce this.

**PostgreSQL** — `open postgres: …` (the DSN cannot be parsed) or
`ping postgres: …` (the server did not answer).

There is no startup retry. Jarvis exits and lets the orchestrator restart it,
which is the right behaviour when the database is genuinely down — but it
means a pod crash-looping at startup usually points at the database, not at
Jarvis. Credentials never appear in the logs; the DSN is redacted before it is
logged, so check the secret itself.

---

## `helm install` fails before anything is deployed

The chart validates at render time rather than letting a pod fail later. Four
messages, all starting with `Invalid configuration:`:

- **SQLite with `autoscaling.enabled`** or **SQLite with `replicaCount > 1`** —
  every pod would poll Alertmanager on its own and keep a diverging history.
  Either set `replicaCount: 1` or move to PostgreSQL
  (`database.dsn: postgres://…`). See
  [Persistence & high availability](persistence.md).
- **`auth.provider` other than `none` without a key** — set `auth.secretKey`
  (`openssl rand -hex 32`) or `auth.existingSecret`.
- **`auth.provider: oidc` without issuer, client ID or redirect URL** — all
  three are required.

These are render errors, not runtime errors: nothing was installed, and fixing
the values is the whole fix.

---

## PostgreSQL: "remaining connection slots are reserved"

**Symptom.** Requests fail with
`FATAL: remaining connection slots are reserved for roles with privileges of
the "pg_use_reserved_connections" role (SQLSTATE 53300)`, often across several
pods at once.

**Cause.** Too many connections in total. Jarvis caps its pool per pod
(`JARVIS_DB_MAX_OPEN_CONNS`, default 10), but the cap is per pod — the server
sees `replicas × maxOpenConns`, plus leader-election and fanout connections.

**Check.** `replicaCount × JARVIS_DB_MAX_OPEN_CONNS` must stay well below the
server's `max_connections`, minus the slots the server reserves for
superusers. Sizing guidance is in
[Persistence & high availability](persistence.md#configuration).

---

## Hourly `connection lost, reconnecting` in the logs

**Symptom.** On PostgreSQL, `fanout: connection lost, reconnecting` and
`listen: connection lost, reconnecting` with `unexpected EOF`, on a suspiciously
exact ~60-minute cadence.

**Cause.** Not a Jarvis fault. Those two connections carry no traffic unless
someone mutates something, and an idle timeout somewhere in the path — a
service mesh sidecar, a load balancer, a connection pooler — closes them.
Envoy's TCP proxy defaults to exactly one hour. TCP keepalives do not prevent
it, because the timeout counts application data.

**What to do.** Nothing, usually: both loops redial and re-subscribe
immediately, which is why they are logged at info level. If you want them
gone, raise the idle timeout for the PostgreSQL path in whatever sits in
front of it.

---

## An alert re-fired but the occurrence count did not move

**Symptom.** An alert resolved and fired again, and Jarvis shows one episode
instead of two.

**Cause.** By design. An alert that reappears within the grace period —
`max(60s, 2 × JARVIS_POLL_INTERVAL)` — reopens the existing episode instead of
starting a new one. Without it, a single missed poll would split one incident
into two and invent a resolve that never happened.

**Check.** If you are testing this deliberately, wait longer than the grace
period between resolving and re-firing. The reasoning is in
[Alert lifecycle](alert-lifecycle.md).

---

## Every alert briefly resolved at once

**Symptom.** A cluster's alerts all flipped to resolved and came back on the
next poll.

**Cause.** In older versions, a failed fetch was diffed as "zero alerts", which
looks identical to "everything resolved". A failed fetch now keeps the last
successful snapshot authoritative, so this should not happen — if it does,
check the version you are running and open an issue.

The log line to look for around the event is `poll cluster failed`.

---

## A silence was created but matches nothing

**Symptom.** Jarvis created the silence in Alertmanager, but the alerts it was
supposed to cover are still firing.

**Cause and check:**

1. **Matchers built from a label that Alertmanager does not have.** Jarvis
   shows cluster and receiver as chips, but they are not real alert labels
   upstream. A silence must match on the alert's own labels.
2. **Regex matchers are anchored in Alertmanager.** `instance=~"web"` does not
   match `web-01`; Alertmanager evaluates `^(?:web)$`. Use `web.*`.
3. **The silence was created against one Alertmanager of an HA pair.** Members
   gossip silences between themselves; if they are not actually clustered, the
   silence exists on one member only.

The affected-alerts preview in the silence dialog evaluates the same rules
Alertmanager does. If it says zero before you create the silence, believe it.

---

## Still stuck?

- [FAQ](faq.md) — the questions that come up before installing
- [Configuration](configuration.md) — every environment variable
- [Issues](https://github.com/kj187/jarvis/issues) — please include the Jarvis
  version, the database backend and the relevant log lines
