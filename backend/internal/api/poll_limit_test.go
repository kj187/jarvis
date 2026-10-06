package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

func TestPollGate(t *testing.T) {
	var g pollGate
	t0 := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	const min = 5 * time.Second

	if wait, ok := g.allow(t0, min); !ok || wait != 0 {
		t.Fatalf("first poll = (%v, %v), want allowed", wait, ok)
	}
	if wait, ok := g.allow(t0.Add(time.Second), min); ok || wait != 4*time.Second {
		t.Fatalf("poll after 1s = (%v, %v), want rejected with 4s to wait", wait, ok)
	}
	// A rejected request must not push the window out.
	if _, ok := g.allow(t0.Add(5*time.Second), min); !ok {
		t.Fatal("poll after the interval measured from the last accepted one was rejected")
	}
	if _, ok := g.allow(t0.Add(5*time.Second), 0); !ok {
		t.Fatal("a zero interval must never reject")
	}
}

func postPoll(e *echo.Echo, remoteAddr, xff string) *httptest.ResponseRecorder {
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/poll", nil)
	req.RemoteAddr = remoteAddr
	if xff != "" {
		req.Header.Set(echo.HeaderXForwardedFor, xff)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func setPollMinInterval(t *testing.T, d time.Duration) {
	t.Helper()
	prev := manualPollMinInterval
	manualPollMinInterval = d
	t.Cleanup(func() { manualPollMinInterval = prev })
}

// The interval is global, not per client: rotating the peer address or
// X-Forwarded-For must not buy a second poll.
func TestTriggerPoll_MinimumIntervalIsGlobal(t *testing.T) {
	setPollMinInterval(t, time.Hour)
	e, _ := newTestEchoWithDB(t, nil)

	if rec := postPoll(e, "192.0.2.10:5000", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("first poll = %d, want 204", rec.Code)
	}
	rec := postPoll(e, "198.51.100.7:6000", "203.0.113.9")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second poll inside the interval = %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("429 carries no Retry-After header")
	}
}

func TestTriggerPoll_AllowedAgainAfterInterval(t *testing.T) {
	setPollMinInterval(t, 40*time.Millisecond)
	e, _ := newTestEchoWithDB(t, nil)

	if rec := postPoll(e, "192.0.2.10:5000", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("first poll = %d, want 204", rec.Code)
	}
	time.Sleep(80 * time.Millisecond)
	if rec := postPoll(e, "192.0.2.10:5000", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("poll after the interval = %d, want 204", rec.Code)
	}
}

// A rejected poll must never reach the recorder.
func TestTriggerPoll_RejectedPollDoesNotTrigger(t *testing.T) {
	setPollMinInterval(t, time.Hour)
	f := &fakeTriggerer{}
	srv := &Server{pollTrigger: f}
	e := echo.New()
	for i := 0; i < 3; i++ {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/poll", nil)
		c := e.NewContext(req, httptest.NewRecorder())
		_ = srv.triggerPoll(c)
	}
	if f.calls != 1 {
		t.Fatalf("Trigger called %d times, want 1", f.calls)
	}
}

// From write_protect upward /poll needs a session; an anonymous attempt must
// not use up the interval for a logged-in user.
func TestTriggerPoll_RequiresLoginFromWriteProtect(t *testing.T) {
	setPollMinInterval(t, time.Hour)
	for _, mode := range []string{"write_protect", "full_protect"} {
		t.Run(mode, func(t *testing.T) {
			env := newRevocationEnv(t)
			ts := env.startMode(mode, time.Minute)
			alice := env.addUser("alice", "user")

			if got := do(t, ts, http.MethodPost, "/api/v1/poll", nil); got != http.StatusUnauthorized {
				t.Fatalf("anonymous poll = %d, want 401", got)
			}
			if got := do(t, ts, http.MethodPost, "/api/v1/poll", env.cookie(alice)); got != http.StatusNoContent {
				t.Fatalf("logged-in poll after a rejected anonymous one = %d, want 204", got)
			}
		})
	}
}
