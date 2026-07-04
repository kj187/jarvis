package cluster

import (
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
)

func TestMergeAlerts_UnionSemantics_OnlyOneMemberReports(t *testing.T) {
	byMember := map[string][]alertmanager.GettableAlert{
		"am1:9093": {{Fingerprint: "fp1", Status: alertmanager.GettableAlertStatus{State: "active"}}},
		"am2:9093": {},
	}
	got := mergeAlerts(byMember, []string{"am1:9093", "am2:9093"})
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1 (alert real if ANY member reports it)", len(got))
	}
	if got[0].alert.Fingerprint != "fp1" {
		t.Errorf("Fingerprint = %q", got[0].alert.Fingerprint)
	}
	if len(got[0].seenOn) != 1 || got[0].seenOn[0] != "am1:9093" {
		t.Errorf("SeenOn = %v, want [am1:9093]", got[0].seenOn)
	}
}

func TestMergeAlerts_SameFingerprintOnBothMembers_NewestUpdatedAtWins(t *testing.T) {
	older := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	newer := older.Add(time.Minute)

	byMember := map[string][]alertmanager.GettableAlert{
		"am1:9093": {{Fingerprint: "fp1", Status: alertmanager.GettableAlertStatus{State: "active"}, UpdatedAt: older}},
		"am2:9093": {{Fingerprint: "fp1", Status: alertmanager.GettableAlertStatus{State: "suppressed"}, UpdatedAt: newer}},
	}
	got := mergeAlerts(byMember, []string{"am1:9093", "am2:9093"})
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].alert.Status.State != "suppressed" {
		t.Errorf("State = %q, want suppressed (newer copy must win)", got[0].alert.Status.State)
	}
	if got[0].source != "am2:9093" {
		t.Errorf("source = %q, want am2:9093", got[0].source)
	}
}

func TestMergeAlerts_SeenOnOrderingFollowsConfigOrder(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	byMember := map[string][]alertmanager.GettableAlert{
		"am1:9093": {{Fingerprint: "fp1", UpdatedAt: t0}},
		"am2:9093": {{Fingerprint: "fp1", UpdatedAt: t0}},
		"am3:9093": {{Fingerprint: "fp1", UpdatedAt: t0}},
	}
	got := mergeAlerts(byMember, []string{"am1:9093", "am2:9093", "am3:9093"})
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	want := []string{"am1:9093", "am2:9093", "am3:9093"}
	if len(got[0].seenOn) != len(want) {
		t.Fatalf("SeenOn = %v, want %v", got[0].seenOn, want)
	}
	for i, w := range want {
		if got[0].seenOn[i] != w {
			t.Errorf("SeenOn[%d] = %q, want %q", i, got[0].seenOn[i], w)
		}
	}
}

func TestMergeAlerts_EqualUpdatedAt_FirstInConfigOrderWins(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	byMember := map[string][]alertmanager.GettableAlert{
		"am1:9093": {{Fingerprint: "fp1", Status: alertmanager.GettableAlertStatus{State: "active"}, UpdatedAt: t0}},
		"am2:9093": {{Fingerprint: "fp1", Status: alertmanager.GettableAlertStatus{State: "suppressed"}, UpdatedAt: t0}},
	}
	got := mergeAlerts(byMember, []string{"am1:9093", "am2:9093"})
	if got[0].source != "am1:9093" {
		t.Errorf("source = %q, want am1:9093 (equal timestamp keeps first-seen copy)", got[0].source)
	}
}

func TestMergeAlerts_DistinctFingerprintsAllKept(t *testing.T) {
	byMember := map[string][]alertmanager.GettableAlert{
		"am1:9093": {{Fingerprint: "fp1"}, {Fingerprint: "fp2"}},
		"am2:9093": {{Fingerprint: "fp3"}},
	}
	got := mergeAlerts(byMember, []string{"am1:9093", "am2:9093"})
	if len(got) != 3 {
		t.Fatalf("len = %d, want 3", len(got))
	}
}

func TestMergeAlerts_Empty(t *testing.T) {
	got := mergeAlerts(map[string][]alertmanager.GettableAlert{}, nil)
	if len(got) != 0 {
		t.Errorf("len = %d, want 0", len(got))
	}
}

func TestMergeSilences_UnionByID(t *testing.T) {
	byMember := map[string][]alertmanager.GettableSilence{
		"am1:9093": {{ID: "s1"}},
		"am2:9093": {{ID: "s2"}},
	}
	got := mergeSilences(byMember, []string{"am1:9093", "am2:9093"})
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}
}

func TestMergeSilences_SameID_NewestUpdatedAtWins(t *testing.T) {
	older := time.Date(2026, 1, 1, 10, 0, 0, 0, time.UTC)
	newer := older.Add(time.Minute)
	byMember := map[string][]alertmanager.GettableSilence{
		"am1:9093": {{ID: "s1", Comment: "old", UpdatedAt: older}},
		"am2:9093": {{ID: "s1", Comment: "new", UpdatedAt: newer}},
	}
	got := mergeSilences(byMember, []string{"am1:9093", "am2:9093"})
	if len(got) != 1 {
		t.Fatalf("len = %d, want 1", len(got))
	}
	if got[0].Comment != "new" {
		t.Errorf("Comment = %q, want new (newest UpdatedAt must win)", got[0].Comment)
	}
}
