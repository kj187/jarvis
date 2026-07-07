package history

import (
	"sync"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
)

// SilenceStore holds the last successfully polled silences per cluster.
// Mirrors AlertStore: in-memory, mutex-guarded, replaced wholesale per
// cluster on every successful poll. API mutation handlers write through
// (Upsert / MarkExpired) so a user's change is visible immediately; the next
// poll reconciles the snapshot with the authoritative Alertmanager state.
//
// Stores raw alertmanager.GettableSilence — the api package owns the
// conversion to models.Silence (cluster name and AlertmanagerLinkURL are
// api-layer concerns).
type SilenceStore struct {
	mu        sync.RWMutex
	byCluster map[string][]alertmanager.GettableSilence
}

// NewSilenceStore creates an empty SilenceStore.
func NewSilenceStore() *SilenceStore {
	return &SilenceStore{byCluster: make(map[string][]alertmanager.GettableSilence)}
}

// Set replaces the snapshot for one cluster.
func (s *SilenceStore) Set(cluster string, silences []alertmanager.GettableSilence) {
	copied := make([]alertmanager.GettableSilence, len(silences))
	copy(copied, silences)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byCluster[cluster] = copied
}

// Get returns a copy of the full snapshot (cluster → silences).
func (s *SilenceStore) Get() map[string][]alertmanager.GettableSilence {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string][]alertmanager.GettableSilence, len(s.byCluster))
	for cluster, silences := range s.byCluster {
		copied := make([]alertmanager.GettableSilence, len(silences))
		copy(copied, silences)
		out[cluster] = copied
	}
	return out
}

// GetCluster returns a copy of one cluster's silences (nil when unknown).
func (s *SilenceStore) GetCluster(cluster string) []alertmanager.GettableSilence {
	s.mu.RLock()
	defer s.mu.RUnlock()
	silences, ok := s.byCluster[cluster]
	if !ok {
		return nil
	}
	copied := make([]alertmanager.GettableSilence, len(silences))
	copy(copied, silences)
	return copied
}

// Upsert replaces the silence with the same ID in the cluster's snapshot, or
// appends it. Write-through entry point for API mutations — bridges the gap
// until the next poll delivers the authoritative state.
func (s *SilenceStore) Upsert(cluster string, sil alertmanager.GettableSilence) {
	s.mu.Lock()
	defer s.mu.Unlock()
	silences := s.byCluster[cluster]
	for i := range silences {
		if silences[i].ID == sil.ID {
			silences[i] = sil
			return
		}
	}
	s.byCluster[cluster] = append(silences, sil)
}

// MarkExpired sets the silence's state to "expired" and EndsAt to now.
// No-op when the ID is not in the cluster's snapshot.
func (s *SilenceStore) MarkExpired(cluster, id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	silences := s.byCluster[cluster]
	for i := range silences {
		if silences[i].ID == id {
			silences[i].Status.State = "expired"
			silences[i].EndsAt = time.Now().UTC()
			return
		}
	}
}

// Reset clears the whole snapshot. Used only by the e2e test-reset route.
func (s *SilenceStore) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.byCluster = make(map[string][]alertmanager.GettableSilence)
}
