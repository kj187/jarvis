package api

import (
	"math"
	"sync"
	"time"
)

// manualPollMinInterval is the shortest gap between two accepted manual polls
// (POST /api/v1/poll). It is a variable so tests can change it; the e2e build
// sets the default to 0 because its specs force a poll after every seed.
var manualPollMinInterval = defaultManualPollMinInterval

// pollGate spaces manual polls apart globally, per pod. It is deliberately not
// keyed by client: the point is to bound the load on Alertmanager, and a
// per-client bucket could be sidestepped by rotating addresses.
type pollGate struct {
	mu   sync.Mutex
	last time.Time
}

// allow reports whether a poll requested at now may run. When it may not, wait
// says how long until it can. Only accepted polls move the window.
func (g *pollGate) allow(now time.Time, minInterval time.Duration) (wait time.Duration, ok bool) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if minInterval > 0 && !g.last.IsZero() {
		if elapsed := now.Sub(g.last); elapsed < minInterval {
			return minInterval - elapsed, false
		}
	}
	g.last = now
	return 0, true
}

func retryAfterSeconds(d time.Duration) int {
	return int(math.Ceil(d.Seconds()))
}
