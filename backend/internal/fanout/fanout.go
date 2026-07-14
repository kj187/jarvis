// Package fanout implements cross-pod WebSocket mutation fanout (D4,
// tmp/fable/multi-replica.md): a mutation handled by one pod (a comment,
// claim, or silence write) must also reach WS clients connected to every
// other pod. Only user-mutation broadcasts go through this — alert-state
// broadcasts (alerts_update, the poll-driven silences_update) ride the D3
// snapshot distribution path instead, since every pod already derives those
// from its own poll or consumed snapshot.
package fanout

import "context"

// Ref identifies a mutation well enough for the receiving pod to look the
// full row back up itself, when the encoded message didn't fit in a single
// NOTIFY payload (~8000 bytes — PostgreSQL's limit). Type selects which
// domain (and therefore which store lookup) applies; the rest are that
// domain's natural identifying fields (comments: Fingerprint+ClusterName+ID;
// claims: Fingerprint+ClusterName; silences: Type alone, since its payload
// is always the empty struct and never needs a real lookup).
type Ref struct {
	Type        string `json:"type"`
	Fingerprint string `json:"fingerprint,omitempty"`
	ClusterName string `json:"clusterName,omitempty"`
	ID          string `json:"id,omitempty"`
}

// Fanout publishes an already-encoded WS message to every other pod and
// delivers messages published by other pods back to this one. Implementations
// must suppress a pod's own Publish calls from reaching its own onMessage/onRef
// callbacks (origin echo suppression) — Publish already both-broadcasts
// locally (via the caller's own ws.Hub) and fans out, so echoing it back
// would double-deliver to this pod's own clients.
type Fanout interface {
	// Publish sends message to every other pod's Run callback. ref is used
	// instead of message when message is too large to fit in a single NOTIFY
	// payload — the receiving pod must then look the full data back up
	// itself using ref's fields.
	Publish(ctx context.Context, message []byte, ref Ref)

	// Run drives the receive loop until ctx is cancelled — call in its own
	// goroutine. onMessage is invoked with the exact bytes another pod
	// published; onRef is invoked instead when that pod's message was too
	// large to embed.
	Run(ctx context.Context, onMessage func(message []byte), onRef func(ref Ref))
}
