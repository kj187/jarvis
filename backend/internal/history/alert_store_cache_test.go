package history

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
	"unsafe"

	"github.com/kj187/jarvis/backend/internal/models"
)

// sameBackingArray reports whether two byte slices share the same first
// element address — used to detect whether EncodedSnapshot() rebuilt its
// cache (a fresh backing array) or returned the previously cached one.
func sameBackingArray(a, b []byte) bool {
	if len(a) == 0 || len(b) == 0 {
		return len(a) == len(b)
	}
	return unsafe.SliceData(a) == unsafe.SliceData(b)
}

// TestAlertStore_EncodedSnapshot_MatchesGet verifies EncodedSnapshot() encodes
// exactly what Get() returns, in the same order.
func TestAlertStore_EncodedSnapshot_MatchesGet(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active"), makeAlert("fp2", "active")})

	want, err := json.Marshal(s.Get())
	if err != nil {
		t.Fatalf("marshal Get(): %v", err)
	}
	got, version, err := s.EncodedSnapshot()
	if err != nil {
		t.Fatalf("EncodedSnapshot: %v", err)
	}
	if string(got) != string(want) {
		t.Errorf("EncodedSnapshot = %s, want %s", got, want)
	}
	if version == 0 {
		t.Error("version = 0, want a bumped version after Set")
	}
}

// TestAlertStore_EncodedSnapshot_CachesUntilMutation verifies repeated calls
// without an intervening mutation reuse the same backing array (no rebuild),
// and every mutation that changes Get()'s result invalidates the cache.
func TestAlertStore_EncodedSnapshot_CachesUntilMutation(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	first, v1, err := s.EncodedSnapshot()
	if err != nil {
		t.Fatalf("EncodedSnapshot: %v", err)
	}
	second, v2, err := s.EncodedSnapshot()
	if err != nil {
		t.Fatalf("EncodedSnapshot: %v", err)
	}
	if v1 != v2 || !sameBackingArray(first, second) {
		t.Error("EncodedSnapshot rebuilt without a mutation")
	}

	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active"), makeAlert("fp2", "active")})
	third, v3, err := s.EncodedSnapshot()
	if err != nil {
		t.Fatalf("EncodedSnapshot: %v", err)
	}
	if v3 == v2 || sameBackingArray(second, third) {
		t.Error("EncodedSnapshot did not invalidate its cache after Set")
	}
}

// TestAlertStore_EncodedSnapshot_NoOpMutationsDoNotInvalidateCache verifies
// that mutations which find nothing to change never bump the cache version —
// a no-op SetActiveClaim/ClearActiveClaim/RemoveResolvedForCluster/
// RemoveByFingerprint/ExpireResolved must not force every reader to rebuild.
func TestAlertStore_EncodedSnapshot_NoOpMutationsDoNotInvalidateCache(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})
	_, before, err := s.EncodedSnapshot()
	if err != nil {
		t.Fatalf("EncodedSnapshot: %v", err)
	}

	s.SetActiveClaim("missing-fp", "c", &models.Claim{ClaimedBy: "alice"})
	s.ClearActiveClaim("missing-fp", "c")
	s.RemoveResolvedForCluster("missing-fp", "c")
	s.RemoveByFingerprint("missing-fp")
	if s.ExpireResolved(time.Now().Add(24 * time.Hour)) {
		t.Fatal("ExpireResolved reported a change with an empty resolved buffer")
	}

	_, after, err := s.EncodedSnapshot()
	if err != nil {
		t.Fatalf("EncodedSnapshot: %v", err)
	}
	if after != before {
		t.Errorf("version changed after no-op mutations: %d -> %d", before, after)
	}
}

// TestAlertStore_Set_ClonesInput verifies mutating the caller's slice/maps
// after Set() never affects the store (P4 immutability contract).
func TestAlertStore_Set_ClonesInput(t *testing.T) {
	labels := map[string]string{"severity": "critical"}
	alert := models.EnrichedAlert{
		Fingerprint: "fp1",
		Status:      models.AlertStatus{State: "active", SilencedBy: []string{"sil-1"}},
		Labels:      labels,
		Receivers:   []models.Receiver{{Name: "oncall"}},
	}
	input := []models.EnrichedAlert{alert}

	s := &AlertStore{}
	s.Set(input)

	// Mutate the caller's own copies after handing them to Set().
	labels["severity"] = "tampered"
	input[0].Receivers[0].Name = "tampered"
	input[0].Status.SilencedBy[0] = "tampered"

	got := s.Get()
	if got[0].Labels["severity"] != "critical" {
		t.Errorf("Labels leaked caller mutation: %q", got[0].Labels["severity"])
	}
	if got[0].Receivers[0].Name != "oncall" {
		t.Errorf("Receivers leaked caller mutation: %q", got[0].Receivers[0].Name)
	}
	if got[0].Status.SilencedBy[0] != "sil-1" {
		t.Errorf("Status.SilencedBy leaked caller mutation: %q", got[0].Status.SilencedBy[0])
	}
}

// TestAlertStore_SetActiveClaim_ClonesClaim verifies mutating the caller's
// Claim (including its pointer fields) after SetActiveClaim() never affects
// the store.
func TestAlertStore_SetActiveClaim_ClonesClaim(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	eventID := int64(42)
	releasedAt := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	wantReleasedAt := releasedAt
	claim := &models.Claim{ClaimedBy: "alice", EventID: &eventID, ReleasedAt: &releasedAt}
	s.SetActiveClaim("fp1", "", claim)

	claim.ClaimedBy = "tampered"
	*claim.EventID = 999
	*claim.ReleasedAt = time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC)

	got := s.Get()[0].ActiveClaim
	if got.ClaimedBy != "alice" || *got.EventID != 42 || !got.ReleasedAt.Equal(wantReleasedAt) {
		t.Errorf("ActiveClaim leaked caller mutation: %+v", got)
	}
}

// TestAlertStore_ConcurrentAccess_WithClaimsAndEncodedSnapshot extends the
// existing Set/Get concurrency test with SetActiveClaim/ClearActiveClaim and
// EncodedSnapshot (P4's cache) under -race.
func TestAlertStore_ConcurrentAccess_WithClaimsAndEncodedSnapshot(t *testing.T) {
	s := &AlertStore{}
	s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})

	var wg sync.WaitGroup
	stop := make(chan struct{})
	wg.Add(4)
	go func() {
		defer wg.Done()
		for i := 0; ; i++ {
			select {
			case <-stop:
				return
			default:
			}
			s.Set([]models.EnrichedAlert{makeAlert("fp1", "active")})
		}
	}()
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			s.SetActiveClaim("fp1", "", &models.Claim{ClaimedBy: "alice"})
			s.ClearActiveClaim("fp1", "")
		}
	}()
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.Get()
		}
	}()
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			if _, _, err := s.EncodedSnapshot(); err != nil {
				t.Errorf("EncodedSnapshot: %v", err)
			}
		}
	}()

	time.Sleep(50 * time.Millisecond)
	close(stop)
	wg.Wait()
}
