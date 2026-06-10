package history

import (
	"context"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

// ── Helpers ────────────────────────────────────────────────────────────────────

func alert(fp, state string) []models.EnrichedAlert {
	return []models.EnrichedAlert{makeEnrichedAlert(fp, state, "homelab")}
}

func noAlerts() []models.EnrichedAlert { return nil }

func assertHistory(t *testing.T, store *Store, fp string, want []string) {
	t.Helper()
	events, total, err := store.GetHistory(fp, 50, 0)
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	got := make([]string, len(events))
	for i, e := range events {
		got[i] = e.Status
	}
	if total != len(want) {
		t.Errorf("history len = %d, want %d\n  got:  %v\n  want: %v", total, len(want), got, want)
		return
	}
	for i, w := range want {
		if events[i].Status != w {
			t.Errorf("events[%d].Status = %q, want %q\n  full: %v", i, events[i].Status, w, got)
		}
	}
}

func assertOccurrence(t *testing.T, store *Store, fp string, want int) {
	t.Helper()
	st, err := store.GetStats(fp)
	if err != nil || st == nil {
		t.Fatalf("GetStats: err=%v st=%v", err, st)
	}
	if st.OccurrenceCount != want {
		t.Errorf("OccurrenceCount = %d, want %d", st.OccurrenceCount, want)
	}
}

// bypassGracePeriod sets the recorded_at of the last resolved row far in the
// past so the next firing poll is treated as a genuine re-occurrence.
// bypassGracePeriod shifts every row for fp back by 90 s using Go time
// arithmetic (SQLite's datetime() cannot parse the RFC3339+Z format stored by
// modernc.org/sqlite). Relative order is preserved, and the most-recent
// resolved row ends up outside the 60 s grace window so the next firing poll
// triggers a genuine re-occurrence.
func bypassGracePeriod(t *testing.T, store *Store, fp string) {
	t.Helper()
	rows, err := store.db.QueryContext(context.Background(),
		`SELECT id, recorded_at FROM alert_events WHERE fingerprint = ? ORDER BY recorded_at ASC`, fp,
	)
	if err != nil {
		t.Fatalf("bypassGracePeriod query: %v", err)
	}
	type entry struct {
		id         int64
		recordedAt time.Time
	}
	var entries []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.id, &e.recordedAt); err != nil {
			_ = rows.Close()
			t.Fatalf("bypassGracePeriod scan: %v", err)
		}
		entries = append(entries, e)
	}
	_ = rows.Close()
	for _, e := range entries {
		if _, err := store.db.ExecContext(context.Background(), `UPDATE alert_events SET recorded_at = ? WHERE id = ?`,
			e.recordedAt.Add(-90*time.Second), e.id); err != nil {
			t.Fatalf("bypassGracePeriod update id=%d: %v", e.id, err)
		}
	}
}

// ── Lifecycle tests ────────────────────────────────────────────────────────────

// TestLifecycle_FiringToResolved covers the simplest path:
// alert fires, then disappears → resolved row appended.
func TestLifecycle_FiringToResolved(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing"})
	assertOccurrence(t, rec.store, "fp1", 1)

	rec.processAlerts(ctx, noAlerts())
	assertHistory(t, rec.store, "fp1", []string{"resolved", "firing"})
	assertOccurrence(t, rec.store, "fp1", 1)
}

// TestLifecycle_SuppressedExpired covers silence lifecycle:
// firing → suppressed → silence expires → firing again.
func TestLifecycle_SuppressedExpired(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing"})

	rec.processAlerts(ctx, alert("fp1", "suppressed"))
	assertHistory(t, rec.store, "fp1", []string{"suppressed", "firing"})

	// First poll after silence expires: prev=suppressed → eventStatus=expired
	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"expired", "suppressed", "firing"})

	// Subsequent polls: prev=active → eventStatus=firing
	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing", "expired", "suppressed", "firing"})

	// No new occurrence — same episode throughout.
	assertOccurrence(t, rec.store, "fp1", 1)
}

