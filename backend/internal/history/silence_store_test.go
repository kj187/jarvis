package history

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
)

func makeSilence(id, state string) alertmanager.GettableSilence {
	now := time.Now().UTC()
	return alertmanager.GettableSilence{
		ID:        id,
		Matchers:  []alertmanager.AMSilenceMatcher{{Name: "alertname", Value: "Test", IsEqual: true}},
		StartsAt:  now,
		EndsAt:    now.Add(time.Hour),
		CreatedBy: "alice",
		Comment:   "test",
		Status:    alertmanager.AMSilenceStatus{State: state},
		UpdatedAt: now,
	}
}

func TestSilenceStore_SetGet(t *testing.T) {
	s := NewSilenceStore()
	s.Set("a", []alertmanager.GettableSilence{makeSilence("s1", "active")})
	s.Set("b", []alertmanager.GettableSilence{makeSilence("s2", "active"), makeSilence("s3", "pending")})

	got := s.Get()
	if len(got) != 2 {
		t.Fatalf("clusters = %d, want 2", len(got))
	}
	if len(got["a"]) != 1 || got["a"][0].ID != "s1" {
		t.Errorf("cluster a = %+v, want [s1]", got["a"])
	}
	if len(got["b"]) != 2 {
		t.Errorf("cluster b len = %d, want 2", len(got["b"]))
	}

	// Set replaces wholesale.
	s.Set("b", []alertmanager.GettableSilence{makeSilence("s4", "active")})
	if got := s.GetCluster("b"); len(got) != 1 || got[0].ID != "s4" {
		t.Errorf("after replace, cluster b = %+v, want [s4]", got)
	}
}

func TestSilenceStore_GetReturnsCopies(t *testing.T) {
	s := NewSilenceStore()
	s.Set("a", []alertmanager.GettableSilence{makeSilence("s1", "active")})

	// Mutating the returned snapshot must not affect the store.
	full := s.Get()
	full["a"][0].ID = "mutated"
	full["extra"] = nil

	single := s.GetCluster("a")
	single[0].Status.State = "expired"

	if got := s.GetCluster("a"); got[0].ID != "s1" || got[0].Status.State != "active" {
		t.Errorf("store mutated through returned copy: %+v", got[0])
	}
	if _, ok := s.Get()["extra"]; ok {
		t.Error("store map mutated through returned copy")
	}
	if s.GetCluster("unknown") != nil {
		t.Error("GetCluster(unknown) != nil")
	}
}

func TestSilenceStore_Upsert(t *testing.T) {
	s := NewSilenceStore()

	// Insert into empty/unknown cluster.
	s.Upsert("a", makeSilence("s1", "active"))
	if got := s.GetCluster("a"); len(got) != 1 || got[0].ID != "s1" {
		t.Fatalf("after insert: %+v, want [s1]", got)
	}

	// Append a second silence.
	s.Upsert("a", makeSilence("s2", "pending"))
	if got := s.GetCluster("a"); len(got) != 2 {
		t.Fatalf("after append: len = %d, want 2", len(got))
	}

	// Replace existing ID in place.
	updated := makeSilence("s1", "active")
	updated.Comment = "updated comment"
	s.Upsert("a", updated)
	got := s.GetCluster("a")
	if len(got) != 2 {
		t.Fatalf("after replace: len = %d, want 2", len(got))
	}
	for _, sil := range got {
		if sil.ID == "s1" && sil.Comment != "updated comment" {
			t.Errorf("s1 not replaced: %+v", sil)
		}
	}
}

func TestSilenceStore_MarkExpired(t *testing.T) {
	s := NewSilenceStore()
	s.Set("a", []alertmanager.GettableSilence{makeSilence("s1", "active")})

	before := time.Now().UTC()
	s.MarkExpired("a", "s1")
	got := s.GetCluster("a")[0]
	if got.Status.State != "expired" {
		t.Errorf("state = %q, want expired", got.Status.State)
	}
	if got.EndsAt.Before(before) || got.EndsAt.After(time.Now().UTC().Add(time.Second)) {
		t.Errorf("EndsAt = %v, want ~now", got.EndsAt)
	}

	// Unknown ID and unknown cluster are no-ops.
	s.MarkExpired("a", "missing")
	s.MarkExpired("nope", "s1")
	if len(s.GetCluster("a")) != 1 {
		t.Error("no-op MarkExpired changed snapshot size")
	}
}

func TestSilenceStore_Reset(t *testing.T) {
	s := NewSilenceStore()
	s.Set("a", []alertmanager.GettableSilence{makeSilence("s1", "active")})
	s.Reset()
	if len(s.Get()) != 0 {
		t.Error("Reset did not clear the store")
	}
}

func TestSilenceStore_ConcurrentAccess(t *testing.T) {
	s := NewSilenceStore()
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(4)
		go func(i int) {
			defer wg.Done()
			s.Set("a", []alertmanager.GettableSilence{makeSilence(fmt.Sprintf("s%d", i), "active")})
		}(i)
		go func(i int) {
			defer wg.Done()
			s.Upsert("a", makeSilence(fmt.Sprintf("u%d", i), "pending"))
		}(i)
		go func(i int) {
			defer wg.Done()
			s.MarkExpired("a", fmt.Sprintf("s%d", i))
		}(i)
		go func() {
			defer wg.Done()
			_ = s.Get()
			_ = s.GetCluster("a")
		}()
	}
	wg.Wait()
}
