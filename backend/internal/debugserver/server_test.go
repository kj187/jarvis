package debugserver

import (
	"context"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.DiscardHandler)
}

func TestNew_EmptyAddrDisabled(t *testing.T) {
	s, err := New("", discardLogger())
	if err != nil {
		t.Fatalf("New(\"\") error = %v, want nil", err)
	}
	if s != nil {
		t.Fatal("New(\"\") returned a non-nil server, want nil (disabled)")
	}
}

func TestNew_RejectsInvalidAddrs(t *testing.T) {
	cases := []string{
		"localhost:6060",         // hostname, not a literal IP
		"0.0.0.0:6060",           // wildcard
		"10.0.0.1:6060",          // non-loopback IP
		"[fe80::1%eth0]:6060",    // zone ID
		"127.0.0.1:0",            // port 0 not allowed in production config
		"127.0.0.1:70000",        // port out of range
		"127.0.0.1",              // missing port
		"127.0.0.1:abc",          // non-numeric port
		"[::1]",                  // missing port, IPv6
		"example.com:6060",       // hostname
	}
	for _, addr := range cases {
		t.Run(addr, func(t *testing.T) {
			if _, err := New(addr, discardLogger()); err == nil {
				t.Errorf("New(%q) = nil error, want a validation error", addr)
			}
		})
	}
}

func TestNew_AcceptsLoopbackAddrs(t *testing.T) {
	cases := []string{"127.0.0.1:6060", "[::1]:6060", "127.0.0.1:1", "127.0.0.1:65535"}
	for _, addr := range cases {
		t.Run(addr, func(t *testing.T) {
			s, err := New(addr, discardLogger())
			if err != nil {
				t.Fatalf("New(%q) error = %v, want nil", addr, err)
			}
			if s == nil {
				t.Fatal("New returned nil server for a valid address")
			}
		})
	}
}

func TestStart_BindFailureIsReturnedSynchronously(t *testing.T) {
	// Occupy a loopback port first so Start's own bind fails.
	ln, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer func() { _ = ln.Close() }()
	addr := ln.Addr().String()

	s, err := New(addr, discardLogger())
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := s.Start(ctx); err == nil {
		t.Fatal("Start on an already-bound port = nil error, want a bind error")
	}
}

// newTestServer builds a Server with an ephemeral loopback listener,
// bypassing New's port-0 restriction (test-only path — serveOn is
// unexported, same package). Returns the base URL and a cancel func that
// stops the server.
func newTestServer(t *testing.T) (baseURL string, cancel context.CancelFunc) {
	t.Helper()
	ln, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := newServer(discardLogger())
	ctx, cancelFn := context.WithCancel(context.Background())
	s.serveOn(ctx, ln)
	t.Cleanup(cancelFn)
	return "http://" + ln.Addr().String(), cancelFn
}

func get(t *testing.T, url string) *http.Response {
	t.Helper()
	resp, err := http.Get(url) //nolint:noctx // test helper, no need for context plumbing
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	// Drain fully: a still-streaming chunked body means the handler (and its
	// deferred semaphore release) may not have returned yet — callers that
	// depend on request N's semaphore release before issuing request N+1
	// (TestServer_ConcurrentProfileRejectedWith429) need that guarantee.
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp
}

func TestServer_HeapAllocsGoroutineReachable(t *testing.T) {
	base, _ := newTestServer(t)
	for _, path := range []string{"/debug/pprof/heap", "/debug/pprof/allocs", "/debug/pprof/goroutine"} {
		t.Run(path, func(t *testing.T) {
			resp := get(t, base+path)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(resp.Body)
				t.Fatalf("%s = %d, want 200: %s", path, resp.StatusCode, body)
			}
		})
	}
}

func TestServer_UnknownAndDisallowedPaths(t *testing.T) {
	base, _ := newTestServer(t)
	cases := []string{
		"/debug/pprof/",
		"/debug/pprof/cmdline",
		"/debug/pprof/profile",
		"/debug/pprof/trace",
		"/debug/pprof/symbol",
		"/debug/pprof/nonexistent",
	}
	for _, path := range cases {
		t.Run(path, func(t *testing.T) {
			resp := get(t, base+path)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != http.StatusNotFound {
				t.Errorf("%s = %d, want 404", path, resp.StatusCode)
			}
		})
	}
}

func TestServer_NonGETMethodNotAllowed(t *testing.T) {
	base, _ := newTestServer(t)
	resp, err := http.Post(base+"/debug/pprof/heap", "text/plain", nil) //nolint:noctx
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /debug/pprof/heap = %d, want 405", resp.StatusCode)
	}
}

func TestServer_SecondsParamValidation(t *testing.T) {
	base, _ := newTestServer(t)
	cases := []struct {
		query string
		want  int
	}{
		{"", http.StatusOK},
		{"?seconds=1", http.StatusOK},
		{"?seconds=60", http.StatusOK},
		{"?seconds=0", http.StatusBadRequest},
		{"?seconds=61", http.StatusBadRequest},
		{"?seconds=-1", http.StatusBadRequest},
		{"?seconds=abc", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.query, func(t *testing.T) {
			if strings.Contains(c.query, "60") {
				t.Skip("60s sample would make the test suite slow; boundary covered by unit-level validateProfileQuery test")
			}
			resp := get(t, base+"/debug/pprof/goroutine"+c.query)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != c.want {
				t.Errorf("goroutine%s = %d, want %d", c.query, resp.StatusCode, c.want)
			}
		})
	}
}

