package api

import (
	"net"
	"net/http"
	"slices"
	"strings"

	"github.com/labstack/echo/v4"
)

// hostGuard answers 421 for a Host header outside JARVIS_ALLOWED_HOSTS, so a
// request that reached the pod through a name it was never meant to serve (DNS
// rebinding, a forged Host) does nothing. An empty list disables the check.
//
// An entry without a port matches that host on any port; an entry with a port
// matches only that port. The probe and scrape paths are exempt: kubelet and
// Prometheus address the pod by IP.
func hostGuard(allowed []string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		if len(allowed) == 0 {
			return next
		}
		return func(c echo.Context) error {
			switch c.Request().URL.Path {
			case "/health", "/health/live", "/health/ready", "/metrics":
				return next(c)
			}
			if !hostAllowed(c.Request().Host, allowed) {
				return echo.NewHTTPError(http.StatusMisdirectedRequest, "host not allowed")
			}
			return next(c)
		}
	}
}

func hostAllowed(host string, allowed []string) bool {
	host = strings.ToLower(host)
	if slices.Contains(allowed, host) {
		return true
	}
	name, _, err := net.SplitHostPort(host)
	return err == nil && slices.Contains(allowed, name)
}

// clientIPExtractor derives the client IP for logs. Without trusted proxies it
// is the TCP peer: Echo's default would believe X-Real-IP and X-Forwarded-For
// from anyone. With them, X-Forwarded-For is read from the right and only
// entries added by the listed proxies are skipped, so a forged left entry never
// wins. Echo's built-in trust of loopback and private ranges is switched off:
// only what the operator listed is trusted.
func clientIPExtractor(trusted []*net.IPNet) echo.IPExtractor {
	if len(trusted) == 0 {
		return echo.ExtractIPDirect()
	}
	opts := []echo.TrustOption{
		echo.TrustLoopback(false),
		echo.TrustLinkLocal(false),
		echo.TrustPrivateNet(false),
	}
	for _, n := range trusted {
		opts = append(opts, echo.TrustIPRange(n))
	}
	return echo.ExtractIPFromXFFHeader(opts...)
}