// TestLifecycle_GracePeriod verifies that a re-fire within 60 s of a resolved
// row discards the resolved row and returns the prior firing row.
// occurrence_count must NOT be incremented.
func TestLifecycle_GracePeriod(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing"})

	rec.processAlerts(ctx, noAlerts())
	assertHistory(t, rec.store, "fp1", []string{"resolved", "firing"})

	// Re-fire immediately (within grace window).
	rec.processAlerts(ctx, alert("fp1", "active"))

	// Resolved row must be gone; only original firing row remains.
	assertHistory(t, rec.store, "fp1", []string{"firing"})
	assertOccurrence(t, rec.store, "fp1", 1)
}

// TestLifecycle_ReoccurrenceAfterResolution verifies a new firing episode
// after the grace window: resolved row kept, new firing row appended,
// occurrence_count incremented.
func TestLifecycle_ReoccurrenceAfterResolution(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	// First episode.
	rec.processAlerts(ctx, alert("fp1", "active"))
	rec.processAlerts(ctx, noAlerts())
	assertHistory(t, rec.store, "fp1", []string{"resolved", "firing"})
	assertOccurrence(t, rec.store, "fp1", 1)

	bypassGracePeriod(t, rec.store, "fp1")

	// Second episode.
	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing", "resolved", "firing"})
	assertOccurrence(t, rec.store, "fp1", 2)

	// Resolves again.
	rec.processAlerts(ctx, noAlerts())
	assertHistory(t, rec.store, "fp1", []string{"resolved", "firing", "resolved", "firing"})

	bypassGracePeriod(t, rec.store, "fp1")

	// Third episode.
	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing", "resolved", "firing", "resolved", "firing"})
	assertOccurrence(t, rec.store, "fp1", 3)
}

// TestLifecycle_FullCycle is the end-to-end walkthrough:
// fire → suppress → silence expires → resolve → grace re-fire → resolve → reoccurrence.
func TestLifecycle_FullCycle(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	// 1. Alert fires.
	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing"})
	assertOccurrence(t, rec.store, "fp1", 1)

	// 2. Alert gets silenced.
	rec.processAlerts(ctx, alert("fp1", "suppressed"))
	assertHistory(t, rec.store, "fp1", []string{"suppressed", "firing"})

	// 3. Silence expires.
	rec.processAlerts(ctx, alert("fp1", "active")) // expired row
	rec.processAlerts(ctx, alert("fp1", "active")) // firing row
	assertHistory(t, rec.store, "fp1", []string{"firing", "expired", "suppressed", "firing"})
	assertOccurrence(t, rec.store, "fp1", 1)

	// 4. Alert resolves.
	rec.processAlerts(ctx, noAlerts())
	assertHistory(t, rec.store, "fp1", []string{"resolved", "firing", "expired", "suppressed", "firing"})

	// 5. Re-fires within grace window → resolved row deleted.
	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{"firing", "expired", "suppressed", "firing"})
	assertOccurrence(t, rec.store, "fp1", 1)

	// 6. Resolves again (second time).
	rec.processAlerts(ctx, noAlerts())
	bypassGracePeriod(t, rec.store, "fp1")

	// 7. Re-fires outside grace window → new occurrence.
	rec.processAlerts(ctx, alert("fp1", "active"))
	assertHistory(t, rec.store, "fp1", []string{
		"firing",                                    // new episode
		"resolved",                                  // end of first episode
		"firing", "expired", "suppressed", "firing", // first episode
	})
	assertOccurrence(t, rec.store, "fp1", 2)
}

// TestLifecycle_MultipleFingerprints ensures isolation between alerts.
func TestLifecycle_MultipleFingerprints(t *testing.T) {
	rec, _ := newTestRecorder(t)
	ctx := context.Background()

	all := func(states map[string]string) []models.EnrichedAlert {
		var out []models.EnrichedAlert
		for fp, state := range states {
			out = append(out, makeEnrichedAlert(fp, state, "homelab"))
		}
		return out
	}

	rec.processAlerts(ctx, all(map[string]string{"fp1": "active", "fp2": "active"}))
	rec.processAlerts(ctx, all(map[string]string{"fp1": "suppressed", "fp2": "active"}))
	rec.processAlerts(ctx, all(map[string]string{"fp2": "active"})) // fp1 resolved

	assertHistory(t, rec.store, "fp1", []string{"resolved", "suppressed", "firing"})
	assertHistory(t, rec.store, "fp2", []string{"firing"})
	assertOccurrence(t, rec.store, "fp1", 1)
	assertOccurrence(t, rec.store, "fp2", 1)
}
