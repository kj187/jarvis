package api

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// pollTriggerer allows the HTTP layer to request an immediate poll and to
// read this pod's current leader-election state (tmp/fable/multi-replica.md)
// for the /api/v1/status payload.
type pollTriggerer interface {
	Trigger()
	IsLeader() bool
}

// Server holds shared dependencies for all API handlers.
type Server struct {
	alertStore   *history.AlertStore
	silenceStore *history.SilenceStore
	store        *history.Store
	hub          *ws.Hub
	registry     *cluster.Registry
	cfg          *config.Config
	pollTrigger  pollTriggerer
	authProvider auth.Provider
	userStore    *users.Store
}

// NewServer creates a new Server with the given dependencies.
func NewServer(
	alertStore *history.AlertStore,
	silenceStore *history.SilenceStore,
	store *history.Store,
	hub *ws.Hub,
	registry *cluster.Registry,
	cfg *config.Config,
	pollTrigger pollTriggerer,
	authProvider auth.Provider,
	userStore *users.Store,
) *Server {
	return &Server{
		alertStore:   alertStore,
		silenceStore: silenceStore,
		store:        store,
		hub:          hub,
		registry:     registry,
		cfg:          cfg,
		pollTrigger:  pollTrigger,
		authProvider: authProvider,
		userStore:    userStore,
	}
}

// POST /api/v1/poll — triggers an immediate Alertmanager poll.
func (s *Server) triggerPoll(c echo.Context) error {
	if s.pollTrigger != nil {
		s.pollTrigger.Trigger()
	}
	return c.NoContent(http.StatusNoContent)
}
