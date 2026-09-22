package api

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/globalsettings"
)

// maxGlobalSettingBodyBytes bounds a section's raw PUT body. Generous
// compared to maxSettingsBodyBytes (16 KiB) since a section like the later
// "access" rule list can grow larger than a single user's UI preferences.
const maxGlobalSettingBodyBytes = 64 * 1024

// globalSettingSectionsResponse is the body of GET /api/v1/admin/settings.
type globalSettingSectionsResponse struct {
	Sections []string `json:"sections"`
}

// globalSettingResponse is the body of GET /api/v1/admin/settings/:section.
type globalSettingResponse struct {
	Section   string          `json:"section"`
	Value     json.RawMessage `json:"value"`
	UpdatedAt string          `json:"updatedAt,omitempty"`
	UpdatedBy string          `json:"updatedBy,omitempty"`
}

// GET /api/v1/admin/settings — lists the currently registered sections, so
// the admin UI can render an empty state until a feature (Phase 1's "access"
// section, per the RBAC label-scoped-access plan) registers itself. Phase 0
// registers nothing, so this always answers {"sections": []} for now.
func (s *Server) listGlobalSettingsSections(c echo.Context) error {
	sections := s.globalSettingsStore.Sections()
	if sections == nil {
		sections = []string{}
	}
	return c.JSON(http.StatusOK, globalSettingSectionsResponse{Sections: sections})
}

// GET /api/v1/admin/settings/:section — 404 for a section nobody has
// registered (Phase 0: every section, since none is registered yet); 200
// with value: null for a registered section that has never been written.
func (s *Server) getGlobalSetting(c echo.Context) error {
	section := c.Param("section")
	if !s.globalSettingsStore.Registered(section) {
		return echo.NewHTTPError(http.StatusNotFound, "unknown settings section")
	}

	setting, err := s.globalSettingsStore.Get(c.Request().Context(), section)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load setting")
	}
	if setting == nil {
		return c.JSON(http.StatusOK, globalSettingResponse{Section: section, Value: json.RawMessage("null")})
	}
	return c.JSON(http.StatusOK, globalSettingResponse{
		Section:   section,
		Value:     setting.Value,
		UpdatedAt: setting.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedBy: setting.UpdatedBy,
	})
}

// PUT /api/v1/admin/settings/:section — 404 for an unregistered section
// (Phase 0: every section); 400 for a malformed body or a failing
// section-specific validator; 204 on success. Phase 0 itself registers no
// section and therefore performs no section-specific validation — that is
// Phase 1's job (e.g. the "access" rule list).
func (s *Server) putGlobalSetting(c echo.Context) error {
	section := c.Param("section")
	if !s.globalSettingsStore.Registered(section) {
		return echo.NewHTTPError(http.StatusNotFound, "unknown settings section")
	}

	body, err := io.ReadAll(io.LimitReader(c.Request().Body, maxGlobalSettingBodyBytes+1))
	if err != nil || len(body) > maxGlobalSettingBodyBytes {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid settings payload")
	}
	// Must decode as a JSON object (not array/number/string/null) — same shape
	// check as settings_handler.go's putSettings. Without it a stored `null`
	// would be indistinguishable from "never written" in the GET response.
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(body, &obj); err != nil || obj == nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid settings payload")
	}

	updatedBy := ""
	if caller := auth.UserFromContext(c); caller != nil {
		updatedBy = caller.Username
	}

	if err := s.globalSettingsStore.Set(c.Request().Context(), section, body, updatedBy); err != nil {
		switch {
		case errors.Is(err, globalsettings.ErrSectionNotRegistered):
			return echo.NewHTTPError(http.StatusNotFound, "unknown settings section")
		case errors.Is(err, globalsettings.ErrValidation):
			slog.Error("global setting validation failed", "section", section, "err", err)
			return echo.NewHTTPError(http.StatusBadRequest, "invalid settings payload")
		default:
			slog.Error("global setting save failed", "section", section, "err", err)
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to save setting")
		}
	}
	return c.NoContent(http.StatusNoContent)
}
