// Package originpolicy is the one Origin rule shared by the HTTP origin guard
// (internal/api) and the WebSocket upgrade (internal/ws), so that a host that
// may write may also receive the live stream (Critical Invariant #11). It is a
// neutral package because ws must not import api.
package originpolicy

import (
	"net/url"
	"strings"
)

// Allowed reports whether a non-empty Origin header may act on this server:
// it is listed in allowed (JARVIS_ALLOWED_ORIGINS, no wildcard), or it is an
// http(s) origin whose host equals the request's own Host. The http-vs-https
// choice is deliberately not compared for the own-host case: behind a TLS-terminating proxy the backend
// sees http while the browser sends an https Origin. With an empty allow-list
// this is the same-origin-only rule.
//
// An empty Origin is not decided here; each caller owns that case (a
// non-browser client for the WebSocket, Sec-Fetch-Site for HTTP writes).
func Allowed(origin, requestHost string, allowed []string) bool {
	if origin == "" {
		return false
	}
	// Scheme and host are case-insensitive; browsers send them lower-case.
	for _, a := range allowed {
		if strings.EqualFold(a, origin) {
			return true
		}
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return strings.EqualFold(u.Host, requestHost)
}
