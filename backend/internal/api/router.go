package api

import (
	"embed"
	"io/fs"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"golang.org/x/time/rate"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/users"
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
	authProvider auth.Provider,
	userStore *users.Store,
) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// ── Middleware ────────────────────────────────────────────────────────────
	e.Use(middleware.Recover())
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogMethod:   true,
		LogURI:      true,
		LogStatus:   true,
		LogLatency:  true,
		LogRemoteIP: true,
		LogError:    true,
		HandleError: true,
		LogValuesFunc: func(c echo.Context, v middleware.RequestLoggerValues) error {
			if v.Error != nil {
				attrs := []any{
					slog.String("method", v.Method),
					slog.String("uri", v.URI),
					slog.Int("status", v.Status),
					slog.Duration("latency", v.Latency),
					slog.String("remote_ip", v.RemoteIP),
					slog.String("err", v.Error.Error()),
				}
				if v.Status >= 500 {
					slog.Error("request", attrs...)
				} else {
					slog.Warn("request", attrs...)
				}
				return nil
			}
			if cfg.LogRequests {
				slog.Info("request",
					slog.String("method", v.Method),
					slog.String("uri", v.URI),
					slog.Int("status", v.Status),
					slog.Duration("latency", v.Latency),
					slog.String("remote_ip", v.RemoteIP),
				)
			}
			return nil
		},
	}))
	e.Use(middleware.SecureWithConfig(middleware.SecureConfig{
		XSSProtection:         "1; mode=block",
		ContentTypeNosniff:    "nosniff",
		XFrameOptions:         "SAMEORIGIN",
		HSTSMaxAge:            31536000,
		ContentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
	}))
	e.Use(middleware.BodyLimit("1M"))

	if len(cfg.AllowedOrigins) > 0 {
		e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
			AllowOrigins:     cfg.AllowedOrigins,
			AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodDelete, http.MethodPatch, http.MethodOptions},
			AllowHeaders:     []string{echo.HeaderContentType, echo.HeaderAccept},
			AllowCredentials: true,
		}))
	}

	srv := NewServer(alertStore, store, hub, registry, cfg, recorder, authProvider, userStore)

	// Wire JWT secret key into auth middleware.
	if len(cfg.SecretKey) > 0 {
		auth.SetSecretKey(cfg.SecretKey)
	}

	// First-run redirect: internal mode only, redirects to /setup when no users exist.
	e.Use(srv.firstRunRedirect)

	// ── WebSocket ─────────────────────────────────────────────────────────────
	e.GET("/ws", func(c echo.Context) error {
		hub.ServeWS(c.Response().Writer, c.Request())
		return nil
	})

	// ── Auth & Setup ──────────────────────────────────────────────────────────
	// GET /setup is served by the SPA catch-all (index.html); no explicit route needed.
	if authProvider.Mode() == "internal" {
		e.POST("/setup", srv.postSetup, rateLimiter(0.1, 3))
	}

	authGroup := e.Group("/auth")
	authGroup.GET("/info", srv.getAuthInfo)
	authGroup.POST("/login", srv.postLogin, rateLimiter(0.2, 5))
	authGroup.POST("/logout", srv.postLogout)
	authGroup.GET("/me", srv.getAuthMe, auth.RequireAuth(authProvider))
	authGroup.GET("/oidc/start", srv.getOIDCStart)
	authGroup.GET("/oidc/callback", srv.getOIDCCallback)

	// ── API v1 ────────────────────────────────────────────────────────────────
	apiV1 := e.Group("/api/v1")

	// full_protect: all API routes require authentication, not just write operations.
	if cfg.AuthMode == "full_protect" {
		apiV1.Use(auth.RequireAuth(authProvider))
	}

	// Health
	e.GET("/health", srv.getHealth)
	apiV1.GET("/status", srv.getStatus)
	apiV1.GET("/info", srv.getInfo)

	// IMPORTANT: /alerts/groups must be registered BEFORE /alerts/:fingerprint/*
	// to prevent Echo from matching "groups" as a fingerprint parameter.
	apiV1.GET("/alerts/groups", srv.getAlertGroups)
	apiV1.GET("/alerts", srv.getAlerts)
	apiV1.GET("/alerts/:fingerprint/history", srv.getAlertHistory)
	apiV1.GET("/alerts/:fingerprint/stats", srv.getAlertStats)
	apiV1.GET("/alerts/:fingerprint/silence-events", srv.getSilenceEvents)

	// Rate limiters:
	//   writeRL  — 30 req/min per IP for all mutating operations
	//   pollRL   — 1 req/5s  per IP for /poll (matches the minimum client poll interval)
	writeRL := rateLimiter(0.5, 10) // 0.5 req/s = 30/min, burst 10
	pollRL := rateLimiter(0.2, 2)   // 0.2 req/s = 1/5s, burst 2

	requireAuth := auth.RequireAuth(authProvider)

	apiV1.GET("/alerts/:fingerprint/comments", srv.getComments)
	apiV1.POST("/alerts/:fingerprint/comments", srv.addComment, requireAuth, writeRL)
	apiV1.DELETE("/alerts/:fingerprint/comments/:id", srv.deleteComment, requireAuth, writeRL)

	apiV1.GET("/alerts/:fingerprint/claim", srv.getClaim)
	apiV1.POST("/alerts/:fingerprint/claim", srv.setClaim, requireAuth, writeRL)
	apiV1.DELETE("/alerts/:fingerprint/claim", srv.releaseClaim, requireAuth, writeRL)
	apiV1.GET("/alerts/:fingerprint/claims/history", srv.getClaimHistory)

	apiV1.GET("/silences", srv.getSilences)
	apiV1.POST("/silences", srv.createSilence, requireAuth, writeRL)
	apiV1.DELETE("/silences/:id", srv.deleteSilence, requireAuth, writeRL)

	apiV1.GET("/silence-templates", srv.getSilenceTemplates)
	apiV1.POST("/silence-templates", srv.createSilenceTemplate, requireAuth, writeRL)
	apiV1.PUT("/silence-templates/:id", srv.updateSilenceTemplate, requireAuth, writeRL)
	apiV1.DELETE("/silence-templates/:id", srv.deleteSilenceTemplate, requireAuth, writeRL)

	apiV1.POST("/poll", srv.triggerPoll, pollRL)

	apiV1.GET("/clusters", srv.getClusters)

	// ── Admin (requires auth + admin role) ───────────────────────────────────
	admin := apiV1.Group("/admin", auth.RequireAdmin(authProvider))
	admin.GET("/users", srv.listUsers)
	admin.POST("/users", srv.createUser, rateLimiter(0.5, 5))
	admin.PATCH("/users/:id", srv.updateUser)
	admin.DELETE("/users/:id", srv.deleteUser)

	// ── Static files (prod only) ──────────────────────────────────────────────
	// Sub the FS to "dist/" so paths resolve without the "dist/" prefix.
	// Falls back to index.html for unknown paths (SPA client-side routing).
	if sub, err := fs.Sub(staticFiles, "dist"); err == nil {
		e.GET("/*", echo.WrapHandler(spaHandler(sub)))
	}

	return e
}

// spaHandler serves static files from fsys and falls back to index.html for
// any path that does not match an existing file (single-page app routing).
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := fs.Stat(fsys, path); err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}
		// Unknown path → serve index.html so the React router can handle it.
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		fileServer.ServeHTTP(w, r2)
	})
}
