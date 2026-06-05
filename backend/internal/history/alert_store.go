package history

import (
	"sync"

	"github.com/kj187/jarvis/backend/internal/models"
)

// AlertStore is an in-memory store for the current poll snapshot.
// All methods are safe for concurrent use.
type AlertStore struct {
	mu     sync.RWMutex
	alerts []models.EnrichedAlert
}

// Set replaces the entire alert snapshot.
func (s *AlertStore) Set(alerts []models.EnrichedAlert) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.alerts = make([]models.EnrichedAlert, len(alerts))
	copy(s.alerts, alerts)
}

// Get returns a copy of the current alert snapshot.
func (s *AlertStore) Get() []models.EnrichedAlert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]models.EnrichedAlert, len(s.alerts))
	copy(result, s.alerts)
	return result
}

// SetActiveClaim patches the active claim for a specific alert fingerprint.
func (s *AlertStore) SetActiveClaim(fingerprint string, claim *models.Claim) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.alerts {
		if s.alerts[i].Fingerprint == fingerprint {
			s.alerts[i].ActiveClaim = claim
			return
		}
	}
}

// ClearActiveClaim removes the active claim for a specific alert fingerprint.
func (s *AlertStore) ClearActiveClaim(fingerprint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.alerts {
		if s.alerts[i].Fingerprint == fingerprint {
			s.alerts[i].ActiveClaim = nil
			return
		}
	}
}

// MarkResolved sets the status of the given fingerprint to "resolved" in-memory
// and clears its active claim.
func (s *AlertStore) MarkResolved(fingerprint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.alerts {
		if s.alerts[i].Fingerprint == fingerprint {
			s.alerts[i].Status.State = "resolved"
			s.alerts[i].ActiveClaim = nil
			return
		}
	}
}

// RemoveByFingerprint removes the alert with the given fingerprint from the
// in-memory store.
func (s *AlertStore) RemoveByFingerprint(fingerprint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	filtered := s.alerts[:0]
	for _, a := range s.alerts {
		if a.Fingerprint != fingerprint {
			filtered = append(filtered, a)
		}
	}
	s.alerts = append([]models.EnrichedAlert(nil), filtered...)
}
