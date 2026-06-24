//go:build !e2e

package api

import "github.com/labstack/echo/v4"

// registerTestRoutes is a no-op in production builds. The e2e seed/reset
// endpoints are only compiled in when built with the "e2e" build tag.
func (s *Server) registerTestRoutes(_ *echo.Group) {}
