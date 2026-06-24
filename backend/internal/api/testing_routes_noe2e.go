//go:build !e2e

package api

import (
	"github.com/labstack/echo/v4"
	"golang.org/x/time/rate"
)

// registerTestRoutes is a no-op in production builds. The e2e seed/reset
// endpoints are only compiled in when built with the "e2e" build tag.
func (s *Server) registerTestRoutes(_ *echo.Group) {}

// Poll rate limit for POST /api/v1/poll in production builds: 0.2 req/s (1/5s), burst 2.
const (
	pollRLRate  rate.Limit = 0.2
	pollRLBurst int        = 2
)
