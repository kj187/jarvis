package api

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

const (
	dbPingTimeout = 2 * time.Second
	dbHealthTTL   = 5 * time.Second
)

// dbHealth caches the result of a database ping for dbHealthTTL, so a
// readiness probe plus UI polling of /api/v1/status never add more than one
// ping per window.
type dbHealth struct {
	mu        sync.Mutex
	checkedAt time.Time
	ok        bool
}

func (h *dbHealth) check(ctx context.Context, ping func(context.Context) error) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if !h.checkedAt.IsZero() && time.Since(h.checkedAt) < dbHealthTTL {
		return h.ok
	}
	ctx, cancel := context.WithTimeout(ctx, dbPingTimeout)
	defer cancel()
	h.ok = ping(ctx) == nil
	h.checkedAt = time.Now()
	return h.ok
}

func (h *dbHealth) reset() {
	h.mu.Lock()
	h.checkedAt = time.Time{}
	h.mu.Unlock()
}

func (s *Server) databaseOK(ctx context.Context) bool {
	return s.dbHealth.check(ctx, s.store.Ping)
}

// GET /health/live — the process is up and serving HTTP; no dependency checks.
func (s *Server) getHealthLive(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

// GET /health/ready — ready only while the database answers. An Alertmanager
// outage deliberately does not count: it would take every pod out of the
// Service endpoints and turn a partial outage into a total one.
func (s *Server) getHealthReady(c echo.Context) error {
	if !s.databaseOK(c.Request().Context()) {
		return c.JSON(http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
	}
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}
