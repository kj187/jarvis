package api

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// NewRouter creates and configures the Echo router.
// staticFiles is the embedded FS (empty in dev mode, populated in prod).
func NewRouter(
	alertStore *history.AlertStore,
	store *history.Store,
	hub *ws.Hub,
	registry *cluster.Registry,
	cfg *config.Config,
	staticFiles embed.FS,
	recorder pollTriggerer,
) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// ── Middleware ────────────────────────────────────────────────────────────
	e.Use(middleware.Recover())
	e.Use(middleware.SecureWithConfig(middleware.SecureConfig{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "SAMEORIGIN",
		HSTSMaxAge:            31536000,
		ContentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:",
	}))
	e.Use(middleware.BodyLimit("1M"))

	if len(cfg.AllowedOrigins) > 0 {
		e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
			AllowOrigins: cfg.AllowedOrigins,
			AllowMethods: []string{http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodOptions},
			AllowHeaders: []string{echo.HeaderContentType, echo.HeaderAccept},
		}))
	}

	srv := NewServer(alertStore, store, hub, registry, cfg, recorder)

	// ── WebSocket ─────────────────────────────────────────────────────────────
	e.GET("/ws", func(c echo.Context) error {
		hub.ServeWS(c.Response().Writer, c.Request())
		return nil
	})

	// ── API v1 ────────────────────────────────────────────────────────────────
	api := e.Group("/api/v1")

	// Health
	e.GET("/health", srv.getHealth)
	api.GET("/status", srv.getStatus)

	// IMPORTANT: /alerts/groups must be registered BEFORE /alerts/:fingerprint/*
	// to prevent Echo from matching "groups" as a fingerprint parameter.
	api.GET("/alerts/groups", srv.getAlertGroups)
	api.GET("/alerts", srv.getAlerts)
	api.GET("/alerts/:fingerprint/history", srv.getAlertHistory)
	api.GET("/alerts/:fingerprint/stats", srv.getAlertStats)
	api.GET("/alerts/:fingerprint/silence-events", srv.getSilenceEvents)

	api.GET("/alerts/:fingerprint/comments", srv.getComments)
	api.POST("/alerts/:fingerprint/comments", srv.addComment)
	api.DELETE("/alerts/:fingerprint/comments/:id", srv.deleteComment)

	api.GET("/alerts/:fingerprint/claim", srv.getClaim)
	api.POST("/alerts/:fingerprint/claim", srv.setClaim)
	api.DELETE("/alerts/:fingerprint/claim", srv.releaseClaim)
	api.GET("/alerts/:fingerprint/claims/history", srv.getClaimHistory)

	api.GET("/silences", srv.getSilences)
	api.POST("/silences", srv.createSilence)
	api.DELETE("/silences/:id", srv.deleteSilence)
	api.POST("/poll", srv.triggerPoll)

	api.GET("/clusters", srv.getClusters)

	// ── Static files (prod only) ──────────────────────────────────────────────
	entries, err := fs.ReadDir(staticFiles, ".")
	if err == nil && len(entries) > 0 {
		e.GET("/*", echo.WrapHandler(http.FileServer(http.FS(staticFiles))))
	}

	return e
}
