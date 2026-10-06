package api

import (
	"net/http"

	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/version"
	"github.com/labstack/echo/v4"
)

// GET /health
func (s *Server) getHealth(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

// GET /api/v1/info
func (s *Server) getInfo(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"version": version.Version})
}

// GET /api/v1/clusters
//
// Health is derived from the cached per-member up-state of the last recorder
// poll (≤ one JARVIS_POLL_INTERVAL old) — never live-pings Alertmanager, so
// client count does not influence AM load.
func (s *Server) getClusters(c echo.Context) error {
	allAlerts := s.alertStore.Get()
	clusterAlertCount := make(map[string]int)
	for _, a := range allAlerts {
		clusterAlertCount[a.ClusterName]++
	}

	var freshness map[string]history.ClusterFreshness
	if src, ok := s.pollTrigger.(clusterFreshnessSource); ok {
		freshness = src.ClusterFreshness()
	}

	var recorderUp map[string]map[string]bool
	if src, ok := s.pollTrigger.(clusterUpStateSource); ok {
		recorderUp = src.ClusterUpStates()
	}

	clusters := s.registry.All()
	result := make([]models.ClusterInfo, 0, len(clusters))
	for _, cl := range clusters {
		upStates := cl.MemberUpStates()
		if states, ok := recorderUp[cl.Name]; ok {
			upStates = states
		}
		healthy := false
		members := make([]models.MemberInfo, 0, len(cl.Members))
		for _, m := range cl.Members {
			// A member without poll state yet (first ~one interval after
			// startup) counts as healthy — same optimism as cluster.writeOrder.
			up, known := upStates[m.Name]
			if !known {
				up = true
			}
			if up {
				healthy = true
			}
			members = append(members, models.MemberInfo{Name: m.Name, URL: config.StripUserinfo(m.LinkURL), Healthy: up})
		}
		info := models.ClusterInfo{
			Name:            cl.Name,
			AlertmanagerURL: config.StripUserinfo(cl.AlertmanagerLinkURL),
			PrometheusURL:   config.StripUserinfo(cl.PrometheusURL),
			Healthy:         healthy,
			AlertCount:      clusterAlertCount[cl.Name],
		}
		if f, ok := freshness[cl.Name]; ok {
			info.Stale = f.Stale
			if !f.LastSuccessAt.IsZero() {
				at := f.LastSuccessAt.UTC()
				info.LastSuccessfulPollAt = &at
			}
		}
		// Members is only populated for HA clusters — single-member clusters
		// keep the payload byte-identical to before.
		if len(cl.Members) > 1 {
			info.Members = members
		}
		result = append(result, info)
	}
	return c.JSON(http.StatusOK, result)
}

// GET /api/v1/status
func (s *Server) getStatus(c echo.Context) error {
	totalAlerts := len(s.alertStore.Get())
	status, database := "ok", "ok"
	if !s.databaseOK(c.Request().Context()) {
		status, database = "degraded", "unavailable"
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":                status,
		"database":              database,
		"clusters":              len(s.registry.All()),
		"alerts":                totalAlerts,
		"ws_clients":            s.hub.ClientCount(),
		"leader":                s.pollTrigger.IsLeader(),
		"poll_interval_seconds": s.cfg.PollInterval.Seconds(),
		// Effective resolved-buffer window (JARVIS_RESOLVED_BUFFER_TTL), so the UI can say how long
		// a recently resolved alert stays in the live view.
		"resolved_buffer_ttl_seconds": s.alertStore.ResolvedTTL().Seconds(),
	})
}
