package api

import (
	"context"
	"net/http"
	"time"

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
func (s *Server) getClusters(c echo.Context) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	allAlerts := s.alertStore.Get()
	clusterAlertCount := make(map[string]int)
	for _, a := range allAlerts {
		clusterAlertCount[a.ClusterName]++
	}

	clusters := s.registry.All()
	result := make([]models.ClusterInfo, 0, len(clusters))
	for _, cl := range clusters {
		statuses := cl.PingAll(ctx)
		healthy := false
		members := make([]models.MemberInfo, 0, len(statuses))
		for _, st := range statuses {
			if st.Healthy {
				healthy = true
			}
			members = append(members, models.MemberInfo{Name: st.Name, URL: st.URL, Healthy: st.Healthy})
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
