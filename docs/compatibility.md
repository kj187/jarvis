# Compatibility

Jarvis uses the **Alertmanager HTTP API v2** exclusively (`/api/v2/alerts`,
`/api/v2/silences`, `/api/v2/status`). API v2 was introduced in Alertmanager
**0.16.0**.

| Requirement | Version |
|---|---|
| Minimum | 0.16.0 |
| Tested with | 0.27.x · 0.28.x |

Any release shipping API v2 should work. If you run into a compatibility
issue with a specific version, please
[open an issue](https://github.com/kj187/jarvis/issues).
