package api

import (
	"errors"
	"net/http"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/labstack/echo/v4"
)

const (
	maxClaimedByLen = 100
	maxClaimNoteLen = 1_000
)

// GET /api/v1/alerts/:fingerprint/claim?cluster=<cluster>
func (s *Server) getClaim(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")

	claim, err := s.store.GetActiveClaim(fp, cluster)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get claim")
	}
	if claim == nil {
		return c.JSON(http.StatusOK, nil)
	}
	return c.JSON(http.StatusOK, claim)
}

// POST /api/v1/alerts/:fingerprint/claim?cluster=<cluster>
func (s *Server) setClaim(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")

	var body struct {
		ClaimedBy string `json:"claimedBy"`
		Note      string `json:"note"`
		EventID   *int64 `json:"eventId,omitempty"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	claimedBy := body.ClaimedBy
	if s.authProvider.Mode() == "none" {
		if claimedBy == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "claimedBy is required")
		}
	} else {
		u := auth.UserFromContext(c)
		if u == nil || u.Username == "" {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
		}
		claimedBy = u.Username
	}
	if len([]rune(claimedBy)) > maxClaimedByLen {
		return echo.NewHTTPError(http.StatusBadRequest, "claimedBy too long (max 100 characters)")
	}
	if len([]rune(body.Note)) > maxClaimNoteLen {
		return echo.NewHTTPError(http.StatusBadRequest, "note too long (max 1000 characters)")
	}

	claim, err := s.store.SetClaim(fp, cluster, body.EventID, claimedBy, body.Note)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to set claim")
	}

	s.alertStore.SetActiveClaim(fp, cluster, claim)

	s.hub.BroadcastJSON(models.WSTypeClaimSet, map[string]interface{}{
		"fingerprint": fp,
		"clusterName": cluster,
		"claim":       claim,
	})

	return c.JSON(http.StatusCreated, claim)
}

// DELETE /api/v1/alerts/:fingerprint/claim?cluster=<cluster>
func (s *Server) releaseClaim(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")

	by := c.QueryParam("by")
	if s.authProvider.Mode() != "none" {
		u := auth.UserFromContext(c)
		if u == nil || u.Username == "" {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
		}
		by = u.Username
	} else if by == "" {
		by = "unknown"
	}

	released, err := s.store.ReleaseClaim(fp, cluster, by, models.ReleaseReasonManual)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to release claim")
	}
	if !released {
		return echo.NewHTTPError(http.StatusNotFound, "no active claim")
	}

	s.alertStore.ClearActiveClaim(fp, cluster)

	s.hub.BroadcastJSON(models.WSTypeClaimReleased, map[string]interface{}{
		"fingerprint": fp,
		"clusterName": cluster,
		"releasedBy":  by,
	})

	return c.NoContent(http.StatusNoContent)
}

// PATCH /api/v1/alerts/:fingerprint/claim/note?cluster=<cluster>
// Lets the current owner update the note of the active claim. The change is
// append-only: the previous note is preserved as an immutable history entry.
func (s *Server) updateClaimNote(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")

	var body struct {
		ClaimedBy string `json:"claimedBy"`
		Note      string `json:"note"`
	}
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}
	by := body.ClaimedBy
	if s.authProvider.Mode() == "none" {
		if by == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "claimedBy is required")
		}
	} else {
		u := auth.UserFromContext(c)
		if u == nil || u.Username == "" {
			return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
		}
		by = u.Username
	}
	if len([]rune(body.Note)) > maxClaimNoteLen {
		return echo.NewHTTPError(http.StatusBadRequest, "note too long (max 1000 characters)")
	}

	claim, err := s.store.UpdateClaimNote(fp, cluster, by, body.Note)
	if err != nil {
		switch {
		case errors.Is(err, history.ErrNoActiveClaim):
			return echo.NewHTTPError(http.StatusNotFound, "no active claim")
		case errors.Is(err, history.ErrNotClaimOwner):
			return echo.NewHTTPError(http.StatusForbidden, "only the claim owner can update the note")
		default:
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to update claim note")
		}
	}

	s.alertStore.SetActiveClaim(fp, cluster, claim)

	s.hub.BroadcastJSON(models.WSTypeClaimSet, map[string]interface{}{
		"fingerprint": fp,
		"clusterName": cluster,
		"claim":       claim,
	})

	return c.JSON(http.StatusOK, claim)
}

// GET /api/v1/alerts/:fingerprint/claims/history?cluster=<cluster>
func (s *Server) getClaimHistory(c echo.Context) error {
	fp := c.Param("fingerprint")
	if !validateFingerprint(fp) {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid fingerprint")
	}
	cluster := c.QueryParam("cluster")

	claims, err := s.store.GetClaimHistory(fp, cluster)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to get claim history")
	}
	if claims == nil {
		claims = []models.Claim{}
	}
	return c.JSON(http.StatusOK, claims)
}
