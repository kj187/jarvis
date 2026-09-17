# Running Jarvis behind a proxy

Jarvis works behind nginx, Traefik, Caddy or a Kubernetes ingress, but two
things have to be right or the UI loads and then never updates: the **allowed
origins** and the **WebSocket upgrade**. Both fail quietly, which is why they
get their own page.

- [The one setting people miss](#the-one-setting-people-miss)
- [WebSocket passthrough](#websocket-passthrough)
- [nginx](#nginx)
- [Traefik](#traefik)
- [Caddy](#caddy)
- [Kubernetes ingress](#kubernetes-ingress)
- [Jarvis must own the root path](#jarvis-must-own-the-root-path)

---

## The one setting people miss

`JARVIS_ALLOWED_ORIGINS` must contain the URL **the browser uses**, not the
address the proxy talks to.

```yaml
environment:
  JARVIS_ALLOWED_ORIGINS: https://jarvis.example.com
```

Unset, Jarvis accepts same-origin requests only: an `Origin` header is
compared against the request's own `Host`, with either scheme. That is exactly
right when you reach Jarvis directly, and always wrong behind a proxy, because
the browser sends `https://jarvis.example.com` while the backend sees its own
internal host.

Set, the comparison is an **exact string match** against the list. Three
consequences worth knowing before debugging for an hour:

- **Scheme, host and port must all match.** `https://jarvis.example.com` does
  not match `http://jarvis.example.com`, and `http://jarvis.example.com:8080`
  is a different origin than `http://jarvis.example.com`.
- **No trailing slash.** An origin is `scheme://host[:port]` — nothing else.
- **No wildcards.** `*` is not accepted, by design. List every hostname you
  serve Jarvis under, separated by commas.

The same list governs both HTTP CORS and the WebSocket upgrade, so getting it
wrong breaks the live updates and the API calls in one go.

---

## WebSocket passthrough

Jarvis pushes alert updates over a WebSocket at `/ws`. The proxy has to:

- speak **HTTP/1.1** upstream (HTTP/1.0 has no upgrade mechanism),
- forward the `Upgrade` and `Connection` headers untouched,
- allow a **long-lived** connection — the read timeout must be generous, or
  the connection is cut every few seconds and the UI reconnects in a loop.

If live updates do not arrive but reloading the page shows current data, this
is the cause.

---

## nginx

```nginx
server {
    listen 443 ssl;
    server_name jarvis.example.com;

    location / {
        proxy_pass http://jarvis:8080;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket upgrade
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;
    }
}
```

With `JARVIS_ALLOWED_ORIGINS=https://jarvis.example.com` on the Jarvis
container.

---

## Traefik

Traefik forwards WebSocket upgrades without extra configuration; the part that
still needs attention is the origin list.

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.jarvis.rule=Host(`jarvis.example.com`)
  - traefik.http.routers.jarvis.entrypoints=websecure
  - traefik.http.routers.jarvis.tls=true
  - traefik.http.services.jarvis.loadbalancer.server.port=8080
environment:
  JARVIS_ALLOWED_ORIGINS: https://jarvis.example.com
```

---

## Caddy

```text
jarvis.example.com {
    reverse_proxy jarvis:8080
}
```

Caddy handles the upgrade and the forwarded headers on its own. Set
`JARVIS_ALLOWED_ORIGINS=https://jarvis.example.com` and you are done.

---

## Kubernetes ingress

Same two requirements, expressed in chart values:

```yaml
config:
  allowedOrigins: "https://jarvis.example.com"

ingress:
  enabled: true
  hosts:
    - host: jarvis.example.com
      paths:
        - path: /
          pathType: Prefix
```

Most ingress controllers pass WebSockets through untouched. **ingress-nginx
does not** — it needs explicit annotations. The worked example, including the
`configuration-snippet` and the timeouts, is in the
[chart README](https://github.com/kj187/jarvis/blob/main/charts/jarvis/README.md#ingress-with-websocket-support).

---

## Jarvis must own the root path

The frontend requests `/api/v1/...` and connects to `/ws` as absolute paths on
whatever host it was loaded from. Serving Jarvis under a sub-path —
`https://ops.example.com/jarvis/` — therefore does not work: the browser would
ask for `https://ops.example.com/api/v1/alerts` and get whatever else lives
there.

Give it its own hostname or subdomain. A sub-path deployment would need path
rewriting on both the assets and the WebSocket, which Jarvis does not support.

---

## Still not working?

[Troubleshooting](troubleshooting.md) lists the symptoms — "the UI loads but
nothing updates", "WebSocket connection failed" — with what to check for each.
