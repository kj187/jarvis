package history

import (
	"fmt"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
)

func TestEnrichAlerts_SingleReceiver(t *testing.T) {
	raw := []alertmanager.GettableAlert{
		{
			Fingerprint: "abc123",
			Status:      alertmanager.GettableAlertStatus{State: "active"},
			Labels:      map[string]string{"alertname": "TestAlert"},
			Receivers:   []alertmanager.AMReceiver{{Name: "email-notifications"}},
		},
	}

	got := enrichAlerts(raw, "prod", "http://am.example")
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Labels["@receiver"] != "email-notifications" {
		t.Errorf("@receiver = %q, want email-notifications", got[0].Labels["@receiver"])
	}
	if got[0].ClusterName != "prod" {
		t.Errorf("ClusterName = %q, want prod", got[0].ClusterName)
	}
	if got[0].AlertmanagerURL != "http://am.example" {
		t.Errorf("AlertmanagerURL = %q, want http://am.example", got[0].AlertmanagerURL)
	}
	if len(got[0].Receivers) != 1 || got[0].Receivers[0].Name != "email-notifications" {
		t.Errorf("Receivers = %+v, want [{email-notifications}]", got[0].Receivers)
	}
}

func TestEnrichAlerts_MultipleReceiversJoinedInOrder(t *testing.T) {
	raw := []alertmanager.GettableAlert{
		{
			Fingerprint: "abc123",
			Labels:      map[string]string{"alertname": "TestAlert"},
			Receivers: []alertmanager.AMReceiver{
				{Name: "pagerduty"},
				{Name: "email"},
				{Name: "slack"},
			},
		},
	}

	got := enrichAlerts(raw, "prod", "http://am.example")
	if got[0].Labels["@receiver"] != "pagerduty,email,slack" {
		t.Errorf("@receiver = %q, want pagerduty,email,slack", got[0].Labels["@receiver"])
	}
	if len(got[0].Receivers) != 3 {
		t.Fatalf("len(Receivers) = %d, want 3", len(got[0].Receivers))
	}
	for i, want := range []string{"pagerduty", "email", "slack"} {
		if got[0].Receivers[i].Name != want {
			t.Errorf("Receivers[%d] = %q, want %q", i, got[0].Receivers[i].Name, want)
		}
	}
}

func TestEnrichAlerts_NoReceiverLabelWhenEmpty(t *testing.T) {
	raw := []alertmanager.GettableAlert{
		{
			Fingerprint: "abc123",
			Labels:      map[string]string{"alertname": "TestAlert"},
			Receivers:   []alertmanager.AMReceiver{},
		},
	}

	got := enrichAlerts(raw, "prod", "http://am.example")
	if _, ok := got[0].Labels["@receiver"]; ok {
		t.Errorf("@receiver label should be absent when there are no receivers")
	}
	if len(got[0].Receivers) != 0 {
		t.Errorf("Receivers = %+v, want empty", got[0].Receivers)
	}
}

func TestEnrichAlerts_DoesNotMutateSourceLabels(t *testing.T) {
	srcLabels := map[string]string{"alertname": "TestAlert"}
	raw := []alertmanager.GettableAlert{
		{
			Fingerprint: "abc123",
			Labels:      srcLabels,
			Receivers:   []alertmanager.AMReceiver{{Name: "email"}},
		},
	}

	_ = enrichAlerts(raw, "prod", "http://am.example")
	if _, ok := srcLabels["@receiver"]; ok {
		t.Errorf("enrichAlerts must not mutate the source labels map")
	}
}

func TestEnrichAlerts_PreservesStatusAndTimes(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	raw := []alertmanager.GettableAlert{
		{
			Fingerprint:  "abc123",
			Status:       alertmanager.GettableAlertStatus{State: "suppressed", SilencedBy: []string{"s1"}, InhibitedBy: []string{"i1"}},
			Labels:       map[string]string{"alertname": "TestAlert"},
			Annotations:  map[string]string{"summary": "boom"},
			StartsAt:     now,
			EndsAt:       now.Add(time.Hour),
			UpdatedAt:    now,
			GeneratorURL: "http://gen",
		},
	}

	got := enrichAlerts(raw, "prod", "http://am.example")[0]
	if got.Status.State != "suppressed" {
		t.Errorf("State = %q", got.Status.State)
	}
	if len(got.Status.SilencedBy) != 1 || got.Status.SilencedBy[0] != "s1" {
		t.Errorf("SilencedBy = %+v", got.Status.SilencedBy)
	}
	if len(got.Status.InhibitedBy) != 1 || got.Status.InhibitedBy[0] != "i1" {
		t.Errorf("InhibitedBy = %+v", got.Status.InhibitedBy)
	}
	if !got.StartsAt.Equal(now) || !got.EndsAt.Equal(now.Add(time.Hour)) || !got.UpdatedAt.Equal(now) {
		t.Errorf("time fields not preserved: %+v", got)
	}
	if got.GeneratorURL != "http://gen" {
		t.Errorf("GeneratorURL = %q", got.GeneratorURL)
	}
	if got.Annotations["summary"] != "boom" {
		t.Errorf("Annotations = %+v", got.Annotations)
	}
}

func BenchmarkEnrichAlerts(b *testing.B) {
	raw := make([]alertmanager.GettableAlert, 2000)
	for i := range raw {
		raw[i] = alertmanager.GettableAlert{
			Fingerprint: fmt.Sprintf("fp%05d", i),
			Status:      alertmanager.GettableAlertStatus{State: "active"},
			Labels: map[string]string{
				"alertname": "HighLatency",
				"severity":  "warning",
				"instance":  fmt.Sprintf("host-%d:9100", i),
				"job":       "node",
				"namespace": "monitoring",
			},
			Annotations: map[string]string{"summary": "latency too high"},
			Receivers:   []alertmanager.AMReceiver{{Name: "email"}, {Name: "slack"}},
		}
	}

	b.ReportAllocs()
	b.ResetTimer()
	for n := 0; n < b.N; n++ {
		_ = enrichAlerts(raw, "prod", "http://am.example")
	}
}
