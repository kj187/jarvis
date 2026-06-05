package api

import (
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// Server holds shared dependencies for all API handlers.
type Server struct {
	alertStore *history.AlertStore
	store      *history.Store
	hub        *ws.Hub
	registry   *cluster.Registry
	cfg        *config.Config
}

// NewServer creates a new Server with the given dependencies.
func NewServer(
	alertStore *history.AlertStore,
	store *history.Store,
	hub *ws.Hub,
	registry *cluster.Registry,
	cfg *config.Config,
) *Server {
	return &Server{
		alertStore: alertStore,
		store:      store,
		hub:        hub,
		registry:   registry,
		cfg:        cfg,
	}
}
