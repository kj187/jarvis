package api

import (
	"context"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/fanout"
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
	fanout       fanout.Fanout
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
	f fanout.Fanout,
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
		fanout:       f,
	}
}

// broadcastAndFanout builds a WS event once, broadcasts it to this pod's own
// clients, and publishes it to every other pod via fanout (D4,
// tmp/fable/multi-replica.md) — the single call site every user-mutation
// handler (comments, claims, silences) uses instead of hub.BroadcastJSON
// directly, so cross-pod delivery is never forgotten when a new mutation
// broadcast is added. Snapshot-driven broadcasts (alerts_update, the
// poll-time silences_update in history.Recorder) do NOT go through this —
// every pod already derives those from its own poll or consumed snapshot
// (D3), so fanning them out too would be redundant.
func (s *Server) broadcastAndFanout(ctx context.Context, eventType string, payload interface{}, ref fanout.Ref) {
	data, err := ws.BuildEventJSON(eventType, payload)
	if err != nil {
		// BuildEventJSON's failure modes are the same as BroadcastJSON's
		// (marshal error) — fall back to it so local clients still get
		// best-effort delivery even though fanout is skipped this once.
		s.hub.BroadcastJSON(eventType, payload)
		return
	}
	s.hub.BroadcastRaw(data)
	s.fanout.Publish(ctx, data, ref)
}

// POST /api/v1/poll — triggers an immediate Alertmanager poll.
func (s *Server) triggerPoll(c echo.Context) error {
	if s.pollTrigger != nil {
		s.pollTrigger.Trigger()
	}
	return c.NoContent(http.StatusNoContent)
}
