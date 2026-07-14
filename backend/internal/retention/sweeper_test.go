package retention

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/config"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// fakeStore records every call made to it (name + cutoff) and returns
// preconfigured results, so tests can assert sweep() call order and
// per-domain cutoffs without a real DB.
type fakeStore struct {
	mu      sync.Mutex
	calls   []string
	cutoffs map[string]time.Time

	commentsN, claimsN, silenceN, detachN, eventsN, orphanN int64
	err                                                     error
}

func (f *fakeStore) record(name string, cutoff time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, name)
	if f.cutoffs == nil {
		f.cutoffs = make(map[string]time.Time)
	}
	f.cutoffs[name] = cutoff
}

func (f *fakeStore) DeleteCommentsBefore(_ context.Context, cutoff time.Time, _ int) (int64, error) {
	f.record("DeleteCommentsBefore", cutoff)
	return f.commentsN, f.err
}

func (f *fakeStore) DeleteReleasedClaimsBefore(_ context.Context, cutoff time.Time, _ int) (int64, error) {
	f.record("DeleteReleasedClaimsBefore", cutoff)
	return f.claimsN, f.err
}

func (f *fakeStore) DeleteSilenceEventsBefore(_ context.Context, cutoff time.Time, _ int) (int64, error) {
	f.record("DeleteSilenceEventsBefore", cutoff)
	return f.silenceN, f.err
}

func (f *fakeStore) DetachCommentsAndClaimsFromSweepableEventsBefore(_ context.Context, cutoff time.Time) (int64, error) {
	f.record("DetachCommentsAndClaimsFromSweepableEventsBefore", cutoff)
	return f.detachN, f.err
}

func (f *fakeStore) DeleteSweepableEventsBefore(_ context.Context, cutoff time.Time, _ int) (int64, error) {
	f.record("DeleteSweepableEventsBefore", cutoff)
	return f.eventsN, f.err
}

func (f *fakeStore) DeleteOrphanFingerprintsBefore(_ context.Context, cutoff time.Time, _ int) (int64, error) {
	f.record("DeleteOrphanFingerprintsBefore", cutoff)
	return f.orphanN, f.err
}

func (f *fakeStore) callNames() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.calls))
	copy(out, f.calls)
	return out
}

func TestSweeper_Start_Disabled_NeverCallsStore(t *testing.T) {
	f := &fakeStore{}
	sw := NewSweeper(f, config.RetentionConfig{}, testLogger(), nil, nil)

	done := make(chan struct{})
	go func() {
		sw.Start(context.Background())
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Start() did not return promptly when retention is disabled")
	}

	if calls := f.callNames(); len(calls) != 0 {
		t.Errorf("store calls = %v, want none", calls)
	}
}

func TestSweeper_Start_ContextCancelStopsBeforeFirstSweep(t *testing.T) {
	f := &fakeStore{}
	cfg := config.RetentionConfig{Days: 30, SweepInterval: time.Hour}
	sw := NewSweeper(f, cfg, testLogger(), nil, nil)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		sw.Start(ctx)
		close(done)
	}()

	cancel()

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Start() did not return promptly after context cancellation")
	}

	if calls := f.callNames(); len(calls) != 0 {
		t.Errorf("store calls = %v, want none (cancelled before the first sweep)", calls)
	}
}

func TestSweeper_Sweep_FullOrderAndCutoffs(t *testing.T) {
	f := &fakeStore{}
	cfg := config.RetentionConfig{
		EventsDays:        90,
		ClaimsDays:        30,
		SilenceEventsDays: 60,
		CommentsDays:      180,
	}
	sw := NewSweeper(f, cfg, testLogger(), nil, nil)

	sw.sweep(context.Background())

	wantOrder := []string{
		"DeleteCommentsBefore",
		"DeleteReleasedClaimsBefore",
		"DeleteSilenceEventsBefore",
		"DetachCommentsAndClaimsFromSweepableEventsBefore",
		"DeleteSweepableEventsBefore",
		"DeleteOrphanFingerprintsBefore",
	}
	gotOrder := f.callNames()
	if len(gotOrder) != len(wantOrder) {
		t.Fatalf("calls = %v, want %v", gotOrder, wantOrder)
	}
	for i, name := range wantOrder {
		if gotOrder[i] != name {
			t.Errorf("call[%d] = %q, want %q (order: %v)", i, gotOrder[i], name, gotOrder)
		}
	}

	// Orphan sweep must use the widest configured retention (180d, comments).
	now := time.Now().UTC()
	orphanCutoff := f.cutoffs["DeleteOrphanFingerprintsBefore"]
	wantOrphanCutoff := now.AddDate(0, 0, -180)
	if diff := wantOrphanCutoff.Sub(orphanCutoff); diff < -time.Minute || diff > time.Minute {
		t.Errorf("orphan cutoff = %v, want ~%v (widest = comments 180d)", orphanCutoff, wantOrphanCutoff)
	}

	eventsCutoff := f.cutoffs["DeleteSweepableEventsBefore"]
	wantEventsCutoff := now.AddDate(0, 0, -90)
	if diff := wantEventsCutoff.Sub(eventsCutoff); diff < -time.Minute || diff > time.Minute {
		t.Errorf("events cutoff = %v, want ~%v", eventsCutoff, wantEventsCutoff)
	}
}

