# Deploy with Compose

Jarvis runs as a single container: the frontend is embedded in the Go
binary, and SQLite needs no external service. Everything below works with
Podman and Docker alike — replace `podman` with `docker` in any command.

This page assumes you have an Alertmanager to point Jarvis at. If you do
not, or you are still evaluating, the [local demo](demo.md) starts Jarvis
and a throwaway Alertmanager with demo alerts in five minutes.

The image tag used on this page is the current release. Available tags are
listed on the [releases page](https://github.com/kj187/jarvis/releases).

---

No clone and no build step — everything runs from the published image.

**This snippet does not start an Alertmanager.** It assumes you have one and
that Jarvis can reach it: `http://alertmanager:9093` only resolves if such a
service exists on the same compose network. Point it at your own instance
instead — and if you just want to see Jarvis working first, the
[local demo](demo.md) starts both, with demo alerts.

```yaml
services:
  jarvis:
    image: ghcr.io/kj187/jarvis:1.12.0
    ports:
      - "8080:8080"
    volumes:
      - jarvis_data:/data
    environment:
      JARVIS_CLUSTER_1_NAME: dev
      JARVIS_CLUSTER_1_ALERTMANAGER_URL: http://alertmanager:9093
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL

volumes:
  jarvis_data:
```

```bash
podman compose up -d
```

Jarvis is now on <http://localhost:8080>. It polls Alertmanager every 15
seconds; alerts appear without a reload.

**The volume matters.** `/data` holds the SQLite database with the alert
history, claims and comments. Without it, every restart starts from an empty
history — the alerts themselves come back from Alertmanager, but everything
Jarvis recorded about them is gone.

**At least one cluster is required.** `JARVIS_CLUSTER_1_NAME` and
`JARVIS_CLUSTER_1_ALERTMANAGER_URL` are the minimum; Jarvis refuses to start
without them. Add more clusters with `JARVIS_CLUSTER_2_*`,
`JARVIS_CLUSTER_3_*` and so on, and see
[Configuration](configuration.md) for everything else.

## Running it behind a different URL

When the browser reaches Jarvis under a name other than the backend's own
host — a reverse proxy, an ingress, a different port — set the origins that
are allowed to talk to it, otherwise the WebSocket connection is rejected:

```yaml
environment:
  JARVIS_ALLOWED_ORIGINS: https://jarvis.example.com
```

The proxy also has to pass the WebSocket upgrade through. Worked
configurations for nginx, Traefik, Caddy and ingress controllers are in
[Behind a proxy](reverse-proxy.md).

---

## Where to go next

- [Configuration](configuration.md) — every environment variable
- [Features](features.md) — what the UI can do
- [Set up user login](authentication-user.md) — login via built-in accounts or OIDC
- [Connect a protected Alertmanager](authentication-alertmanager.md) — for a protected upstream
- [Upgrade](upgrade.md) — verifying signatures, upgrading in place
