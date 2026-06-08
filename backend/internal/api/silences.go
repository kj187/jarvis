package api

import (
	"context"
	"net/http"
	"time"

	amclient "github.com/kj187/jarvis/backend/internal/alertmanager"
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
		raw, err := cl.Client.GetSilences(ctx)
		if err != nil {
			continue // best-effort
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
	if body.Cluster == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster is required")
	}

	cl := s.registry.Get(body.Cluster)
	if cl == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "unknown cluster")
	}

	ctx, cancel := context.WithTimeout(c.Request().Context(), 10*time.Second)
	defer cancel()

	postable := amclient.PostableSilence{
		ID:        body.ID,
		Matchers:  body.Matchers,
		StartsAt:  body.StartsAt,
		EndsAt:    body.EndsAt,
		CreatedBy: body.CreatedBy,
		Comment:   body.Comment,
	}
	id, err := cl.Client.CreateSilence(ctx, postable)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "alertmanager error: "+err.Error())
	}

	if body.Fingerprint != "" {
		action := "created"
		if body.ID != "" {
			action = "updated"
		} else if body.StartsAt.After(time.Now()) {
			action = "pending"
		}
		performer := body.PerformedBy
		if performer == "" {
			performer = body.CreatedBy
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

	if err := cl.Client.DeleteSilence(ctx, silenceID); err != nil {
		return echo.NewHTTPError(http.StatusBadGateway, "alertmanager error: "+err.Error())
	}

	fingerprint := c.QueryParam("fingerprint")
	by := c.QueryParam("by")
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
