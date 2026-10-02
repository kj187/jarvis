package history

import "time"

// ClusterFreshness describes how old a cluster's data is.
type ClusterFreshness struct {
	// LastSuccessAt is the last successful Alertmanager fetch; zero when none is known.
	LastSuccessAt time.Time
	// Stale is true when that is older than max(3 × poll interval, 60 s). A
	// cluster that never answered counts from this pod's start.
	Stale bool
}

func (r *Recorder) staleThreshold() time.Duration {
	return max(snapshotStaleFactor*r.interval, minStaleThreshold)
}

func (r *Recorder) markPollSuccess(clusterName string, at time.Time) {
	r.freshMu.Lock()
	defer r.freshMu.Unlock()
	if r.lastSuccess == nil {
		r.lastSuccess = make(map[string]time.Time)
	}
	r.lastSuccess[clusterName] = at
}

func (r *Recorder) lastSuccessAt(clusterName string) (time.Time, bool) {
	r.freshMu.Lock()
	defer r.freshMu.Unlock()
	at, ok := r.lastSuccess[clusterName]
	return at, ok
}

// ClusterFreshness returns the data age of every configured cluster. A leader
// reports its own polls; a follower reports what the leader recorded in the
// last snapshot it consumed. It reads cached state only.
func (r *Recorder) ClusterFreshness() map[string]ClusterFreshness {
	if r.registry == nil {
		return nil
	}
	known := make(map[string]time.Time)
	if r.IsLeader() {
		r.freshMu.Lock()
		for name, at := range r.lastSuccess {
			known[name] = at
		}
		r.freshMu.Unlock()
	} else {
		r.followerMu.Lock()
		for name, entry := range r.followerSnapshots {
			known[name] = entry.lastSuccessAt
			if entry.lastSuccessAt.IsZero() {
				known[name] = entry.takenAt
			}
		}
		r.followerMu.Unlock()
	}

	now := r.currentTime()
	threshold := r.staleThreshold()
	out := make(map[string]ClusterFreshness, len(r.registry.All()))
	for _, cl := range r.registry.All() {
		at := known[cl.Name]
		base := at
		if base.IsZero() {
			base = r.startedAt
		}
		out[cl.Name] = ClusterFreshness{LastSuccessAt: at, Stale: now.Sub(base) > threshold}
	}
	return out
}

// updateStaleGauge sets jarvis_snapshot_stale to 1 while any cluster is stale.
func (r *Recorder) updateStaleGauge() {
	if r.metrics == nil {
		return
	}
	stale := 0.0
	for _, f := range r.ClusterFreshness() {
		if f.Stale {
			stale = 1
			break
		}
	}
	r.metrics.SnapshotStale.Set(stale)
}

// ClusterLastSuccess returns the last successful fetch per cluster for the
// metrics collector; clusters without a known success are omitted.
func (r *Recorder) ClusterLastSuccess() map[string]time.Time {
	out := make(map[string]time.Time)
	for name, f := range r.ClusterFreshness() {
		if !f.LastSuccessAt.IsZero() {
			out[name] = f.LastSuccessAt
		}
	}
	return out
}
