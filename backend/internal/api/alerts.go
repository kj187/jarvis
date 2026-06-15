package api

import (
	"net/http"
	"regexp"
	"sort"
	"strconv"

	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/labstack/echo/v4"
)

// Alertmanager generates 16-character lowercase hex fingerprints (FNV-1a hash).
var fingerprintRegex = regexp.MustCompile(`^[a-f0-9]{16}$`)

func validateFingerprint(fp string) bool {
	return fingerprintRegex.MatchString(fp)
}

// GET /api/v1/alerts
func (s *Server) getAlerts(c echo.Context) error {
	clusterFilter := c.QueryParam("cluster")
	severityFilter := c.QueryParam("severity")
	stateFilter := c.QueryParam("state")

	// Resolved alerts are served from the persistent DB so they survive beyond
	// the in-memory resolved buffer's 20-minute window.
	if stateFilter == "resolved" {
		dbAlerts, err := s.store.GetAllResolved()
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to get resolved alerts")
		}
		if clusterFilter == "" && severityFilter == "" {
			return c.JSON(http.StatusOK, dbAlerts)
		}
		var filtered []models.EnrichedAlert
		for _, a := range dbAlerts {
			if clusterFilter != "" && a.ClusterName != clusterFilter {
				continue
			}
			if severityFilter != "" && a.Labels["severity"] != severityFilter {
				continue
			}
			filtered = append(filtered, a)
		}
		return c.JSON(http.StatusOK, filtered)
	}

	// Active / suppressed alerts come from the in-memory store.
	alerts := s.alertStore.Get()
	if clusterFilter == "" && severityFilter == "" && stateFilter == "" {
		return c.JSON(http.StatusOK, alerts)
	}
	var filtered []models.EnrichedAlert
	for _, a := range alerts {
		if clusterFilter != "" && a.ClusterName != clusterFilter {
			continue
		}
		if severityFilter != "" && a.Labels["severity"] != severityFilter {
			continue
		}
		if stateFilter != "" && a.Status.State != stateFilter {
			continue
		}
		filtered = append(filtered, a)
	}
	return c.JSON(http.StatusOK, filtered)
}

// GET /api/v1/alerts/groups
func (s *Server) getAlertGroups(c echo.Context) error {
	alerts := s.alertStore.Get()

	type groupKey struct {
		alertname string
		severity  string
	}
	groups := make(map[groupKey]*models.AlertGroup)

	for _, a := range alerts {
		key := groupKey{
			alertname: a.Labels["alertname"],
			severity:  a.Labels["severity"],
		}
		g, ok := groups[key]
		if !ok {
			g = &models.AlertGroup{
				Alertname: key.alertname,
				Severity:  key.severity,
			}
			groups[key] = g
		}
		g.Alerts = append(g.Alerts, a)
		g.Count++
	}

	result := make([]models.AlertGroup, 0, len(groups))
	for _, g := range groups {
		result = append(result, *g)
	}
	// Sort by severity priority, then alertname.
	severityOrder := map[string]int{"critical": 0, "warning": 1, "info": 2, "none": 3, "": 4}
	sort.Slice(result, func(i, j int) bool {
		si := severityOrder[result[i].Severity]
		sj := severityOrder[result[j].Severity]
		if si != sj {
			return si < sj
		}
		return result[i].Alertname < result[j].Alertname
	})

	return c.JSON(http.StatusOK, result)
}

// GET /api/v1/alerts/:fingerprint/history
func (s *Server) getAlertHistory(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	offset, _ := strconv.Atoi(c.QueryParam("offset"))
	if limit <= 0 {
		limit = 20
	}

	events, total, err := s.store.GetHistory(fp, limit, offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get history")
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"events": events,
		"total":  total,
	})
}

// GET /api/v1/alerts/:fingerprint/silence-events
func (s *Server) getSilenceEvents(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	events, err := s.store.GetSilenceEvents(fp)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get silence events")
	}
	if events == nil {
		events = []models.SilenceEvent{}
	}
	return c.JSON(http.StatusOK, events)
}

// GET /api/v1/alerts/:fingerprint/stats
func (s *Server) getAlertStats(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	stats, err := s.store.GetStats(fp)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get stats")
	}
	if stats == nil {
		return echo.NewHTTPError(http.StatusNotFound, "fingerprint not found")
	}
	return c.JSON(http.StatusOK, stats)
}
