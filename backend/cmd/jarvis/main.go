package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kj187/jarvis/backend/internal/api"
	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/static"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		fmt.Fprintf(os.Stderr, "config error: %v\n", err)
		os.Exit(1)
	}

	// ── Logger ────────────────────────────────────────────────────────────────
	logLevel := slog.LevelInfo
	if cfg.LogLevel == "debug" {
		logLevel = slog.LevelDebug
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel}))
	slog.SetDefault(logger)

	// ── Database ──────────────────────────────────────────────────────────────
	database, dialect, err := db.Open(cfg.DBDSN)
	if err != nil {
		logger.Error("open database", "dialect", db.DetectDialect(cfg.DBDSN), "err", err)
		os.Exit(1)
	}
	defer func() { _ = database.Close() }()
	logger.Info("database connected", "dialect", dialect, "dsn", db.RedactDSN(cfg.DBDSN))

	if err := db.Migrate(database, dialect); err != nil {
		logger.Error("migrate database", "err", err)
		os.Exit(1)
	}

	// ── Cluster Registry ──────────────────────────────────────────────────────
	registry := cluster.NewRegistry(cfg.Clusters)
	if len(registry.All()) == 0 {
		logger.Warn("no clusters configured")
	}

	// ── Stores ────────────────────────────────────────────────────────────────
	alertStore := &history.AlertStore{}
	store := history.NewStore(database, dialect)
	userStore := users.NewStore(database, dialect)

	// ── Auth Provider ─────────────────────────────────────────────────────────
	var authProvider auth.Provider
	switch cfg.AuthProvider {
	case "internal":
		authProvider = auth.NewInternalProvider(userStore)
		logger.Info("auth provider: internal")
	case "oidc":
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		oidcProvider, err := auth.NewOIDCProvider(ctx, cfg.OIDCIssuer, cfg.OIDCClientID,
			cfg.OIDCClientSecret, cfg.OIDCRedirectURL, cfg.OIDCScopes, userStore,
			cfg.OIDCAdminClaim, cfg.OIDCAdminValue)
		cancel()
		if err != nil {
			logger.Error("oidc provider init", "err", err)
			os.Exit(1)
		}
		authProvider = oidcProvider
		logger.Info("auth provider: oidc", "issuer", cfg.OIDCIssuer)
	default:
		authProvider = auth.NoneProvider{}
		logger.Info("auth provider: none (write actions blocked)")
	}

	// ── WebSocket Hub ─────────────────────────────────────────────────────────
	hub := ws.NewHub(cfg.AllowedOrigins, logger)
	go hub.Run()

	// ── Recorder ──────────────────────────────────────────────────────────────
	recorder := history.NewRecorder(registry, alertStore, store, hub, cfg.PollInterval, logger)

	// ── HTTP Router ───────────────────────────────────────────────────────────
	router := api.NewRouter(alertStore, store, hub, registry, cfg, static.StaticFiles, recorder, authProvider, userStore)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// ── Start ─────────────────────────────────────────────────────────────────
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go recorder.Start(ctx)

	go func() {
		logger.Info("jarvis started", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	logger.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("shutdown error", "err", err)
	}
}
