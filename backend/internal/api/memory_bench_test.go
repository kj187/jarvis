package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/labstack/echo/v4"
)

type countingResponseWriter struct {
	header http.Header
	status int
	bytes  int64
}

func (w *countingResponseWriter) Header() http.Header {
	if w.header == nil {
		w.header = make(http.Header)
	}
	return w.header
}

func (w *countingResponseWriter) WriteHeader(status int) { w.status = status }

func (w *countingResponseWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.bytes += int64(len(p))
	return len(p), nil
}

func benchmarkLiveAlerts(count int) []models.EnrichedAlert {
	fixedTime := time.Date(2026, 9, 17, 6, 0, 0, 0, time.UTC)
	alerts := make([]models.EnrichedAlert, count)
	for i := range alerts {
		alerts[i] = models.EnrichedAlert{
			Fingerprint: fmt.Sprintf("%016x", i+1),
			Status: models.AlertStatus{
				State:       "active",
				InhibitedBy: []string{},
				SilencedBy:  []string{},
			},
			Labels: map[string]string{
				"alertname": "MemoryBenchmarkAlert",
				"severity":  []string{"critical", "warning", "info", "none"}[i%4],
				"instance":  fmt.Sprintf("instance-%06d", i),
			},
			Annotations:     map[string]string{"summary": "memory benchmark"},
			StartsAt:        fixedTime.Add(-time.Duration(i) * time.Second),
			EndsAt:          fixedTime,
			UpdatedAt:       fixedTime,
			Receivers:       []models.Receiver{{Name: "oncall"}},
			ClusterName:     fmt.Sprintf("cluster-%d", i%4),
			AlertmanagerURL: "http://alertmanager:9093",
		}
	}
	return alerts
}

func BenchmarkMemoryLiveGET(b *testing.B) {
	for _, count := range []int{2_000, 8_000} {
		b.Run(fmt.Sprintf("alerts=%d", count), func(b *testing.B) {
			srv, alertStore := newTestServer(b)
			alertStore.Set(benchmarkLiveAlerts(count))
			e := echo.New()
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts", nil)
				writer := &countingResponseWriter{}
				ctx := e.NewContext(req, writer)
				if err := srv.getAlerts(ctx); err != nil {
					b.Fatalf("getAlerts: %v", err)
				}
				if writer.status != http.StatusOK || writer.bytes == 0 {
					b.Fatalf("response status=%d bytes=%d", writer.status, writer.bytes)
				}
			}
		})
	}
}
