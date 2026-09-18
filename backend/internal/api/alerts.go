package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertfilter"
	"github.com/kj187/jarvis/backend/internal/history"
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
var unsignedDecimalRegex = regexp.MustCompile(`^[0-9]+$`)
var resolvedMatcherOperators = map[string]bool{"=": true, "!=": true, "=~": true, "!~": true, ">": true, "<": true}

const (
	resolvedReadTimeout       = 10 * time.Second
	resolvedStreamBufferSize  = 32 * 1024
	resolvedStreamContentType = "application/json; charset=UTF-8"
)

func validateFingerprint(fp string) bool {
	return fingerprintRegex.MatchString(fp)
}

func invalidResolvedPageQuery() error {
	return echo.NewHTTPError(http.StatusBadRequest, "invalid resolved alert query")
}

func parseResolvedPageQuery(c echo.Context) (history.ResolvedPageQuery, error) {
	values := c.QueryParams()
	allowed := map[string]bool{
		"limit": true, "offset": true, "cluster": true, "severity": true,
		"search": true, "matchers": true, "fingerprint": true,
	}
	for name, items := range values {
		if !allowed[name] || len(items) != 1 {
			return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
		}
	}

	query := history.ResolvedPageQuery{Limit: 25, Now: time.Now().UTC().Truncate(time.Millisecond)}
	if raw, ok := values["limit"]; ok {
		if !unsignedDecimalRegex.MatchString(raw[0]) {
			return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
		}
		limit, err := strconv.Atoi(raw[0])
		if err != nil || (limit != 10 && limit != 25 && limit != 50 && limit != 100) {
			return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
		}
		query.Limit = limit
	}
	if raw, ok := values["offset"]; ok {
		if !unsignedDecimalRegex.MatchString(raw[0]) {
			return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
		}
		offset, err := strconv.ParseInt(raw[0], 10, 32)
		if err != nil || offset > 2147483547 {
			return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
		}
		query.Offset = int(offset)
	}

	query.Cluster = values.Get("cluster")
	query.Severity = values.Get("severity")
	query.Search = values.Get("search")
	query.Fingerprint = values.Get("fingerprint")
	if len(query.Cluster) > 256 || len(query.Severity) > 64 || len(query.Search) > 256 ||
		(query.Fingerprint != "" && !validateFingerprint(query.Fingerprint)) {
		return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
	}
	if _, present := values["fingerprint"]; present && query.Fingerprint == "" {
		return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
	}
	if raw, ok := values["matchers"]; ok {
		if len(raw[0]) > 8192 {
			return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
		}
		var objects []map[string]json.RawMessage
		if err := json.Unmarshal([]byte(raw[0]), &objects); err != nil || objects == nil || len(objects) > 50 {
			return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
		}
		query.Matchers = make([]alertfilter.Matcher, len(objects))
		for i, object := range objects {
			if len(object) != 3 || object["name"] == nil || object["operator"] == nil || object["value"] == nil {
				return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
			}
			matcher := &query.Matchers[i]
			if err := json.Unmarshal(object["name"], &matcher.Name); err != nil ||
				json.Unmarshal(object["operator"], &matcher.Operator) != nil ||
				json.Unmarshal(object["value"], &matcher.Value) != nil ||
				len(matcher.Name) == 0 || len(matcher.Name) > 256 || len(matcher.Value) > 1024 ||
				!resolvedMatcherOperators[matcher.Operator] {
				return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
			}
		}
	}
	if query.Fingerprint != "" {
		for _, incompatible := range []string{"search", "matchers", "severity", "offset", "limit"} {
			if _, present := values[incompatible]; present {
				return history.ResolvedPageQuery{}, invalidResolvedPageQuery()
			}
		}
		query.Limit = 1
		query.Offset = 0
	}
	return query, nil
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
		return s.streamResolvedAlerts(c, clusterFilter, severityFilter)
	}

	// Active / suppressed alerts come from the in-memory store. The
	// unfiltered case reuses AlertStore's cached JSON encoding (P4) instead
	// of re-marshaling the full alert list on every request.
	if clusterFilter == "" && severityFilter == "" && stateFilter == "" {
		data, _, err := s.alertStore.EncodedSnapshot()
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to encode alerts").SetInternal(err)
		}
		return c.JSONBlob(http.StatusOK, data)
	}
	alerts := s.alertStore.Get()
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

func (s *Server) streamResolvedAlerts(c echo.Context, clusterFilter, severityFilter string) error {
	ctx, cancel := context.WithTimeout(c.Request().Context(), resolvedReadTimeout)
	defer cancel()

	response := c.Response()
	buffered := bufio.NewWriterSize(response, resolvedStreamBufferSize)
	wroteAlert := false
	err := s.store.VisitResolved(ctx, history.ResolvedReadQuery{Cluster: clusterFilter}, func(alert models.EnrichedAlert) error {
		if severityFilter != "" && alert.Labels["severity"] != severityFilter {
			return nil
		}
		data, err := json.Marshal(alert)
		if err != nil {
			return fmt.Errorf("marshal resolved alert: %w", err)
		}
		if !wroteAlert {
			response.Header().Set(echo.HeaderContentType, resolvedStreamContentType)
			if _, err := buffered.WriteString("["); err != nil {
				return fmt.Errorf("write resolved stream start: %w", err)
			}
			wroteAlert = true
		} else if err := buffered.WriteByte(','); err != nil {
			return fmt.Errorf("write resolved stream separator: %w", err)
		}
		if _, err := buffered.Write(data); err != nil {
			return fmt.Errorf("write resolved alert: %w", err)
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || response.Committed {
			slog.Error("resolved alert stream aborted", slog.String("err", err.Error()))
			panic(http.ErrAbortHandler)
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get resolved alerts").SetInternal(err)
	}

	response.Header().Set(echo.HeaderContentType, resolvedStreamContentType)
	if !wroteAlert {
		if _, err := buffered.WriteString("[]\n"); err != nil {
			return abortResolvedStream(response, err)
		}
	} else if _, err := buffered.WriteString("]\n"); err != nil {
		return abortResolvedStream(response, err)
	}
	if err := buffered.Flush(); err != nil {
		return abortResolvedStream(response, err)
	}
	return nil
}

func abortResolvedStream(response *echo.Response, err error) error {
	if response.Committed {
		slog.Error("resolved alert stream write failed", slog.String("err", err.Error()))
		panic(http.ErrAbortHandler)
	}
	return echo.NewHTTPError(http.StatusInternalServerError, "failed to get resolved alerts").SetInternal(err)
}

// GET /api/v1/alerts/resolved
func (s *Server) getResolvedAlertsPage(c echo.Context) error {
	query, err := parseResolvedPageQuery(c)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(c.Request().Context(), resolvedReadTimeout)
	defer cancel()
	page, err := s.store.GetResolvedPage(ctx, query)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get resolved alerts").SetInternal(err)
	}
	return c.JSON(http.StatusOK, page)
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
