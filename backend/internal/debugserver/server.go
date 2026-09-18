// Package debugserver provides an opt-in, loopback-only pprof server for
// production diagnostics (P0b, tmp/memory.md §9). Disabled unless
// JARVIS_PPROF_ADDR is set. It never touches the main Echo router or
// net/http's DefaultServeMux — a dedicated http.Server with its own
// http.NewServeMux, exposing only heap/allocs/goroutine profiles.
package debugserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/pprof"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 5 * time.Second
	writeTimeout      = 70 * time.Second
	idleTimeout       = 30 * time.Second
	maxHeaderBytes    = 8 << 10

	minSeconds = 1
	maxSeconds = 60
)

// Server is the pprof debug server. Zero value is not usable — construct via
// New.
type Server struct {
	addr     string
	logger   *slog.Logger
	srv      *http.Server
	inFlight int32 // atomic; caps concurrent profile requests at 1
}

// New validates addr and builds a Server bound to it once Start is called.
// addr must be a literal loopback IP plus a numeric port 1..65535 —
// "127.0.0.1:6060" or "[::1]:6060" — never a hostname, wildcard, or an
// address carrying a zone ID. Returns nil, nil when addr is empty: the
// default, off, case — no port is ever opened unless explicitly configured.
func New(addr string, logger *slog.Logger) (*Server, error) {
	if addr == "" {
		return nil, nil
	}
	if err := validateLoopbackAddr(addr); err != nil {
		return nil, err
	}
	s := newServer(logger)
	s.addr = addr
	return s, nil
}

// newServer builds the handler/mux without validating or setting an address
// — used directly by New (after validation) and by tests that serve on an
// already-open ephemeral listener instead of a configured address.
func newServer(logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.New(slog.DiscardHandler)
	}
	s := &Server{logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /debug/pprof/heap", s.wrapProfile(true, pprof.Handler("heap")))
	mux.HandleFunc("GET /debug/pprof/allocs", s.wrapProfile(false, pprof.Handler("allocs")))
	mux.HandleFunc("GET /debug/pprof/goroutine", s.wrapProfile(false, pprof.Handler("goroutine")))
	s.srv = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
		MaxHeaderBytes:    maxHeaderBytes,
	}
	return s
}

// Start binds the configured address and serves until ctx is cancelled. The
// bind itself is synchronous — a startup error (bad port, already in use)
// is returned immediately, matching every other fatal startup check in
// cmd/jarvis/main.go. The serve loop and shutdown run in the background.
func (s *Server) Start(ctx context.Context) error {
	ln, err := (&net.ListenConfig{}).Listen(ctx, "tcp", s.addr)
	if err != nil {
		return fmt.Errorf("pprof listen on %s: %w", s.addr, err)
	}
	s.serveOn(ctx, ln)
	return nil
}

// serveOn runs the server on an already-open listener and stops it when ctx
// is cancelled. Split out from Start so tests can bind an ephemeral port
// (":0") directly, bypassing Start's production address (no port 0).
func (s *Server) serveOn(ctx context.Context, ln net.Listener) {
	go func() {
		if err := s.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			s.logger.Error("pprof server error", "err", err)
		}
	}()
	go func() {
		<-ctx.Done()
		// WithoutCancel: ctx is already Done() here, so deriving the shutdown
		// timeout straight from it would expire immediately instead of giving
		// Shutdown its own 10s grace period.
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		defer cancel()
		_ = s.srv.Shutdown(shutdownCtx)
	}()
}

// wrapProfile enforces one profile request at a time (a semaphore, not a
// queue — a second concurrent request gets 429 immediately) and validates
// the query parameters net/http/pprof itself reads, before delegating to
// handler. allowGC permits the heap-only ?gc= parameter.
func (s *Server) wrapProfile(allowGC bool, handler http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := validateProfileQuery(r.URL.Query(), allowGC); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if !atomic.CompareAndSwapInt32(&s.inFlight, 0, 1) {
			http.Error(w, "a profile request is already in progress", http.StatusTooManyRequests)
			return
		}
		defer atomic.StoreInt32(&s.inFlight, 0)
		handler.ServeHTTP(w, r)
	}
}

// validateProfileQuery rejects the query parameters net/http/pprof's Handler
// reads (seconds, debug, gc) when they're present but out of the bounds we
// support — momentary snapshot when seconds is absent, whole seconds
// 1..60 otherwise; debug 0/1/2; gc (heap only) 0/1.
func validateProfileQuery(q url.Values, allowGC bool) error {
	if raw := q.Get("seconds"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < minSeconds || n > maxSeconds {
			return fmt.Errorf("seconds must be an integer %d..%d", minSeconds, maxSeconds)
		}
	}
	if raw := q.Get("debug"); raw != "" {
		switch raw {
		case "0", "1", "2":
		default:
			return errors.New("debug must be 0, 1, or 2")
		}
	}
	if raw := q.Get("gc"); raw != "" {
		if !allowGC {
			return errors.New("gc is only valid for the heap profile")
		}
		switch raw {
		case "0", "1":
		default:
			return errors.New("gc must be 0 or 1")
		}
	}
	return nil
}

// validateLoopbackAddr rejects anything but a literal loopback IP (no
// hostname, no wildcard, no zone ID) plus a numeric port 1..65535. Port 0
// (bind to an OS-assigned ephemeral port) is deliberately not allowed here —
// that's a test-only convenience via serveOn, never a production setting.
func validateLoopbackAddr(addr string) error {
	host, portRaw, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid JARVIS_PPROF_ADDR %q: %w", addr, err)
	}
	if host == "" {
		return fmt.Errorf("invalid JARVIS_PPROF_ADDR %q: host is required", addr)
	}
	if strings.Contains(host, "%") {
		return fmt.Errorf("invalid JARVIS_PPROF_ADDR %q: zone IDs are not allowed", addr)
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("invalid JARVIS_PPROF_ADDR %q: host must be a literal IP address, not a hostname", addr)
	}
	if !ip.IsLoopback() {
		return fmt.Errorf("invalid JARVIS_PPROF_ADDR %q: host must be a loopback address (127.0.0.1 or ::1)", addr)
	}
	port, err := strconv.Atoi(portRaw)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("invalid JARVIS_PPROF_ADDR %q: port must be an integer 1..65535", addr)
	}
	return nil
}
