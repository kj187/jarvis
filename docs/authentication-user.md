# Authentication (User Login)

This document covers how **users authenticate to the Jarvis UI** — browser login, session management, roles, and provider setup.

For how Jarvis authenticates against a **protected Alertmanager** (service-to-service), see [authentication-alertmanager.md](authentication-alertmanager.md).

---

Jarvis supports three authentication modes, controlled by the `JARVIS_AUTH_PROVIDER` environment variable.

| Mode | Description |
|------|-------------|
| `none` | No login required. All write actions are publicly accessible. Default. |
| `internal` | Local user accounts with bcrypt passwords. A first-run wizard creates the admin account. |
| `oidc` | Delegate login to an external OIDC provider (Keycloak, Authentik, Dex, etc.). |

---

## Quick Start

### No authentication (default)

```env
JARVIS_AUTH_PROVIDER=none
```

Anyone who can reach Jarvis can read alerts and perform write actions (claims, comments, silences). Suitable for private networks with no external access.

On first load, Jarvis shows a one-time notice explaining that authentication is not configured:

![No-auth notice](assets/auth-noauth-notice.png)

### Internal accounts

```env
JARVIS_AUTH_PROVIDER=internal
JARVIS_SECRET_KEY=<min 32 random bytes>
```

On first access, Jarvis redirects to `/setup` where you create the initial admin account. Additional users are managed via the admin panel at `/admin/users`.

Generate a secret key:

```bash
openssl rand -hex 32
```

### OIDC (Keycloak, Authentik, etc.)

```env
JARVIS_AUTH_PROVIDER=oidc
JARVIS_SECRET_KEY=<min 32 random bytes>
JARVIS_AUTH_OIDC_ISSUER=https://keycloak.example.com/realms/myrealm
JARVIS_AUTH_OIDC_CLIENT_ID=jarvis
JARVIS_AUTH_OIDC_CLIENT_SECRET=<client-secret>
JARVIS_AUTH_OIDC_REDIRECT_URL=https://jarvis.example.com/auth/oidc/callback
JARVIS_AUTH_OIDC_SCOPES=openid,profile,email
```

---

## Protection Level (`JARVIS_AUTH_MODE`)

When `JARVIS_AUTH_PROVIDER` is `internal` or `oidc`, `JARVIS_AUTH_MODE` determines how strictly unauthenticated access is blocked.

| Value | Behaviour |
|-------|-----------|
| `write_protect` | (default) Unauthenticated users can view alerts and silences read-only. Write operations — creating/deleting comments, claims, and silences — require a valid session. A **Login** button appears in the header. |
| `full_protect` | All API routes and the UI require authentication. Unauthenticated users are shown a full-screen login page and cannot access any alert data until they sign in. |

`JARVIS_AUTH_MODE` is **ignored** (forced to `none`) when `JARVIS_AUTH_PROVIDER=none`.

**Choosing a mode:**

- Use `write_protect` for internal teams where read access to alerts is acceptable without login (e.g. NOC screens, ops dashboards).
- Use `full_protect` for public-facing deployments or any environment where alert data must not be visible to unauthenticated users.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JARVIS_AUTH_PROVIDER` | no | `none` | Authentication mode: `none`, `internal`, or `oidc` |
| `JARVIS_AUTH_MODE` | no | `write_protect` | Protection level when provider ≠ `none`: `write_protect` or `full_protect` |
| `JARVIS_SECRET_KEY` | for `internal`/`oidc` | — | Key for signing JWT session tokens. Min 32 bytes (hex or base64). Never logged. |
| `JARVIS_AUTH_OIDC_ISSUER` | for `oidc` | — | OIDC provider issuer URL |
| `JARVIS_AUTH_OIDC_CLIENT_ID` | for `oidc` | — | OIDC client ID |
| `JARVIS_AUTH_OIDC_CLIENT_SECRET` | for `oidc` | — | OIDC client secret |
| `JARVIS_AUTH_OIDC_REDIRECT_URL` | for `oidc` | — | Callback URL (must match provider config) |
| `JARVIS_AUTH_OIDC_SCOPES` | no | `openid,profile,email` | Comma-separated OIDC scopes |
| `JARVIS_OIDC_ADMIN_CLAIM` | no | — | Token claim that grants the admin role, e.g. `groups`. Needs `JARVIS_OIDC_ADMIN_VALUE` — see [Role Mapping](#role-mapping) |
| `JARVIS_OIDC_ADMIN_VALUE` | no | — | Value that claim must contain, e.g. `jarvis-admins` |

---

## Internal Provider — First-Run Wizard

When `JARVIS_AUTH_PROVIDER=internal` and no admin account exists in the database, Jarvis redirects every request to `/setup`.

1. Open Jarvis in the browser — you land on the setup page automatically.
2. Enter a username and password (min 12 characters).
3. Submit — the admin account is created and you are redirected to the main view.

The setup endpoint is disabled once at least one user exists in the database.

![First-run setup page](assets/auth-setup.png)

After setup, users log in via the login modal (triggered by the **Login** button in the header):

![Login modal — internal](assets/auth-login-internal.png)

### Admin Panel

Admins can manage users at `/admin/users`:

- Create new users (role: `user` or `admin`)
- Reset passwords
- Delete users

The admin panel is only accessible to users with the `admin` role. Open it from the user menu in the header (top right corner).

![User menu](assets/auth-user-menu.png)

![Admin panel — User Management](assets/auth-admin-panel.png)

---

## OIDC Provider

Jarvis uses the **Authorization Code Flow with PKCE**. No client-side secrets are exposed to the browser.

Users are redirected to the OIDC provider on login. The login modal shows a single **Login with SSO** button:

![Login modal — OIDC](assets/auth-login-oidc.png)

### Flow

![OIDC login flow](assets/oidc-login-flow.svg)

(source: [`docs/diagrams/oidc-login-flow.mmd`](diagrams/oidc-login-flow.mmd), re-render via `make diagrams`)

### Keycloak Setup

1. Create a new client in your realm with:
   - **Client ID**: `jarvis`
   - **Client authentication**: on (confidential client)
   - **Valid redirect URIs**: `https://jarvis.example.com/auth/oidc/callback`
