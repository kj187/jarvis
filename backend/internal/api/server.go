package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/globalsettings"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// pollTriggerer allows the HTTP layer to request an immediate poll and to
// read this pod's current leader-election state (docs/postgres-ha.md)
// for the /api/v1/status payload.
type pollTriggerer interface {
	Trigger()
	IsLeader() bool
}

// clusterFreshnessSource is implemented by the recorder; the handler asserts
// for it so a nil or minimal pollTriggerer simply reports no data age.
type clusterFreshnessSource interface {
	ClusterFreshness() map[string]history.ClusterFreshness
}

// clusterUpStateSource is implemented by the recorder. A follower never polls
// Alertmanager itself, so it reports member health from the leader's last
// consumed snapshot instead of the registry's (empty) poll state.
type clusterUpStateSource interface {
	ClusterUpStates() map[string]map[string]bool
}

// Server holds shared dependencies for all API handlers.
type Server struct {
	alertStore          *history.AlertStore
	silenceStore        *history.SilenceStore
	store               *history.Store
	hub                 *ws.Hub
	registry            *cluster.Registry
	cfg                 *config.Config
	pollTrigger         pollTriggerer
	authProvider        auth.Provider
	userStore           *users.Store
	settingsStore       *settings.Store
	globalSettingsStore *globalsettings.Store
	fanout              fanout.Fanout
	dbHealth            dbHealth
	pollGate            pollGate
	loginThrottle       *auth.LoginThrottle
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
	settingsStore *settings.Store,
	globalSettingsStore *globalsettings.Store,
	f fanout.Fanout,
) *Server {
	return &Server{
		alertStore:          alertStore,
		silenceStore:        silenceStore,
		store:               store,
		hub:                 hub,
		registry:            registry,
		cfg:                 cfg,
		pollTrigger:         pollTrigger,
		authProvider:        authProvider,
		userStore:           userStore,
		settingsStore:       settingsStore,
		globalSettingsStore: globalSettingsStore,
		fanout:              f,
		loginThrottle:       auth.NewLoginThrottle(),
	}
}

// broadcastAndFanout builds a WS event once, broadcasts it to this pod's own
// clients, and publishes it to every other pod via fanout (D4,
// docs/postgres-ha.md) — the single call site every user-mutation
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

// POST /api/v1/poll — triggers an immediate Alertmanager poll. Polls closer
// together than manualPollMinInterval are refused with 429; the recorder's own
// interval keeps the data fresh in the meantime.
func (s *Server) triggerPoll(c echo.Context) error {
	if wait, ok := s.pollGate.allow(time.Now(), manualPollMinInterval); !ok {
		c.Response().Header().Set(echo.HeaderRetryAfter, strconv.Itoa(retryAfterSeconds(wait)))
		return echo.NewHTTPError(http.StatusTooManyRequests, "poll requested too recently")
	}
	if s.pollTrigger != nil {
		s.pollTrigger.Trigger()
	}
	return c.NoContent(http.StatusNoContent)
}
