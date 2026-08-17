package api

import (
	"log/slog"
	"strconv"

	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// HandleFanoutMessage returns the callback for Fanout.Run's onMessage: a
// message published by another pod is re-broadcast to this pod's own WS
// clients unchanged.
func HandleFanoutMessage(hub *ws.Hub) func(message []byte) {
	return func(message []byte) {
		hub.BroadcastRaw(message)
	}
}

// HandleFanoutRef returns the callback for Fanout.Run's onRef: another pod's
// mutation broadcast was too large to embed in a single NOTIFY payload (D4,
// docs/persistence.md), so only a Ref arrived. Every pod shares the
// same PostgreSQL database, so this pod refetches the authoritative row via
// store and reconstructs the exact broadcast the originating pod would have
// sent, then broadcasts that reconstruction to its own clients.
func HandleFanoutRef(store *history.Store, hub *ws.Hub, logger *slog.Logger) func(ref fanout.Ref) {
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
			hub.BroadcastJSON(models.WSTypeClaimSet, map[string]interface{}{
				"fingerprint": ref.Fingerprint,
				"clusterName": ref.ClusterName,
				"claim":       claim,
			})

		case models.WSTypeClaimReleased:
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
