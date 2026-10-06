// Package originpolicy is the one Origin rule shared by the HTTP origin guard
// (internal/api) and the WebSocket upgrade (internal/ws), so that a host that
// may write may also receive the live stream (Critical Invariant #11). It is a
// neutral package because ws must not import api.
package originpolicy

import (
	"net/url"
	"slices"
)

// Allowed reports whether a non-empty Origin header may act on this server:
// it is listed in allowed (JARVIS_ALLOWED_ORIGINS, exact match, no wildcard),
// or its host equals the request's own Host. The scheme is deliberately not
// compared for the own-host case: behind a TLS-terminating proxy the backend
// sees http while the browser sends an https Origin. With an empty allow-list
// this is the same-origin-only rule.
//
// An empty Origin is not decided here; each caller owns that case (a
// non-browser client for the WebSocket, Sec-Fetch-Site for HTTP writes).
func Allowed(origin, requestHost string, allowed []string) bool {
	if origin == "" {
		return false
	}
	if slices.Contains(allowed, origin) {
		return true
	}
	u, err := url.Parse(origin)
	return err == nil && u.Host != "" && u.Host == requestHost
}
