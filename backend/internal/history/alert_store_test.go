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

// TestAlertStore_MarkResolved_SurvivesSet reproduces the bug: resolved alert must
// still appear in Get() after a subsequent Set() with only active alerts.
func TestAlertStore_MarkResolved_SurvivesSet(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active"), makeAlert("fp2", "active")})
	s.MarkResolved("fp1")

	// Simulate next poll: fp1 gone, fp2 still active.
	s.Set([]models.EnrichedAlert{makeAlert("fp2", "active")})

	got := s.Get()
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2 (1 active + 1 resolved)", len(got))
	}
	byFP := make(map[string]models.EnrichedAlert, len(got))
	for _, a := range got {
		byFP[a.Fingerprint] = a
	}
	if byFP["fp1"].Status.State != "resolved" {
		t.Errorf("fp1 state = %q, want resolved", byFP["fp1"].Status.State)
	}
	if byFP["fp2"].Status.State != "active" {
		t.Errorf("fp2 state = %q, want active", byFP["fp2"].Status.State)
	}
}

// TestAlertStore_MarkResolved_RemovedWhenActiveAgain: if a resolved alert comes
// back as active in Set(), it must no longer appear as resolved.
func TestAlertStore_MarkResolved_RemovedWhenActiveAgain(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})
	s.MarkResolved("fp1")

	// Alert comes back.
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	got := s.Get()
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Status.State != "active" {
		t.Errorf("state = %q, want active", got[0].Status.State)
	}
}

// TestAlertStore_RemoveByFingerprint_FromBuffer: RemoveByFingerprint must also
// remove from the resolved buffer (called after the 20-min window).
func TestAlertStore_RemoveByFingerprint_FromBuffer(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active"), makeAlert("fp2", "active")})
	s.MarkResolved("fp1")
	s.Set([]models.EnrichedAlert{makeAlert("fp2", "active")})
	s.RemoveByFingerprint("fp1")

	got := s.Get()
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Fingerprint != "fp2" {
		t.Errorf("fingerprint = %q, want fp2", got[0].Fingerprint)
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
