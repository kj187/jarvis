package api

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

// metricsAuth requires "Authorization: Bearer <token>" on /metrics when
// JARVIS_METRICS_TOKEN is set. Without a token the endpoint stays open, as it
// always was, so existing scrape configurations keep working.
func metricsAuth(token string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		if token == "" {
			return next
		}
		want := []byte(token)
		return func(c echo.Context) error {
			got, ok := strings.CutPrefix(c.Request().Header.Get(echo.HeaderAuthorization), "Bearer ")
			if !ok || subtle.ConstantTimeCompare([]byte(got), want) != 1 {
				c.Response().Header().Set(echo.HeaderWWWAuthenticate, `Bearer realm="jarvis-metrics"`)
				return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
			}
			return next(c)
		}
	}
}
