package history

import (
	"sync"
	"testing"

	"github.com/kj187/jarvis/backend/internal/models"
)

func makeAlert(fp, state string) models.EnrichedAlert {
	return models.EnrichedAlert{
		Fingerprint: fp,
		Status:      models.AlertStatus{State: state},
	}
}

func TestAlertStore_SetGet(t *testing.T) {
	s := &AlertStore{}
	alerts := []models.EnrichedAlert{makeAlert("fp1", "active"), makeAlert("fp2", "active")}
	s.Set(alerts)

	got := s.Get()
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
}

func TestAlertStore_GetReturnsCopy(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	got := s.Get()
	got[0].Fingerprint = "modified"

	original := s.Get()
	if original[0].Fingerprint != "fp1" {
		t.Error("Get() did not return a copy — store was mutated")
	}
}

func TestAlertStore_SetActiveClaim(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	claim := &models.Claim{ID: 1, ClaimedBy: "alice"}
	s.SetActiveClaim("fp1", claim)

	got := s.Get()
	if got[0].ActiveClaim == nil {
		t.Fatal("ActiveClaim is nil after SetActiveClaim")
	}
	if got[0].ActiveClaim.ClaimedBy != "alice" {
		t.Errorf("ClaimedBy = %q, want alice", got[0].ActiveClaim.ClaimedBy)
	}
}

func TestAlertStore_ClearActiveClaim(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})
	s.SetActiveClaim("fp1", &models.Claim{ID: 1, ClaimedBy: "alice"})
	s.ClearActiveClaim("fp1")

	got := s.Get()
	if got[0].ActiveClaim != nil {
		t.Error("ActiveClaim should be nil after ClearActiveClaim")
	}
}

func TestAlertStore_MarkResolved(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})
	s.SetActiveClaim("fp1", &models.Claim{ClaimedBy: "bob"})
	s.MarkResolved("fp1")

	got := s.Get()
	if got[0].Status.State != "resolved" {
		t.Errorf("State = %q, want resolved", got[0].Status.State)
	}
	if got[0].ActiveClaim != nil {
		t.Error("ActiveClaim should be cleared after MarkResolved")
	}
}

func TestAlertStore_RemoveByFingerprint(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active"), makeAlert("fp2", "active")})
	s.RemoveByFingerprint("fp1")

	got := s.Get()
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Fingerprint != "fp2" {
		t.Errorf("remaining fingerprint = %q, want fp2", got[0].Fingerprint)
	}
}

func TestAlertStore_ConcurrentAccess(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			_ = s.Get()
		}()
		go func() {
			defer wg.Done()
			s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})
		}()
	}
	wg.Wait()
}
