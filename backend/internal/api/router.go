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

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// loginRateLimiter returns the one rate limit Jarvis applies: a single global
// bucket for POST /auth/login, shared by all clients (0.5 req/s = 30/min,
// burst 10).
//
// It is global on purpose. Jarvis is an internal tool behind a VPN or auth
// proxy, and behind a proxy the client IP is not reliable (X-Forwarded-For is
// caller-controlled), so a per-IP key would either be bypassable or need
// trusted-proxy configuration. The constant key needs neither.
//
// Trade-off: an attacker who can reach the login endpoint can use up the
// bucket and block logins for as long as the attack lasts. Reading stays
// possible in write_protect mode. Nothing else is rate limited.
func loginRateLimiter() echo.MiddlewareFunc {
	return middleware.RateLimiterWithConfig(middleware.RateLimiterConfig{
		Store: middleware.NewRateLimiterMemoryStoreWithConfig(
			middleware.RateLimiterMemoryStoreConfig{
				Rate:      0.5,
				Burst:     10,
				ExpiresIn: 5 * time.Minute,
			},
		),
		IdentifierExtractor: func(echo.Context) (string, error) {
			return "login", nil
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
	silenceStore *history.SilenceStore,
	store *history.Store,
	hub *ws.Hub,
	registry *cluster.Registry,
	cfg *config.Config,
	staticFiles embed.FS,
	recorder pollTriggerer,
	authProvider auth.Provider,
	userStore *users.Store,
	settingsStore *settings.Store,
	m *metrics.Metrics,
	f fanout.Fanout,
) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	// ── Middleware ────────────────────────────────────────────────────────────
	e.Use(middleware.Recover())
	e.Use(m.EchoMiddleware())
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
			AllowMethods:     []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch, http.MethodOptions},
			AllowHeaders:     []string{echo.HeaderContentType, echo.HeaderAccept},
			AllowCredentials: true,
		}))
	}

	srv := NewServer(alertStore, silenceStore, store, hub, registry, cfg, recorder, authProvider, userStore, settingsStore, f)

	// Wire JWT secret key into auth middleware.
	if len(cfg.SecretKey) > 0 {
		auth.SetSecretKey(cfg.SecretKey)
	}

	// First-run redirect: internal mode only, redirects to /setup when no users exist.
	e.Use(srv.firstRunRedirect)

	// ── WebSocket ─────────────────────────────────────────────────────────────
	// full_protect: /ws streams the full alert snapshot plus claim/comment
	// events, so it must be gated like the API routes below. The JWT session
	// cookie is sent on the upgrade request, so RequireAuth works unchanged.
	wsHandler := func(c echo.Context) error {
		hub.ServeWS(c.Response().Writer, c.Request())
		return nil
	}
	if cfg.AuthMode == "full_protect" {
		e.GET("/ws", wsHandler, auth.RequireAuth(authProvider))
	} else {
		e.GET("/ws", wsHandler)
	}

	// ── Auth & Setup ──────────────────────────────────────────────────────────
	// GET /setup is served by the SPA catch-all (index.html); no explicit route needed.
	if authProvider.Mode() == "internal" {
		e.POST("/setup", srv.postSetup)
	}

	authGroup := e.Group("/auth")
	authGroup.GET("/info", srv.getAuthInfo)
	authGroup.POST("/login", srv.postLogin, loginRateLimiter())
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

	// Health / Metrics — public, bypasses full_protect like /health.
	e.GET("/health", srv.getHealth)
	e.GET("/metrics", echo.WrapHandler(m.Handler()))
	apiV1.GET("/status", srv.getStatus)
	apiV1.GET("/info", srv.getInfo)

	// IMPORTANT: static /alerts routes must be registered BEFORE
	// /alerts/:fingerprint/* so Echo never treats them as fingerprints.
	apiV1.GET("/alerts/groups", srv.getAlertGroups)
	apiV1.GET("/alerts/resolved", srv.getResolvedAlertsPage)
	apiV1.GET("/alerts", srv.getAlerts)
	apiV1.GET("/alerts/:fingerprint/history", srv.getAlertHistory)
	apiV1.GET("/alerts/:fingerprint/timeline", srv.getAlertTimeline)
	apiV1.GET("/alerts/:fingerprint/stats", srv.getAlertStats)
	apiV1.GET("/alerts/:fingerprint/heatmap", srv.getAlertHeatmap)
	apiV1.GET("/alerts/:fingerprint/silence-events", srv.getSilenceEvents)

	requireAuth := auth.RequireAuth(authProvider)

	apiV1.GET("/alerts/:fingerprint/comments", srv.getComments)
	apiV1.POST("/alerts/:fingerprint/comments", srv.addComment, requireAuth)
	apiV1.DELETE("/alerts/:fingerprint/comments/:id", srv.deleteComment, requireAuth)

	apiV1.GET("/alerts/:fingerprint/claim", srv.getClaim)
	apiV1.POST("/alerts/:fingerprint/claim", srv.setClaim, requireAuth)
	apiV1.PATCH("/alerts/:fingerprint/claim/note", srv.updateClaimNote, requireAuth)
	apiV1.DELETE("/alerts/:fingerprint/claim", srv.releaseClaim, requireAuth)
	apiV1.GET("/alerts/:fingerprint/claims/history", srv.getClaimHistory)

	apiV1.GET("/silences", srv.getSilences)
	apiV1.POST("/silences", srv.createSilence, requireAuth)
	apiV1.DELETE("/silences/:id", srv.deleteSilence, requireAuth)

	apiV1.GET("/silence-templates", srv.getSilenceTemplates)
	apiV1.POST("/silence-templates", srv.createSilenceTemplate, requireAuth)
	apiV1.PUT("/silence-templates/:id", srv.updateSilenceTemplate, requireAuth)
	apiV1.DELETE("/silence-templates/:id", srv.deleteSilenceTemplate, requireAuth)

	apiV1.POST("/poll", srv.triggerPoll)

	apiV1.GET("/clusters", srv.getClusters)

	apiV1.GET("/settings", srv.getSettings, auth.OptionalAuth(authProvider))
	apiV1.PUT("/settings", srv.putSettings, requireAuth)
	apiV1.DELETE("/settings", srv.deleteSettings, requireAuth)

	// ── E2E test routes (only when built with -tags e2e; no-op otherwise) ─────
	srv.registerTestRoutes(apiV1)

	// ── Admin (requires auth + admin role) ───────────────────────────────────
	admin := apiV1.Group("/admin", auth.RequireAdmin(authProvider))
	admin.GET("/users", srv.listUsers)
	admin.POST("/users", srv.createUser)
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
