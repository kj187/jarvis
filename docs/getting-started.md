# Getting Started

This quick start runs Jarvis against an Alertmanager you already have. You
need Podman or Docker and an Alertmanager URL that the Jarvis container can
reach. If you only want to explore the UI, use the
[local demo](demo.md) instead—it starts a disposable Alertmanager and fills it
with realistic alerts for you.

## 1. Create the Compose file

Save this as `compose.yml` and replace the Alertmanager URL with your own:

```yaml
services:
  jarvis:
    image: ghcr.io/kj187/jarvis:1.12.0
    ports:
      - "8080:8080"
    volumes:
      - jarvis_data:/data
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    environment:
      JARVIS_CLUSTER_1_NAME: production
      JARVIS_CLUSTER_1_ALERTMANAGER_URL: http://alertmanager:9093
    restart: unless-stopped

volumes:
  jarvis_data:
```

The URL is resolved from inside the Jarvis container. If Alertmanager runs on
another host or network, use an address reachable from that container—not
`localhost` unless Alertmanager is in the same container.

## 2. Start Jarvis

```bash
podman compose up -d
```

Docker users can run `docker compose up -d` instead. Open
<http://localhost:8080>; alerts appear after the first poll, normally within
15 seconds.

## 3. Take the first steps

Jarvis needs no account by default. Start with
[First steps in the UI](first-steps.md) to claim an alert, add a comment,
filter the list, and preview a silence.

When you are ready to expand the setup:

- [Connect Alertmanager](deploy-alertmanager.md) explains multiple clusters,
  Alertmanager HA members, aliases, and deduplication.
- [Connect a protected Alertmanager](authentication-alertmanager.md) covers
  OAuth2, bearer tokens, basic authentication, and custom headers.
- [Install with Compose](deploy-compose.md) covers configuration, persistence,
  upgrades, and production operation in detail.
- [Install on Kubernetes](deploy-kubernetes.md) provides the Helm path.
