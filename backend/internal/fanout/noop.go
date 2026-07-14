package fanout

import "context"

// NoopFanout is the SQLite-dialect Fanout: SQLite deployments are single
// replica by design (Critical Invariant #8), so there is never another pod
// to fan out to.
type NoopFanout struct{}

func (NoopFanout) Publish(context.Context, []byte, Ref) {}

// Run blocks until ctx is cancelled — there is no receive loop to run, but
// callers can still treat every Fanout uniformly (go f.Run(ctx, ...)).
func (NoopFanout) Run(ctx context.Context, _ func([]byte), _ func(Ref)) { <-ctx.Done() }
