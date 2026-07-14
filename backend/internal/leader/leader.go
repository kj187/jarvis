// Package leader implements multi-replica leader election (tmp/fable/multi-replica.md, D2):
// exactly one pod polls Alertmanager, writes history, and runs retention —
// coordinated via a PostgreSQL session-level advisory lock. SQLite deployments
// never have more than one replica, so they use StaticElector instead.
package leader

import "context"

// Elector is satisfied by PGElector (PostgreSQL dialect) and StaticElector
// (SQLite dialect). Subscribe — not a single channel — because there are two
// independent consumers (history.Recorder's promotion hook and the pod
// labeler, tmp/fable/multi-replica.md D7): a shared channel would deliver
// each transition to only one of them.
type Elector interface {
	// IsLeader reports whether this process currently holds leadership.
	IsLeader() bool
	// Run drives the election loop until ctx is cancelled. Callers start it
	// in its own goroutine.
	Run(ctx context.Context)
	// Subscribe registers fn to be called on every leadership transition,
	// including once immediately for the initial state. Callbacks run
	// sequentially on the elector's own goroutine and must not block —
	// spawn a goroutine for slow work.
	Subscribe(fn func(isLeader bool))
}
