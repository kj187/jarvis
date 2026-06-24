//go:build e2e

package api

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"golang.org/x/time/rate"
	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/models"
)

// Poll rate limit for POST /api/v1/poll in e2e builds: effectively unlimited so
// deterministic tests can force immediate polls without hitting 429.
const (
	pollRLRate  rate.Limit = rate.Inf
	pollRLBurst int        = 1000
)

// registerTestRoutes wires the e2e-only seed/reset endpoints. These are gated
// behind the "e2e" build tag and MUST NOT be present in production builds.
func (s *Server) registerTestRoutes(g *echo.Group) {
	slog.Warn("e2e test routes enabled (/api/v1/test/*) — never run this build in production")
	g.POST("/test/reset", s.testReset)
	g.POST("/test/seed", s.testSeed)
	g.POST("/test/silence", s.testCreateSilence)
	g.POST("/test/comment", s.testAddComment)
	g.POST("/test/claim", s.testSetClaim)
	g.POST("/test/template", s.testCreateTemplate)
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

type testSilenceRequest struct {
	Cluster   string                      `json:"cluster"`
	Matchers  []alertmanager.AMSilenceMatcher `json:"matchers"`
	StartsAt  time.Time                   `json:"startsAt"`
	EndsAt    time.Time                   `json:"endsAt"`
	CreatedBy string                      `json:"createdBy"`
	Comment   string                      `json:"comment"`
}

type testCommentRequest struct {
	Fingerprint string `json:"fingerprint"`
	AuthorName  string `json:"authorName"`
	Body        string `json:"body"`
}

type testClaimRequest struct {
	Fingerprint string `json:"fingerprint"`
	ClaimedBy   string `json:"claimedBy"`
	Note        string `json:"note"`
}

type testTemplateRequest struct {
	Name    string                  `json:"name"`
	Matchers []models.SilenceMatcher `json:"matchers"`
	Reason  string                  `json:"reason"`
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

// POST /api/v1/test/silence — creates a silence in a specific cluster for testing.
func (s *Server) testCreateSilence(c echo.Context) error {
	var req testSilenceRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if req.Cluster == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster is required")
	}
	if req.Comment == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "comment is required")
	}
	if req.EndsAt.Before(req.StartsAt) {
		return echo.NewHTTPError(http.StatusBadRequest, "endsAt must be after startsAt")
	}

	cl := s.registry.Get(req.Cluster)
	if cl == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "cluster not found")
	}

	postable := alertmanager.PostableSilence{
		Matchers:  req.Matchers,
		StartsAt:  req.StartsAt,
		EndsAt:    req.EndsAt,
		CreatedBy: req.CreatedBy,
		Comment:   req.Comment,
	}

	silenceID, err := cl.Client.CreateSilence(c.Request().Context(), postable)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, map[string]string{"silenceID": silenceID})
}

// POST /api/v1/test/comment — adds a comment to an alert for testing.
func (s *Server) testAddComment(c echo.Context) error {
	var req testCommentRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if req.Fingerprint == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "fingerprint is required")
	}
	if req.Body == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "body is required")
	}
	if req.AuthorName == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "authorName is required")
	}

	comment, err := s.store.AddComment(req.Fingerprint, nil, nil, req.AuthorName, req.Body)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, comment)
}

// POST /api/v1/test/claim — sets a claim on an alert for testing.
func (s *Server) testSetClaim(c echo.Context) error {
	var req testClaimRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if req.Fingerprint == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "fingerprint is required")
	}
	if req.ClaimedBy == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "claimedBy is required")
	}

	_, err := s.store.SetClaim(req.Fingerprint, nil, req.ClaimedBy, req.Note)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.NoContent(http.StatusNoContent)
}

// POST /api/v1/test/template — creates a silence template for testing.
func (s *Server) testCreateTemplate(c echo.Context) error {
	var req testTemplateRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, err.Error())
	}

	if req.Name == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "name is required")
	}
	if len(req.Matchers) == 0 {
		return echo.NewHTTPError(http.StatusBadRequest, "at least one matcher is required")
	}

	id := generateID()
	template, err := s.store.CreateSilenceTemplate(id, req.Name, req.Matchers, req.Reason)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, err.Error())
	}

	return c.JSON(http.StatusOK, template)
}
