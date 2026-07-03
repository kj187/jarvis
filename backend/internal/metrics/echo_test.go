package metrics

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func newTestEcho(m *Metrics) *echo.Echo {
	e := echo.New()
	e.Use(m.EchoMiddleware())
	e.GET("/foo", func(c echo.Context) error { return c.NoContent(http.StatusOK) })
	e.GET("/foo/:id", func(c echo.Context) error { return c.NoContent(http.StatusOK) })
	e.GET("/health", func(c echo.Context) error { return c.NoContent(http.StatusOK) })
	return e
}

func TestEchoMiddleware_NormalRoute(t *testing.T) {
	m := New("test")
	e := newTestEcho(m)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/foo", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if got := testutil.ToFloat64(m.HTTPRequestsTotal.WithLabelValues(http.MethodGet, "/foo", "200")); got != 1 {
		t.Errorf("HTTPRequestsTotal[GET,/foo,200] = %v, want 1", got)
	}
	if n := testutil.CollectAndCount(m.HTTPRequestDuration); n != 1 {
		t.Errorf("HTTPRequestDuration series count = %d, want 1", n)
	}
}

func TestEchoMiddleware_ParamRoute_UsesPatternNotRawPath(t *testing.T) {
	m := New("test")
	e := newTestEcho(m)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/foo/123", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if got := testutil.ToFloat64(m.HTTPRequestsTotal.WithLabelValues(http.MethodGet, "/foo/:id", "200")); got != 1 {
		t.Errorf("HTTPRequestsTotal[GET,/foo/:id,200] = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.HTTPRequestsTotal.WithLabelValues(http.MethodGet, "/foo/123", "200")); got != 0 {
		t.Errorf("raw path /foo/123 must never be used as a label, got %v samples", got)
	}
}

func TestEchoMiddleware_NotFound_LabeledUnmatched(t *testing.T) {
	m := New("test")
	e := newTestEcho(m)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/does-not-exist", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if got := testutil.ToFloat64(m.HTTPRequestsTotal.WithLabelValues(http.MethodGet, "unmatched", "404")); got != 1 {
		t.Errorf("HTTPRequestsTotal[GET,unmatched,404] = %v, want 1", got)
	}
}

func TestEchoMiddleware_SkipsHealthRoute(t *testing.T) {
	m := New("test")
	e := newTestEcho(m)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if n := testutil.CollectAndCount(m.HTTPRequestsTotal); n != 0 {
		t.Errorf("HTTPRequestsTotal series count = %d, want 0 for skipped /health route", n)
	}
}