2. Copy the client secret from the **Credentials** tab.
3. Set `JARVIS_AUTH_OIDC_ISSUER=https://keycloak.example.com/realms/<realm>`.

### Authentik Setup

1. Create an **OAuth2/OpenID Provider** with:
   - **Authorization flow**: default (implicit or explicit)
   - **Redirect URIs**: `https://jarvis.example.com/auth/oidc/callback`
2. Create an **Application** linked to that provider.
3. Set `JARVIS_AUTH_OIDC_ISSUER=https://authentik.example.com/application/o/<slug>/`.

### Role Mapping

OIDC users get the `user` role by default. There are two ways to grant admin
rights.

**From a token claim.** Set both variables and Jarvis reads the role straight
from the ID token on every login:

```env
JARVIS_OIDC_ADMIN_CLAIM=groups
JARVIS_OIDC_ADMIN_VALUE=jarvis-admins
```

The claim may be a single string or a list — Keycloak's `groups` and
Cognito's `cognito:groups` both work. A user whose claim contains the
configured value becomes `admin`, everyone else stays `user`. Because this is
evaluated at each login, revoking the group in the identity provider takes
effect the next time the user signs in.

**Manually.** With no claim mapping configured, an existing admin promotes the
user in the admin panel after their first login.

---

## Sessions

Sessions are stored as signed JWT cookies:

| Property | Value |
|----------|-------|
| Cookie name | `jarvis_session` |
| TTL | 24 hours |
| HttpOnly | yes (not accessible via JavaScript) |
| SameSite | Lax |
| Secure | yes when served over HTTPS (detected via `X-Forwarded-Proto`) |

## User Settings Storage

With an auth provider active, a signed-in user's Settings (theme, default
view, saved filters, etc. — see [Features → User Settings](features.md#user-settings))
are stored server-side against the account and follow them across devices.
Without an auth provider (`JARVIS_AUTH_PROVIDER` unset) — or while signed out
in `write_protect` mode — settings stay in that browser's `localStorage`
only. Signing in for the first time on a device copies any local settings to
the account once; after that the account always wins. Signing out falls back
to the browser's own settings without touching the account's.

---

## Roles

| Role | Capabilities |
|------|-------------|
| `user` | Read alerts, create/delete own claims and comments, create silences |
| `admin` | All `user` capabilities + manage users via `/admin/users` |

---

## Kubernetes / Helm

```yaml
auth:
  provider: internal    # none | internal | oidc
  mode: ""              # write_protect (default) | full_protect — ignored when provider=none
  secretKey: ""         # use existingSecret in production
  existingSecret: ""    # K8s Secret containing secret-key (and oidc-client-secret)
  existingSecretKeys:
    secretKey: secret-key
    oidcClientSecret: oidc-client-secret
  oidc:
    issuer: ""
    clientId: ""
    clientSecret: ""    # stored in the auth Secret
    redirectUrl: ""
    scopes: "openid,profile,email"
```

### Internal auth with chart-managed secret

```yaml
auth:
  provider: internal
  secretKey: "$(openssl rand -hex 32)"
```

### Internal auth with external secret

```bash
kubectl create secret generic jarvis-auth \
  --from-literal=secret-key=$(openssl rand -hex 32)
```

```yaml
auth:
  provider: internal
  existingSecret: jarvis-auth
```

### OIDC with external secret

```bash
kubectl create secret generic jarvis-auth \
  --from-literal=secret-key=$(openssl rand -hex 32) \
  --from-literal=oidc-client-secret=<your-client-secret>
```

```yaml
auth:
  provider: oidc
  existingSecret: jarvis-auth
  oidc:
    issuer: https://keycloak.example.com/realms/myrealm
    clientId: jarvis
    redirectUrl: https://jarvis.example.com/auth/oidc/callback
```

For a full values reference see [charts/jarvis/README.md](../charts/jarvis/README.md).

---

## Security Notes

- `JARVIS_SECRET_KEY` is never written to logs. Use at least 32 random bytes.
- OIDC client secret is stored in a Kubernetes Secret, not in the ConfigMap.
- The `/setup` endpoint is automatically disabled once any user account exists.
- All cookies are `HttpOnly` — the session token is not readable by JavaScript.
- `SameSite=Lax` prevents CSRF on cross-site form submissions.
- The admin panel (`/admin/users`) requires the `admin` role and is protected by `RequireAdmin` middleware.

For a full security discussion see [SECURITY.md](SECURITY.md).
