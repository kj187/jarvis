# Alertmanager Authentication (per-cluster)

When an Alertmanager instance is protected by an authentication proxy (e.g. oauth2-proxy, nginx basic auth, or a service mesh policy), Jarvis can be configured to send credentials with every outgoing request.

> **Note:** Jarvis polls Alertmanager in the background on a timer — there is no "current user" during polling. Per-cluster auth is service-level: Jarvis authenticates as a service account, not as the signed-in user.

This is separate from [user authentication](authentication-user.md), which controls how humans log in to the Jarvis UI.

---

## Methods

### OAuth2 Client Credentials (recommended for OIDC proxies)

When Alertmanager sits behind an oauth2-proxy that uses the same OIDC provider as Jarvis (e.g. Keycloak), the cleanest approach is to give Jarvis its own service account via the [client_credentials grant](https://www.rfc-editor.org/rfc/rfc6749#section-4.4). Jarvis fetches a token on startup, caches it, and automatically refreshes it 30 seconds before expiry — no manual token rotation required.

```env
JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID=jarvis-service
JARVIS_CLUSTER_1_OAUTH2_CLIENT_SECRET=<client-secret>
JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL=https://keycloak.example.com/realms/homelab/protocol/openid-connect/token
# Optional — only set if your provider requires specific scopes:
JARVIS_CLUSTER_1_OAUTH2_SCOPES=openid,profile
```

**Keycloak setup:**
1. Create a new client in your realm (e.g. `jarvis-service`)
2. Enable **Client authentication** and set **Authentication flow** to *Service accounts roles* (client_credentials)
3. Copy the client secret from the **Credentials** tab
4. Set the token URL to `https://<keycloak-host>/realms/<realm>/protocol/openid-connect/token`

**Token lifecycle:**
- Fetched once on first Alertmanager request
- Cached in memory for the duration of `expires_in` returned by the token endpoint
- Proactively refreshed 30 seconds before expiry
- Immediately re-fetched on a `401 Unauthorized` response (one retry)
- If `expires_in` is absent, a 5-minute TTL is assumed

---

### Bearer Token (static)

```env
JARVIS_CLUSTER_1_BEARER_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
```

Sent as `Authorization: Bearer <token>` on every request. Use for oauth2-proxy with a static service token or any API-key-based auth layer. No automatic refresh — rotate manually when the token expires.

---

### Basic Auth

```env
JARVIS_CLUSTER_1_BASIC_AUTH_USER=jarvis
JARVIS_CLUSTER_1_BASIC_AUTH_PASSWORD=secret
```

Sent as `Authorization: Basic <base64>`. Use when Alertmanager or its proxy enforces HTTP basic authentication.

---

### Custom Headers

```env
JARVIS_CLUSTER_1_HEADER_X-Scope-OrgID=tenant1
JARVIS_CLUSTER_1_HEADER_Authorization=Bearer some-token
```

The substring after `HEADER_` is used as the header name verbatim. Use for multi-tenant setups (e.g. Cortex / Mimir's `X-Scope-OrgID`) or any non-standard auth header.

---

## Priority

When multiple options are configured for the same cluster, the highest-priority option wins for the `Authorization` header:

| Priority | Method | Notes |
|---|---|---|
| 1 (highest) | OAuth2 Client Credentials | Dynamic, auto-refresh |
| 2 | Bearer Token | Static |
| 3 | Basic Auth | Static |
| 4 (lowest) | Custom Headers | Set first, overridden by the above |

---

## Full Example — OIDC login + Alertmanager behind oauth2-proxy (same realm)

Both Jarvis user auth and Alertmanager upstream auth use the same Keycloak realm, but with separate clients:

```env
# User auth — Jarvis UI login via OIDC
JARVIS_AUTH_PROVIDER=oidc
JARVIS_AUTH_OIDC_ISSUER=https://keycloak.example.com/realms/homelab
JARVIS_AUTH_OIDC_CLIENT_ID=jarvis
JARVIS_AUTH_OIDC_CLIENT_SECRET=<jarvis-client-secret>
JARVIS_AUTH_OIDC_REDIRECT_URL=https://jarvis.example.com/auth/oidc/callback

# Alertmanager upstream auth — service account, auto token refresh
JARVIS_CLUSTER_1_NAME=production
JARVIS_CLUSTER_1_ALERTMANAGER_URL=https://alertmanager-internal.example.com
JARVIS_CLUSTER_1_OAUTH2_CLIENT_ID=jarvis-service
JARVIS_CLUSTER_1_OAUTH2_CLIENT_SECRET=<jarvis-service-client-secret>
JARVIS_CLUSTER_1_OAUTH2_TOKEN_URL=https://keycloak.example.com/realms/homelab/protocol/openid-connect/token
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `JARVIS_CLUSTER_N_OAUTH2_CLIENT_ID` | OAuth2 client ID for the `client_credentials` grant. Takes priority over all other auth options when set. |
| `JARVIS_CLUSTER_N_OAUTH2_CLIENT_SECRET` | OAuth2 client secret. Never logged. |
| `JARVIS_CLUSTER_N_OAUTH2_TOKEN_URL` | Token endpoint URL. Required when `OAUTH2_CLIENT_ID` is set. |
| `JARVIS_CLUSTER_N_OAUTH2_SCOPES` | Comma-separated OAuth2 scopes (optional, e.g. `openid,profile`). |
| `JARVIS_CLUSTER_N_BEARER_TOKEN` | Static bearer token sent as `Authorization: Bearer <token>`. Never logged. |
| `JARVIS_CLUSTER_N_BASIC_AUTH_USER` | HTTP Basic Auth username. |
| `JARVIS_CLUSTER_N_BASIC_AUTH_PASSWORD` | HTTP Basic Auth password. Never logged. |
| `JARVIS_CLUSTER_N_HEADER_<name>` | Custom request header `<name>`. Repeat the variable with different names for multiple headers. |

---

## Security Notes

- `OAUTH2_CLIENT_SECRET`, `BEARER_TOKEN`, and `BASIC_AUTH_PASSWORD` are never written to logs.
- Use dedicated service accounts with minimal scopes — do not reuse the Jarvis UI OIDC client for upstream auth.
- Prefer OAuth2 Client Credentials over static tokens wherever your OIDC provider supports it — tokens are short-lived and automatically rotated.
