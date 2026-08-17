package leader

import "context"

// StaticElector is the SQLite-dialect Elector: SQLite deployments are single
// writer and single replica by design (Critical Invariant #8, D6 in
// docs/persistence.md), so there is never a follower to coordinate
// with — this process is always leader.
type StaticElector struct{}

// NewStaticElector returns an Elector that is always leader.
func NewStaticElector() *StaticElector {
	return &StaticElector{}
}

func (StaticElector) IsLeader() bool { return true }

// Run blocks until ctx is cancelled — there is no election loop to run, but
// callers can still treat every Elector uniformly (go el.Run(ctx)).
func (StaticElector) Run(ctx context.Context) { <-ctx.Done() }

// Subscribe fires fn(true) once, synchronously, and never again — the
// leadership state never changes.
func (StaticElector) Subscribe(fn func(bool)) { fn(true) }
