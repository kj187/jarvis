package history

import (
	"sync"

	"github.com/kj187/jarvis/backend/internal/models"
)

// AlertStore is an in-memory store for the current poll snapshot.
// All methods are safe for concurrent use.
type AlertStore struct {
	mu             sync.RWMutex
	alerts         []models.EnrichedAlert
	resolvedBuffer map[string]models.EnrichedAlert // kept for 20 min after resolve
}

// Set replaces the active alert snapshot. Alerts that reappear as active are
// removed from the resolved buffer (they came back before the 20-min window).
func (s *AlertStore) Set(alerts []models.EnrichedAlert) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.alerts = make([]models.EnrichedAlert, len(alerts))
	copy(s.alerts, alerts)
	for _, a := range alerts {
		delete(s.resolvedBuffer, a.Fingerprint)
	}
}

// Get returns a copy of all alerts: currently active + resolved buffer.
func (s *AlertStore) Get() []models.EnrichedAlert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]models.EnrichedAlert, len(s.alerts))
	copy(result, s.alerts)
	for _, a := range s.resolvedBuffer { // nil-map range is safe in Go
		result = append(result, a)
	}
	return result
}

// SetActiveClaim patches the active claim for a specific alert (fingerprint + cluster).
func (s *AlertStore) SetActiveClaim(fingerprint, clusterName string, claim *models.Claim) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.alerts {
		if s.alerts[i].Fingerprint == fingerprint && s.alerts[i].ClusterName == clusterName {
			s.alerts[i].ActiveClaim = claim
			return
		}
	}
}

// ClearActiveClaim removes the active claim for a specific alert (fingerprint + cluster).
func (s *AlertStore) ClearActiveClaim(fingerprint, clusterName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.alerts {
		if s.alerts[i].Fingerprint == fingerprint && s.alerts[i].ClusterName == clusterName {
			s.alerts[i].ActiveClaim = nil
			return
		}
	}
}

// MarkResolved moves the alert to the resolved buffer so it stays visible for
// 20 minutes after disappearing from Alertmanager. Clears its active claim.
// The resolved buffer is NOT overwritten by Set, so the entry survives the next poll.
func (s *AlertStore) MarkResolved(fingerprint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, a := range s.alerts {
		if a.Fingerprint == fingerprint {
			resolved := a
			resolved.Status.State = "resolved"
			resolved.ActiveClaim = nil
			if s.resolvedBuffer == nil {
				s.resolvedBuffer = make(map[string]models.EnrichedAlert)
			}
			s.resolvedBuffer[fingerprint] = resolved
			s.alerts = append(s.alerts[:i], s.alerts[i+1:]...)
			return
		}
	}
}

// SeedResolved pre-populates the resolved buffer from persistent storage (e.g. on
// startup). Entries already present are not overwritten. No removal timer is
// scheduled — seeded alerts stay visible until they reappear as active (Set clears them).
func (s *AlertStore) SeedResolved(alerts []models.EnrichedAlert) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.resolvedBuffer == nil {
		s.resolvedBuffer = make(map[string]models.EnrichedAlert)
	}
	for _, a := range alerts {
		if _, exists := s.resolvedBuffer[a.Fingerprint]; !exists {
			s.resolvedBuffer[a.Fingerprint] = a
		}
	}
}

// RemoveByFingerprint removes the alert from both active list and resolved buffer.
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
	delete(s.resolvedBuffer, fingerprint)
}
