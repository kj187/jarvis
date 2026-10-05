//go:build !e2e

package api

import (
	"time"

	"github.com/labstack/echo/v4"
)

// defaultManualPollMinInterval is the minimum gap between two manual polls.
const defaultManualPollMinInterval = 5 * time.Second

// registerTestRoutes is a no-op in production builds. The e2e seed/reset
// endpoints are only compiled in when built with the "e2e" build tag.
func (s *Server) registerTestRoutes(_ *echo.Group) {}
