package api

import (
	"net/http"

	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/labstack/echo/v4"
)

// GET /api/v1/alerts/:fingerprint/claim
func (s *Server) getClaim(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	claim, err := s.store.GetActiveClaim(fp)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get claim")
	}
	if claim == nil {
		return echo.NewHTTPError(http.StatusNotFound, "no active claim")
	}
	return c.JSON(http.StatusOK, claim)
}

// POST /api/v1/alerts/:fingerprint/claim
func (s *Server) setClaim(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	var body struct {
		ClaimedBy string `json:"claimedBy"`
		Note      string `json:"note"`
		EventID   *int64 `json:"eventId,omitempty"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	if body.ClaimedBy == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "claimedBy is required")
	}

	claim, err := s.store.SetClaim(fp, body.EventID, body.ClaimedBy, body.Note)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to set claim")
	}

	s.alertStore.SetActiveClaim(fp, claim)

	s.hub.BroadcastJSON(models.WSTypeClaimSet, map[string]interface{}{
		"fingerprint": fp,
		"claim":       claim,
	})

	return c.JSON(http.StatusCreated, claim)
}

// DELETE /api/v1/alerts/:fingerprint/claim
func (s *Server) releaseClaim(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	by := c.QueryParam("by")
	if by == "" {
		by = "unknown"
	}

	released, err := s.store.ReleaseClaim(fp, by, models.ReleaseReasonManual)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to release claim")
	}
	if !released {
		return echo.NewHTTPError(http.StatusNotFound, "no active claim")
	}

	s.alertStore.ClearActiveClaim(fp)

	s.hub.BroadcastJSON(models.WSTypeClaimReleased, map[string]interface{}{
		"fingerprint": fp,
		"releasedBy":  by,
	})

	return c.NoContent(http.StatusNoContent)
}

// GET /api/v1/alerts/:fingerprint/claims/history
func (s *Server) getClaimHistory(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}

	claims, err := s.store.GetClaimHistory(fp)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get claim history")
	}
	if claims == nil {
		claims = []models.Claim{}
	}
	return c.JSON(http.StatusOK, claims)
}
