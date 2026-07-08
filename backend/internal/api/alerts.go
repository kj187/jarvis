package api

import (
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/labstack/echo/v4"
)

// heatmapRanges maps the accepted ?range= values to their lookback window.
var heatmapRanges = map[string]time.Duration{
	"24h": 24 * time.Hour,
	"7d":  7 * 24 * time.Hour,
	"30d": 30 * 24 * time.Hour,
}

// Alertmanager generates 16-character lowercase hex fingerprints (FNV-1a hash).
var fingerprintRegex = regexp.MustCompile(`^[a-f0-9]{16}$`)

func validateFingerprint(fp string) bool {
	return fingerprintRegex.MatchString(fp)
}

func parseFingerprintClusterPagination(c echo.Context) (fp, cluster string, limit, offset int, err error) {
	fp = c.Param("fingerprint")
	if !validateFingerprint(fp) {
		err = echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
		return
	}

	cluster = c.QueryParam("cluster")
	limit, _ = strconv.Atoi(c.QueryParam("limit"))
	offset, _ = strconv.Atoi(c.QueryParam("offset"))
	if limit <= 0 {
		limit = 20
	}
	return
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
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to get resolved alerts").SetInternal(err)
		}
		if clusterFilter == "" && severityFilter == "" {
			return c.JSON(http.StatusOK, dbAlerts)
		}
		filtered := make([]models.EnrichedAlert, 0)
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
	filtered := make([]models.EnrichedAlert, 0)
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
	fp, cluster, limit, offset, err := parseFingerprintClusterPagination(c)
	if err != nil {
		return err
	}

	events, total, err := s.store.GetHistoryForCluster(fp, cluster, limit, offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get history").SetInternal(err)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"events": events,
		"total":  total,
	})
}

// GET /api/v1/alerts/:fingerprint/timeline
func (s *Server) getAlertTimeline(c echo.Context) error {
	fp, cluster, limit, offset, err := parseFingerprintClusterPagination(c)
	if err != nil {
		return err
	}

	entries, total, err := s.store.GetTimeline(fp, cluster, limit, offset)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get timeline").SetInternal(err)
	}
	return c.JSON(http.StatusOK, map[string]interface{}{
		"entries": entries,
		"total":   total,
	})
}

// GET /api/v1/alerts/:fingerprint/silence-events
func (s *Server) getSilenceEvents(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")

	events, err := s.store.GetSilenceEventsForCluster(fp, cluster)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get silence events").SetInternal(err)
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
	cluster := c.QueryParam("cluster")

	stats, err := s.store.GetStatsForCluster(fp, cluster)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get stats").SetInternal(err)
	}
	if stats == nil {
		return echo.NewHTTPError(http.StatusNotFound, "fingerprint not found")
	}
	return c.JSON(http.StatusOK, stats)
}

// GET /api/v1/alerts/:fingerprint/heatmap
func (s *Server) getAlertHeatmap(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")

	rangeParam := c.QueryParam("range")
	window, ok := heatmapRanges[rangeParam]
	if !ok {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid range: must be 24h, 7d, or 30d")
	}

	starts, err := s.store.GetFiringStarts(fp, cluster, time.Now().Add(-window), 10000)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get heatmap data").SetInternal(err)
	}

	firingStarts := make([]string, len(starts))
	for i, t := range starts {
		firingStarts[i] = t.UTC().Format(time.RFC3339)
	}

	return c.JSON(http.StatusOK, models.AlertHeatmapResponse{
		Range:        rangeParam,
		FiringStarts: firingStarts,
	})
}