func TestServer_DebugParamValidation(t *testing.T) {
	base, _ := newTestServer(t)
	cases := []struct {
		query string
		want  int
	}{
		{"?debug=0", http.StatusOK},
		{"?debug=1", http.StatusOK},
		{"?debug=2", http.StatusOK},
		{"?debug=3", http.StatusBadRequest},
		{"?debug=abc", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.query, func(t *testing.T) {
			resp := get(t, base+"/debug/pprof/goroutine"+c.query)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != c.want {
				t.Errorf("goroutine%s = %d, want %d", c.query, resp.StatusCode, c.want)
			}
		})
	}
}

func TestServer_GCParamOnlyValidForHeap(t *testing.T) {
	base, _ := newTestServer(t)
	cases := []struct {
		path  string
		query string
		want  int
	}{
		{"/debug/pprof/heap", "?gc=0", http.StatusOK},
		{"/debug/pprof/heap", "?gc=1", http.StatusOK},
		{"/debug/pprof/heap", "?gc=2", http.StatusBadRequest},
		{"/debug/pprof/allocs", "?gc=1", http.StatusBadRequest},
		{"/debug/pprof/goroutine", "?gc=1", http.StatusBadRequest},
	}
	for _, c := range cases {
		t.Run(c.path+c.query, func(t *testing.T) {
			resp := get(t, base+c.path+c.query)
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != c.want {
				t.Errorf("%s%s = %d, want %d", c.path, c.query, resp.StatusCode, c.want)
			}
		})
	}
}

func TestServer_ConcurrentProfileRejectedWith429(t *testing.T) {
	base, _ := newTestServer(t)
	var wg sync.WaitGroup
	statuses := make([]int, 2)
	var startWG sync.WaitGroup
	startWG.Add(1)
	for i := range statuses {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i == 0 {
				startWG.Done()
			} else {
				startWG.Wait()
				// Give the first request a head start so it holds the semaphore.
				time.Sleep(20 * time.Millisecond)
			}
			resp := get(t, base+"/debug/pprof/goroutine?seconds=1")
			defer func() { _ = resp.Body.Close() }()
			statuses[i] = resp.StatusCode
		}(i)
	}
	wg.Wait()

	got429 := false
	for _, s := range statuses {
		if s == http.StatusTooManyRequests {
			got429 = true
		}
	}
	if !got429 {
		t.Errorf("statuses = %v, want at least one 429 (concurrent profile request rejected)", statuses)
	}
}

func TestServer_ShutdownStopsAcceptingConnections(t *testing.T) {
	base, cancel := newTestServer(t)
	resp := get(t, base+"/debug/pprof/goroutine")
	_ = resp.Body.Close()

	cancel()
	// Shutdown runs in its own goroutine on ctx cancellation — poll briefly.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		r, err := http.Get(base + "/debug/pprof/goroutine") //nolint:noctx
		if err != nil {
			return
		}
		_ = r.Body.Close()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("server still accepting connections 2s after context cancellation")
}

func TestValidateLoopbackAddr(t *testing.T) {
	valid := []string{"127.0.0.1:6060", "[::1]:6060", "127.0.0.1:1", "127.0.0.1:65535"}
	for _, addr := range valid {
		if err := validateLoopbackAddr(addr); err != nil {
			t.Errorf("validateLoopbackAddr(%q) = %v, want nil", addr, err)
		}
	}
	invalid := []string{
		"localhost:6060", "0.0.0.0:6060", "10.0.0.1:6060", "[fe80::1%eth0]:6060",
		"127.0.0.1:0", "127.0.0.1:65536", "127.0.0.1:-1", "127.0.0.1", "127.0.0.1:abc",
	}
	for _, addr := range invalid {
		if err := validateLoopbackAddr(addr); err == nil {
			t.Errorf("validateLoopbackAddr(%q) = nil, want an error", addr)
		}
	}
}

func TestValidateProfileQuery(t *testing.T) {
	mustErr := func(t *testing.T, err error, query string) {
		t.Helper()
		if err == nil {
			t.Errorf("validateProfileQuery(%q) = nil, want an error", query)
		}
	}
	mustOK := func(t *testing.T, err error, query string) {
		t.Helper()
		if err != nil {
			t.Errorf("validateProfileQuery(%q) = %v, want nil", query, err)
		}
	}

	for _, q := range []string{"", "seconds=1", "seconds=60", "debug=0", "debug=1", "debug=2"} {
		req, _ := http.NewRequest(http.MethodGet, "http://x/?"+q, nil) //nolint:noctx
		mustOK(t, validateProfileQuery(req.URL.Query(), false), q)
	}
	for _, q := range []string{"seconds=0", "seconds=61", "seconds=-1", "seconds=abc", "debug=3", "debug=abc", "gc=1"} {
		req, _ := http.NewRequest(http.MethodGet, "http://x/?"+q, nil) //nolint:noctx
		mustErr(t, validateProfileQuery(req.URL.Query(), false), q)
	}
	for _, q := range []string{"gc=0", "gc=1"} {
		req, _ := http.NewRequest(http.MethodGet, "http://x/?"+q, nil) //nolint:noctx
		mustOK(t, validateProfileQuery(req.URL.Query(), true), q)
	}
	req, _ := http.NewRequest(http.MethodGet, "http://x/?gc=2", nil) //nolint:noctx
	mustErr(t, validateProfileQuery(req.URL.Query(), true), "gc=2")
}
