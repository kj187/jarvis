package metrics

import (
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
)

// skipHTTPMetrics are routes excluded from HTTP metrics: /metrics to avoid
// self-scraping noise, /health as a trivial liveness probe, /ws because a
// long-lived WebSocket upgrade has no meaningful "request duration".
var skipHTTPMetrics = map[string]struct{}{
	"/metrics": {},
	"/health":  {},
	"/ws":      {},
}

// EchoMiddleware records jarvis_http_requests_total and
// jarvis_http_request_duration_seconds for every request, labeled by the
// Echo route pattern (e.g. "/api/v1/alerts/:fingerprint/history") rather than
// the raw path, to keep label cardinality bounded. Unmatched routes (404) are
// labeled "unmatched".
func (m *Metrics) EchoMiddleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if _, ok := skipHTTPMetrics[c.Path()]; ok {
				return next(c)
			}

			start := time.Now()
			err := next(c)

			path := c.Path()
			if path == "" {
				path = "unmatched"
			}
			status := c.Response().Status
			if he, ok := err.(*echo.HTTPError); ok {
				status = he.Code
			}

			method := c.Request().Method
			statusStr := strconv.Itoa(status)
			m.HTTPRequestsTotal.WithLabelValues(method, path, statusStr).Inc()
			m.HTTPRequestDuration.WithLabelValues(method, path, statusStr).Observe(time.Since(start).Seconds())

			return err
		}
	}
}
