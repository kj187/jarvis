package ws

import (
	"fmt"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

func benchmarkAlerts(count int) []models.EnrichedAlert {
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

func BenchmarkMemoryBroadcast(b *testing.B) {
	for _, clients := range []int{0, 10} {
		for _, alerts := range []int{2_000, 8_000} {
			b.Run(fmt.Sprintf("clients=%d/alerts=%d", clients, alerts), func(b *testing.B) {
				hub := NewHub(nil, nil, nil)
				for i := 0; i < clients; i++ {
					client := &Client{hub: hub, send: make(chan []byte, clientBuffer)}
					hub.clients[client] = struct{}{}
				}
				go hub.Run()
				payload := map[string]interface{}{"alerts": benchmarkAlerts(alerts)}
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					hub.BroadcastJSON(models.WSTypeAlertsUpdate, payload)
				}
			})
		}
	}
}
