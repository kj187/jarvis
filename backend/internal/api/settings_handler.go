package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
)

// maxSettingsBodyBytes bounds the raw PUT body.
// The blob is opaque to the backend — this is a shape/size check only, never
// a check against individual setting keys.
const maxSettingsBodyBytes = 16 * 1024

type settingsResponse struct {
	User   map[string]interface{} `json:"user"`
	Global map[string]interface{} `json:"global"`
}

// GET /api/v1/settings — never requires auth: an anonymous caller (write_protect
// without login, or auth mode "none") gets user: null and resolves settings
// from localStorage instead (Invariant #13 unaffected — DB-only, no AM call).
func (s *Server) getSettings(c echo.Context) error {
	global := map[string]interface{}{} // Reserved for instance-wide defaults; always empty for now.

	u := auth.UserFromContext(c)
	if u == nil {
		return c.JSON(http.StatusOK, settingsResponse{Global: global})
	}

	raw, err := s.settingsStore.Get(c.Request().Context(), u.ID)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load settings")
	}
	if raw == "" {
		return c.JSON(http.StatusOK, settingsResponse{Global: global})
	}

	var userSettings map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &userSettings); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load settings")
	}
	return c.JSON(http.StatusOK, settingsResponse{User: userSettings, Global: global})
}

// PUT /api/v1/settings — replaces the caller's settings row wholesale (last
// write wins, no merge, no versioning).
func (s *Server) putSettings(c echo.Context) error {
	u := auth.UserFromContext(c)
	if u == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
	}

	body, err := io.ReadAll(io.LimitReader(c.Request().Body, maxSettingsBodyBytes+1))
	if err != nil || len(body) > maxSettingsBodyBytes {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid settings payload")
	}

	// Must decode as a JSON object (not array/number/string/null) — the only
	// shape check the backend performs on this otherwise-opaque blob.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil || obj == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid settings payload")
	}

	if err := s.settingsStore.Put(c.Request().Context(), u.ID, string(body)); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to save settings")
	}
	return c.NoContent(http.StatusNoContent)
}

// DELETE /api/v1/settings — the server side of "Reset to defaults": drops the
// row so the caller falls back to global/app defaults.
func (s *Server) deleteSettings(c echo.Context) error {
	u := auth.UserFromContext(c)
	if u == nil {
		return echo.NewHTTPError(http.StatusUnauthorized, "unauthorized")
	}
	if err := s.settingsStore.Delete(c.Request().Context(), u.ID); err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to delete settings")
	}
	return c.NoContent(http.StatusNoContent)
}
