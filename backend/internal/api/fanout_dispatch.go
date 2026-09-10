package api

import (
	"encoding/json"
	"log/slog"
	"strconv"

	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// HandleFanoutMessage returns the callback for Fanout.Run's onMessage: a
// message published by another pod is re-broadcast to this pod's own WS
// clients unchanged. For claim mutations it additionally patches this pod's
// in-memory AlertStore, mirroring what claims.go did on the originating pod —
// otherwise a client's REST read (GET /api/v1/alerts, e.g. the refetch a
// claim mutation triggers) that load-balances onto this non-originating pod
// before its next snapshot rebuild would serve a claim-less snapshot and wipe
// the just-shown claim until the next poll.
func HandleFanoutMessage(hub *ws.Hub, alertStore *history.AlertStore) func(message []byte) {
	return func(message []byte) {
		applyClaimSideEffect(message, alertStore, nil)
		hub.BroadcastRaw(message)
	}
}

// applyClaimSideEffect patches alertStore when message is a claim_set /
// claim_released WS envelope. lookup, when non-nil, resolves the authoritative
// claim for a claim_set whose payload carried no embedded claim (the Ref
// fallback path); it returns nil when there is no active claim.
func applyClaimSideEffect(message []byte, alertStore *history.AlertStore, lookup func(fp, cluster string) *models.Claim) {
	if alertStore == nil {
		return
	}
	var event models.WSEvent
	if err := json.Unmarshal(message, &event); err != nil {
		return
	}
	switch event.Type {
	case models.WSTypeClaimSet:
		var p struct {
			Fingerprint string        `json:"fingerprint"`
			ClusterName string        `json:"clusterName"`
			Claim       *models.Claim `json:"claim"`
		}
		if err := json.Unmarshal(event.Payload, &p); err != nil || p.Fingerprint == "" {
			return
		}
		claim := p.Claim
		if claim == nil && lookup != nil {
			claim = lookup(p.Fingerprint, p.ClusterName)
		}
		if claim == nil {
			return
		}
		alertStore.SetActiveClaim(p.Fingerprint, p.ClusterName, claim)
	case models.WSTypeClaimReleased:
		var p struct {
			Fingerprint string `json:"fingerprint"`
			ClusterName string `json:"clusterName"`
		}
		if err := json.Unmarshal(event.Payload, &p); err != nil || p.Fingerprint == "" {
			return
		}
		alertStore.ClearActiveClaim(p.Fingerprint, p.ClusterName)
	}
}

// HandleFanoutRef returns the callback for Fanout.Run's onRef: another pod's
// mutation broadcast was too large to embed in a single NOTIFY payload (D4,
// docs/persistence.md), so only a Ref arrived. Every pod shares the
// same PostgreSQL database, so this pod refetches the authoritative row via
// store and reconstructs the exact broadcast the originating pod would have
// sent, then broadcasts that reconstruction to its own clients — and, for
// claim mutations, patches its own AlertStore the same way HandleFanoutMessage
// does for the embedded-payload path.
func HandleFanoutRef(store *history.Store, alertStore *history.AlertStore, hub *ws.Hub, logger *slog.Logger) func(ref fanout.Ref) {
	return func(ref fanout.Ref) {
		switch ref.Type {
		case "comment_added":
			id, err := strconv.ParseInt(ref.ID, 10, 64)
			if err != nil {
				logger.Error("fanout: invalid comment ref id", "ref", ref, "err", err)
				return
			}
			comment, err := store.GetComment(ref.Fingerprint, ref.ClusterName, id)
			if err != nil {
				logger.Error("fanout: refetch comment for ref", "ref", ref, "err", err)
				return
			}
			if comment == nil {
				return
			}
			hub.BroadcastJSON("comment_added", map[string]interface{}{
				"fingerprint": ref.Fingerprint,
				"comment":     comment,
			})

		case models.WSTypeClaimSet:
			claim, err := store.GetActiveClaim(ref.Fingerprint, ref.ClusterName)
			if err != nil {
				logger.Error("fanout: refetch claim for ref", "ref", ref, "err", err)
				return
			}
			if claim == nil {
				return
			}
			if alertStore != nil {
				alertStore.SetActiveClaim(ref.Fingerprint, ref.ClusterName, claim)
			}
			hub.BroadcastJSON(models.WSTypeClaimSet, map[string]interface{}{
				"fingerprint": ref.Fingerprint,
				"clusterName": ref.ClusterName,
				"claim":       claim,
			})

		case models.WSTypeClaimReleased:
			if alertStore != nil {
				alertStore.ClearActiveClaim(ref.Fingerprint, ref.ClusterName)
			}
			hub.BroadcastJSON(models.WSTypeClaimReleased, map[string]interface{}{
				"fingerprint": ref.Fingerprint,
				"clusterName": ref.ClusterName,
				"releasedBy":  ref.ID,
			})

		case models.WSTypeSilencesUpdate:
			hub.BroadcastJSON(models.WSTypeSilencesUpdate, struct{}{})

		default:
			logger.Warn("fanout: unknown ref type", "ref", ref)
		}
	}
}
