package api

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	amclient "github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/labstack/echo/v4"
)

// GET /api/v1/silences
func (s *Server) getSilences(c echo.Context) error {
	clusterFilter := c.QueryParam("cluster")
	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	var allSilences []models.Silence
	for _, cl := range s.registry.All() {
		if clusterFilter != "" && cl.Name != clusterFilter {
			continue
		}
		raw, err := cl.FetchSilences(ctx, nil)
		if err != nil {
			// Best-effort: a cluster's silences are simply missing from the response rather
			// than failing the whole request, but log it — otherwise this shows up to users
			// only as an unexplained gap (e.g. a silence badge that should be there isn't).
			slog.Warn("fetch silences failed", "cluster", cl.Name, "err", err)
			continue
		}
		for _, rs := range raw {
			allSilences = append(allSilences, convertSilence(rs, cl.Name, cl.AlertmanagerLinkURL))
		}
	}
	if allSilences == nil {
		allSilences = []models.Silence{}
	}
	return c.JSON(http.StatusOK, allSilences)
}

// POST /api/v1/silences
func (s *Server) createSilence(c echo.Context) error {
	var body struct {
		Cluster     string                      `json:"cluster"`
		Matchers    []amclient.AMSilenceMatcher `json:"matchers"`
		StartsAt    time.Time                   `json:"startsAt"`
		EndsAt      time.Time                   `json:"endsAt"`
		CreatedBy   string                      `json:"createdBy"`
		Comment     string                      `json:"comment"`
		ID          string                      `json:"id,omitempty"`
		Fingerprint string                      `json:"fingerprint,omitempty"`
		PerformedBy string                      `json:"performedBy,omitempty"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if body.Comment == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "comment is required")
	}
	if len([]rune(body.Comment)) > 2_000 {
		return echo.NewHTTPError(http.StatusBadRequest, "comment too long (max 2000 characters)")
	}
	if len([]rune(body.CreatedBy)) > 100 {
		return echo.NewHTTPError(http.StatusBadRequest, "createdBy too long (max 100 characters)")
	}
	if body.Cluster == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster is required")
	}

	cl := s.registry.Get(body.Cluster)
	if cl == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "unknown cluster")
	}

	modelMatchers := make([]models.SilenceMatcher, len(body.Matchers))
	for i, m := range body.Matchers {
		modelMatchers[i] = models.SilenceMatcher{IsEqual: m.IsEqual, IsRegex: m.IsRegex, Name: m.Name, Value: m.Value}
	}
	if err := validateSilenceMatchers(modelMatchers); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}
	if !body.EndsAt.After(body.StartsAt) {
		return echo.NewHTTPError(http.StatusBadRequest, "endsAt must be after startsAt")
	}
	if !body.EndsAt.After(time.Now()) {
		return echo.NewHTTPError(http.StatusBadRequest, "endsAt must be in the future")
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	createdBy := body.CreatedBy
	performedBy := body.PerformedBy
	if s.authProvider.Mode() != "none" {
		u := auth.UserFromContext(c)
		if u == nil || u.Username == "" {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
		}
		createdBy = u.Username
		performedBy = u.Username
	}
	if createdBy == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "createdBy is required")
	}

	postable := amclient.PostableSilence{
		ID:        body.ID,
		Matchers:  body.Matchers,
		StartsAt:  body.StartsAt,
		EndsAt:    body.EndsAt,
		CreatedBy: createdBy,
		Comment:   body.Comment,
	}
	id, err := cl.CreateSilence(ctx, postable)
	if err != nil {
		var amErr *amclient.AMError
		if errors.As(err, &amErr) && amErr.StatusCode >= 400 && amErr.StatusCode < 500 {
			slog.Warn("alertmanager rejected silence", "cluster", body.Cluster, "status", amErr.StatusCode, "err", err)
			return echo.NewHTTPError(http.StatusBadRequest, sanitizeAMMessage(amErr.Body))
		}
		slog.Error("create silence failed", "cluster", body.Cluster, "err", err)
		return echo.NewHTTPError(http.StatusBadGateway, "alertmanager request failed")
	}

	// Alertmanager may return a new ID instead of updating in-place (it does this
	// itself whenever matchers or startsAt change on an update — see PostableSilence
	// handling in Alertmanager's silence.Set). Expire the old silence defensively to
	// prevent duplicates in case Alertmanager didn't already do so.
	if body.ID != "" && id != body.ID {
		if err := cl.DeleteSilence(ctx, body.ID); err != nil {
			slog.Warn("expire old silence after id change failed", "cluster", body.Cluster, "old_id", body.ID, "err", err)
		}
	}

	if body.Fingerprint != "" {
		action := "created"
		if body.ID != "" {
			action = "updated"
		} else if body.StartsAt.After(time.Now()) {
			action = "pending"
		}
		performer := performedBy
		if performer == "" {
			performer = createdBy
		}
		_, _ = s.store.RecordSilenceEvent(body.Fingerprint, id, body.Cluster, action, performer, body.Comment)
	}

	return c.JSON(http.StatusCreated, map[string]string{"id": id})
}

// DELETE /api/v1/silences/:id
func (s *Server) deleteSilence(c echo.Context) error {
	silenceID := c.Param("id")
	if silenceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "silence id is required")
	}
	clusterName := c.QueryParam("cluster")
	if clusterName == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster is required")
	}

	cl := s.registry.Get(clusterName)
	if cl == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "unknown cluster")
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	if err := cl.DeleteSilence(ctx, silenceID); err != nil {
		var amErr *amclient.AMError
		if errors.As(err, &amErr) && amErr.StatusCode >= 400 && amErr.StatusCode < 500 {
			slog.Warn("alertmanager rejected silence deletion", "cluster", clusterName, "id", silenceID, "status", amErr.StatusCode, "err", err)
			return echo.NewHTTPError(http.StatusBadRequest, sanitizeAMMessage(amErr.Body))
		}
		slog.Error("delete silence failed", "cluster", clusterName, "id", silenceID, "err", err)
		return echo.NewHTTPError(http.StatusBadGateway, "alertmanager request failed")
	}

	fingerprint := c.QueryParam("fingerprint")
	by := c.QueryParam("by")
	if s.authProvider.Mode() != "none" {
		u := auth.UserFromContext(c)
		if u == nil || u.Username == "" {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
		}
		by = u.Username
	}
	if fingerprint != "" {
		if by == "" {
			by = "unknown"
		}
		_, _ = s.store.RecordSilenceEvent(fingerprint, silenceID, clusterName, "deleted", by, "")
	}

	return c.NoContent(http.StatusNoContent)
}

func convertSilence(rs amclient.GettableSilence, clusterName, amLinkURL string) models.Silence {
	matchers := make([]models.SilenceMatcher, len(rs.Matchers))
	for i, m := range rs.Matchers {
		matchers[i] = models.SilenceMatcher{
			IsEqual: m.IsEqual,
			IsRegex: m.IsRegex,
			Name:    m.Name,
			Value:   m.Value,
		}
	}
	return models.Silence{
		ID:              rs.ID,
		Matchers:        matchers,
		StartsAt:        rs.StartsAt,
		EndsAt:          rs.EndsAt,
		CreatedBy:       rs.CreatedBy,
		Comment:         rs.Comment,
		Status:          models.SilenceStatus{State: rs.Status.State},
		UpdatedAt:       rs.UpdatedAt,
		ClusterName:     clusterName,
		AlertmanagerURL: amLinkURL,
	}
}

// ── Silence Templates ────────────────────────────────────────────────────────

// GET /api/v1/silence-templates
func (s *Server) getSilenceTemplates(c echo.Context) error {
	templates, err := s.store.GetAllSilenceTemplates()
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load templates")
	}
	if templates == nil {
		templates = []models.SilenceTemplate{}
	}
	return c.JSON(http.StatusOK, templates)
}

// POST /api/v1/silence-templates
func (s *Server) createSilenceTemplate(c echo.Context) error {
	var body struct {
		Name     string                  `json:"name"`
		Matchers []models.SilenceMatcher `json:"matchers"`
		Reason   string                  `json:"reason"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if body.Name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if len([]rune(body.Name)) > 255 {
		return echo.NewHTTPError(http.StatusBadRequest, "name too long (max 255 characters)")
	}
	if len([]rune(body.Reason)) > 2_000 {
		return echo.NewHTTPError(http.StatusBadRequest, "reason too long (max 2000 characters)")
	}
	if err := validateSilenceMatchers(body.Matchers); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	// Generate a unique ID for the template.
	id := generateID()

	template, err := s.store.CreateSilenceTemplate(id, body.Name, body.Matchers, body.Reason)
	if err != nil {
		if isUniqueViolation(err) {
			return echo.NewHTTPError(http.StatusConflict, "template name already exists")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to create template")
	}

	return c.JSON(http.StatusCreated, template)
}

// DELETE /api/v1/silence-templates/:id
func (s *Server) deleteSilenceTemplate(c echo.Context) error {
	id := c.Param("id")
	if id == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "template id is required")
	}

	if err := s.store.DeleteSilenceTemplate(id); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete template")
	}

	return c.NoContent(http.StatusNoContent)
}

// PUT /api/v1/silence-templates/:id
func (s *Server) updateSilenceTemplate(c echo.Context) error {
	id := c.Param("id")
	if id == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "template id is required")
	}

	var body struct {
		Name     string                  `json:"name"`
		Matchers []models.SilenceMatcher `json:"matchers"`
		Reason   string                  `json:"reason"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if body.Name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if len([]rune(body.Name)) > 255 {
		return echo.NewHTTPError(http.StatusBadRequest, "name too long (max 255 characters)")
	}
	if len([]rune(body.Reason)) > 2_000 {
		return echo.NewHTTPError(http.StatusBadRequest, "reason too long (max 2000 characters)")
	}
	if err := validateSilenceMatchers(body.Matchers); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	template, err := s.store.UpdateSilenceTemplate(id, body.Name, body.Matchers, body.Reason)
	if err != nil {
		if isUniqueViolation(err) {
			return echo.NewHTTPError(http.StatusConflict, "template name already exists")
		}
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to update template")
	}

	return c.JSON(http.StatusOK, template)
}

// Helper function to generate a unique ID.
func generateID() string {
	return uuid.New().String()
}
