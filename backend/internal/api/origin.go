package api

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/originpolicy"
)

// originGuard rejects state-changing requests that a foreign page could have
// triggered from a browser. CORS alone does not stop this: a cross-site form or
// bodyless fetch still reaches the handler, the browser only hides the reply.
//
// A request passes when its Origin is this server's own host or one of
// JARVIS_ALLOWED_ORIGINS (the same rule the WebSocket upgrade applies, so no
// wildcard). Without an Origin header the request is let through unless the
// browser marked it Sec-Fetch-Site: cross-site; curl and other non-browser
// clients send neither header and cannot be driven by a victim's browser.
func originGuard(allowedOrigins []string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			switch c.Request().Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				return next(c)
			}
			if !mutationOriginAllowed(c.Request(), allowedOrigins) {
				return echo.NewHTTPError(http.StatusForbidden, "cross-origin request rejected")
			}
			return next(c)
		}
	}
}

func mutationOriginAllowed(r *http.Request, allowedOrigins []string) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") != "cross-site"
	}
	return originpolicy.Allowed(origin, r.Host, allowedOrigins)
}
