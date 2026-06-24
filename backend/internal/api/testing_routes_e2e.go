//go:build e2e

package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

// registerTestRoutes wires the e2e-only seed/reset endpoints. These are gated
// behind the "e2e" build tag and MUST NOT be present in production builds.
func (s *Server) registerTestRoutes(g *echo.Group) {
	slog.Warn("e2e test routes enabled (/api/v1/test/*) — never run this build in production")
	g.POST("/test/reset", s.testReset)
	g.POST("/test/seed", s.testSeed)
}

type seedAlert struct {
	Fingerprint string            `json:"fingerprint"`
	Alertname   string            `json:"alertname"`
	Cluster     string            `json:"cluster"`
	AlertmanURL string            `json:"alertmanagerUrl"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    time.Time         `json:"startsAt"`
	ResolvedAt  *time.Time        `json:"resolvedAt"`
}

type seedRequest struct {
	Resolved []seedAlert `json:"resolved"`
}

// POST /api/v1/test/reset — truncates all history tables and clears the in-memory store.
func (s *Server) testReset(c echo.Context) error {
	if err := s.store.ResetForTesting(); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}
	s.alertStore.Set(nil)
	return c.NoContent(http.StatusNoContent)
}

// POST /api/v1/test/seed — inserts resolved-alert lifecycles directly into the DB.
func (s *Server) testSeed(c echo.Context) error {
	var req seedRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	now := time.Now().UTC()
	for _, a := range req.Resolved {
		starts := a.StartsAt
		if starts.IsZero() {
			starts = now.Add(-1 * time.Hour)
		}
		resolved := now
		if a.ResolvedAt != nil {
			resolved = *a.ResolvedAt
		}
		if err := s.store.SeedResolvedForTesting(
			a.Fingerprint, a.Alertname, a.Cluster, a.AlertmanURL,
			a.Labels, a.Annotations, starts, resolved,
		); err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
		}
	}

	return c.JSON(http.StatusOK, map[string]int{"resolved": len(req.Resolved)})
}
