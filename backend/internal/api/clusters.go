package api

import (
	"net/http"

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

	clusters := s.registry.All()
	result := make([]models.ClusterInfo, 0, len(clusters))
	for _, cl := range clusters {
		upStates := cl.MemberUpStates()
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
			members = append(members, models.MemberInfo{Name: m.Name, URL: m.LinkURL, Healthy: up})
		}
		info := models.ClusterInfo{
			Name:            cl.Name,
			AlertmanagerURL: cl.AlertmanagerLinkURL,
			PrometheusURL:   cl.PrometheusURL,
			Healthy:         healthy,
			AlertCount:      clusterAlertCount[cl.Name],
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
	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":     "ok",
		"clusters":   len(s.registry.All()),
		"alerts":     totalAlerts,
		"ws_clients": s.hub.ClientCount(),
	})
}