func TestSweeper_Sweep_SkipsDisabledDomains(t *testing.T) {
	f := &fakeStore{}
	// Only comments retention explicitly enabled; global + all other
	// domains disabled.
	cfg := config.RetentionConfig{CommentsDays: 180}
	sw := NewSweeper(f, cfg, testLogger(), nil, nil)

	sw.sweep(context.Background())

	wantOrder := []string{
		"DeleteCommentsBefore",
		"DeleteOrphanFingerprintsBefore", // widest effective retention is comments' 180d
	}
	gotOrder := f.callNames()
	if len(gotOrder) != len(wantOrder) {
		t.Fatalf("calls = %v, want %v", gotOrder, wantOrder)
	}
	for i, name := range wantOrder {
		if gotOrder[i] != name {
			t.Errorf("call[%d] = %q, want %q (order: %v)", i, gotOrder[i], name, gotOrder)
		}
	}
}

func TestSweeper_Sweep_ErrorInOneDomainDoesNotAbortOthers(t *testing.T) {
	f := &fakeStore{err: errors.New("boom")}
	cfg := config.RetentionConfig{Days: 30}
	sw := NewSweeper(f, cfg, testLogger(), nil, nil)

	sw.sweep(context.Background())

	wantOrder := []string{
		"DeleteReleasedClaimsBefore",
		"DeleteSilenceEventsBefore",
		"DetachCommentsAndClaimsFromSweepableEventsBefore",
		"DeleteSweepableEventsBefore",
		"DeleteOrphanFingerprintsBefore",
	}
	gotOrder := f.callNames()
	if len(gotOrder) != len(wantOrder) {
		t.Fatalf("calls = %v, want %v (a single domain's error must not abort the rest)", gotOrder, wantOrder)
	}
}

func TestSweeper_Sweep_MetricsCounted(t *testing.T) {
	f := &fakeStore{
		claimsN:  2,
		silenceN: 3,
		eventsN:  5,
		orphanN:  1,
	}
	cfg := config.RetentionConfig{Days: 30}
	m := metrics.New("test")
	sw := NewSweeper(f, cfg, testLogger(), m, nil)

	sw.sweep(context.Background())

	if got := testutil.ToFloat64(m.RetentionSweepsTotal); got != 1 {
		t.Errorf("RetentionSweepsTotal = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.RetentionDeletedRowsTotal.WithLabelValues("alert_claims")); got != 2 {
		t.Errorf("RetentionDeletedRowsTotal{alert_claims} = %v, want 2", got)
	}
	if got := testutil.ToFloat64(m.RetentionDeletedRowsTotal.WithLabelValues("silence_events")); got != 3 {
		t.Errorf("RetentionDeletedRowsTotal{silence_events} = %v, want 3", got)
	}
	if got := testutil.ToFloat64(m.RetentionDeletedRowsTotal.WithLabelValues("alert_events")); got != 5 {
		t.Errorf("RetentionDeletedRowsTotal{alert_events} = %v, want 5", got)
	}
	if got := testutil.ToFloat64(m.RetentionDeletedRowsTotal.WithLabelValues("alert_fingerprints")); got != 1 {
		t.Errorf("RetentionDeletedRowsTotal{alert_fingerprints} = %v, want 1", got)
	}
	if got := testutil.CollectAndCount(m.RetentionSweepDuration); got != 1 {
		t.Errorf("RetentionSweepDuration sample count = %d, want 1", got)
	}
}

func TestSweeper_NilMetrics_DoesNotPanic(t *testing.T) {
	f := &fakeStore{eventsN: 1}
	cfg := config.RetentionConfig{Days: 30}
	sw := NewSweeper(f, cfg, testLogger(), nil, nil)

	sw.sweep(context.Background()) // must not panic with m == nil
}

// fakeLeaderChecker is a test double for leaderChecker (D3 step 4: the
// retention sweeper is a leader-only side effect).
type fakeLeaderChecker struct{ leader bool }

func (f fakeLeaderChecker) IsLeader() bool { return f.leader }

func TestSweeper_ShouldSweep_GatedByElector(t *testing.T) {
	sw := NewSweeper(&fakeStore{}, config.RetentionConfig{}, testLogger(), nil, nil)
	if !sw.shouldSweep() {
		t.Error("nil elector must always sweep (SQLite / no leader election configured)")
	}

	sw.elector = fakeLeaderChecker{leader: false}
	if sw.shouldSweep() {
		t.Error("a follower must not sweep")
	}

	sw.elector = fakeLeaderChecker{leader: true}
	if !sw.shouldSweep() {
		t.Error("the leader must sweep")
	}
}
