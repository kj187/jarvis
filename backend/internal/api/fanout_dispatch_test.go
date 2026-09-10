package api

import (
	"io"
	"log/slog"
	"testing"

	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/ws"
)

func fanoutTestHub(t *testing.T) *ws.Hub {
	t.Helper()
	hub := ws.NewHub(nil, nil, metrics.New("test-fanout-dispatch"))
	go hub.Run()
	return hub
}

func seedAlert(store *history.AlertStore, fp, cluster string) {
	store.Set([]models.EnrichedAlert{{
		Fingerprint: fp,
		ClusterName: cluster,
		Status:      models.AlertStatus{State: "active"},
		Labels:      map[string]string{"alertname": "TestAlert"},
	}})
}

// A claim_set event fanned out from another pod must patch this pod's own
// in-memory AlertStore, not only re-broadcast the WS event. Otherwise a
// client's REST read (GET /api/v1/alerts) that load-balances onto this
// non-originating pod between the claim and this pod's next snapshot rebuild
// returns a claim-less snapshot, wiping the just-shown claim until the next
// poll.
func TestHandleFanoutMessage_ClaimSet_PatchesLocalAlertStore(t *testing.T) {
	hub := fanoutTestHub(t)
	alertStore := &history.AlertStore{}
	seedAlert(alertStore, "fp1", "c1")

	data, err := ws.BuildEventJSON(models.WSTypeClaimSet, map[string]interface{}{
		"fingerprint": "fp1",
		"clusterName": "c1",
		"claim": models.Claim{
			Fingerprint: "fp1",
			ClusterName: "c1",
			ClaimedBy:   "alice",
			Note:        "on it",
		},
	})
	if err != nil {
		t.Fatalf("BuildEventJSON: %v", err)
	}

	HandleFanoutMessage(hub, alertStore)(data)

	got := alertStore.Get()
	if len(got) != 1 {
		t.Fatalf("alerts = %d, want 1", len(got))
	}
	if got[0].ActiveClaim == nil || got[0].ActiveClaim.ClaimedBy != "alice" {
		t.Fatalf("ActiveClaim = %+v, want claimed by alice", got[0].ActiveClaim)
	}
}

// The mirror case: a claim_released event fanned out from another pod must
// clear the claim from this pod's AlertStore.
func TestHandleFanoutMessage_ClaimReleased_ClearsLocalAlertStore(t *testing.T) {
	hub := fanoutTestHub(t)
	alertStore := &history.AlertStore{}
	seedAlert(alertStore, "fp1", "c1")
	alertStore.SetActiveClaim("fp1", "c1", &models.Claim{Fingerprint: "fp1", ClusterName: "c1", ClaimedBy: "alice"})

	data, err := ws.BuildEventJSON(models.WSTypeClaimReleased, map[string]interface{}{
		"fingerprint": "fp1",
		"clusterName": "c1",
		"releasedBy":  "alice",
	})
	if err != nil {
		t.Fatalf("BuildEventJSON: %v", err)
	}

	HandleFanoutMessage(hub, alertStore)(data)

	got := alertStore.Get()
	if len(got) != 1 {
		t.Fatalf("alerts = %d, want 1", len(got))
	}
	if got[0].ActiveClaim != nil {
		t.Fatalf("ActiveClaim = %+v, want nil", got[0].ActiveClaim)
	}
}

// A non-claim event (e.g. comment_added) must leave the AlertStore untouched.
func TestHandleFanoutMessage_NonClaimEvent_LeavesAlertStoreUntouched(t *testing.T) {
	hub := fanoutTestHub(t)
	alertStore := &history.AlertStore{}
	seedAlert(alertStore, "fp1", "c1")

	data, err := ws.BuildEventJSON("comment_added", map[string]interface{}{
		"fingerprint": "fp1",
		"comment":     map[string]string{"body": "hi"},
	})
	if err != nil {
		t.Fatalf("BuildEventJSON: %v", err)
	}

	HandleFanoutMessage(hub, alertStore)(data)

	if got := alertStore.Get(); got[0].ActiveClaim != nil {
		t.Fatalf("ActiveClaim = %+v, want nil", got[0].ActiveClaim)
	}
}

// The Ref fallback path (oversized fanout payload) must also patch the local
// AlertStore after refetching the claim from the shared DB.
func TestHandleFanoutRef_ClaimSet_PatchesLocalAlertStore(t *testing.T) {
	srv, alertStore, store := newTestServerFull(t)
	_ = srv
	seedFP(t, store, "fp1")
	seedAlert(alertStore, "fp1", "homelab")
	if _, err := store.SetClaim("fp1", "homelab", nil, "alice", "on it"); err != nil {
		t.Fatalf("SetClaim: %v", err)
	}

	hub := fanoutTestHub(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	HandleFanoutRef(store, alertStore, hub, logger)(fanout.Ref{
		Type:        models.WSTypeClaimSet,
		Fingerprint: "fp1",
		ClusterName: "homelab",
	})

	got := alertStore.Get()
	if got[0].ActiveClaim == nil || got[0].ActiveClaim.ClaimedBy != "alice" {
		t.Fatalf("ActiveClaim = %+v, want claimed by alice", got[0].ActiveClaim)
	}
}

func TestHandleFanoutRef_ClaimReleased_ClearsLocalAlertStore(t *testing.T) {
	srv, alertStore, store := newTestServerFull(t)
	_ = srv
	seedFP(t, store, "fp1")
	seedAlert(alertStore, "fp1", "homelab")
	alertStore.SetActiveClaim("fp1", "homelab", &models.Claim{Fingerprint: "fp1", ClusterName: "homelab", ClaimedBy: "alice"})

	hub := fanoutTestHub(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	HandleFanoutRef(store, alertStore, hub, logger)(fanout.Ref{
		Type:        models.WSTypeClaimReleased,
		Fingerprint: "fp1",
		ClusterName: "homelab",
		ID:          "alice",
	})

	if got := alertStore.Get(); got[0].ActiveClaim != nil {
		t.Fatalf("ActiveClaim = %+v, want nil", got[0].ActiveClaim)
	}
}
