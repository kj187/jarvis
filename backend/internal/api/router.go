package api

import (
	"embed"
	"io/fs"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/time/rate"

	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// rateLimiter returns a per-IP rate limiter middleware for the given rate and burst.
// rate is in requests per second; burst is the maximum burst size.
func rateLimiter(r rate.Limit, burst int) echo.MiddlewareFunc {
	return middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
		Store: middleware.NewRateLimiterMemoryStoreWithConfig(
			middleware.RateLimiterMemoryStoreConfig{
				Rate:      r,
				Burst:     burst,
				ExpiresIn: 5 * time.Minute,
			},
		),
		IdentifierExtractor: func(c echo.Context) (string, error) {
			return c.RealIP(), nil
		},
		DenyHandler: func(c echo.Context, id string, err error) error {
			return echo.NewHTTPError(http.StatusTooManyRequests, "rate limit exceeded")
		},
	})
}

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

	// Rate limiters:
	//   writeRL  — 30 req/min per IP for all mutating operations
	//   pollRL   — 1 req/5s  per IP for /poll (matches the minimum client poll interval)
	writeRL := rateLimiter(0.5, 10)  // 0.5 req/s = 30/min, burst 10
	pollRL := rateLimiter(0.2, 2)    // 0.2 req/s = 1/5s, burst 2

	api.GET("/alerts/:fingerprint/comments", srv.getComments)
	api.POST("/alerts/:fingerprint/comments", srv.addComment, writeRL)
	api.DELETE("/alerts/:fingerprint/comments/:id", srv.deleteComment, writeRL)

	api.GET("/alerts/:fingerprint/claim", srv.getClaim)
	api.POST("/alerts/:fingerprint/claim", srv.setClaim, writeRL)
	api.DELETE("/alerts/:fingerprint/claim", srv.releaseClaim, writeRL)
	api.GET("/alerts/:fingerprint/claims/history", srv.getClaimHistory)

	api.GET("/silences", srv.getSilences)
	api.POST("/silences", srv.createSilence, writeRL)
	api.DELETE("/silences/:id", srv.deleteSilence, writeRL)
	api.POST("/poll", srv.triggerPoll, pollRL)

	api.GET("/clusters", srv.getClusters)

	// ── Static files (prod only) ──────────────────────────────────────────────
	entries, err := fs.ReadDir(staticFiles, ".")
	if err == nil && len(entries) > 0 {
		e.GET("/*", echo.WrapHandler(http.FileServer(http.FS(staticFiles))))
	}

	return e
}
