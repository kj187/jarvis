package cluster

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/config"
)

func alertsServer(t *testing.T, alerts []alertmanager.GettableAlert) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v2/alerts":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(alerts)
		case "/api/v2/silences":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]alertmanager.GettableSilence{})
		case "/api/v2/status":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(alertmanager.AMStatus{Status: "ready"})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func downServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func twoMemberCluster(name string, urls ...string) *Cluster {
	members := make([]config.MemberConfig, len(urls))
	for i, u := range urls {
		members[i] = config.MemberConfig{Name: config.DeriveMemberName(u), URL: u, LinkURL: u}
	}
	return buildCluster(config.ClusterConfig{Name: name, Members: members})
}

// countingServer serves the standard alerts/silences endpoints but answers
// the first `failures` requests to failPath with failStatus. The returned
// func reports how many requests a path has received — used to assert the
// exact number of fetch attempts (retry-once semantics).
func countingServer(t *testing.T, failPath string, failStatus, failures int, alerts []alertmanager.GettableAlert) (*httptest.Server, func(string) int) {
	t.Helper()
	var mu sync.Mutex
	counts := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		counts[r.URL.Path]++
		n := counts[r.URL.Path]
		mu.Unlock()
		if r.URL.Path == failPath && n <= failures {
			http.Error(w, "transient", failStatus)
			return
		}
		switch r.URL.Path {
		case "/api/v2/alerts":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(alerts)
		case "/api/v2/silences":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]alertmanager.GettableSilence{})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	requests := func(path string) int { mu.Lock(); defer mu.Unlock(); return counts[path] }
	return srv, requests
}

func TestFetchAlerts_TransientMemberError_RetriedOnce(t *testing.T) {
	srv, requests := countingServer(t, "/api/v2/alerts", http.StatusServiceUnavailable, 1,
		[]alertmanager.GettableAlert{{Fingerprint: "fp1"}})
	cl := twoMemberCluster("prod", srv.URL)

	alerts, err := cl.FetchAlerts(context.Background(), nil)
	if err != nil {
		t.Fatalf("FetchAlerts: %v (a single transient 5xx must be absorbed by the retry)", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("len(alerts) = %d, want 1", len(alerts))
	}
	if got := requests("/api/v2/alerts"); got != 2 {
		t.Errorf("alert requests = %d, want 2 (initial + one retry)", got)
	}
	if !cl.MemberUpStates()[config.DeriveMemberName(srv.URL)] {
		t.Error("member must be marked up after the retry succeeded")
	}
}

func TestFetchSilences_TransientMemberError_RetriedOnce(t *testing.T) {
	srv, requests := countingServer(t, "/api/v2/silences", http.StatusServiceUnavailable, 1, nil)
	cl := twoMemberCluster("prod", srv.URL)

	if _, err := cl.FetchSilences(context.Background(), nil); err != nil {
		t.Fatalf("FetchSilences: %v (a single transient 5xx must be absorbed by the retry)", err)
	}
	if got := requests("/api/v2/silences"); got != 2 {
		t.Errorf("silence requests = %d, want 2 (initial + one retry)", got)
	}
}

func TestFetchAlerts_PersistentMemberError_ExactlyOneRetry(t *testing.T) {
	srv, requests := countingServer(t, "/api/v2/alerts", http.StatusInternalServerError, 1000, nil)
	cl := twoMemberCluster("prod", srv.URL)

	if _, err := cl.FetchAlerts(context.Background(), nil); err == nil {
		t.Fatal("expected error when the member keeps failing")
	}
	if got := requests("/api/v2/alerts"); got != 2 {
		t.Errorf("alert requests = %d, want 2 (retry capped at one)", got)
	}
}

func TestFetchAlerts_4xxNotRetried(t *testing.T) {
	srv, requests := countingServer(t, "/api/v2/alerts", http.StatusForbidden, 1000, nil)
	cl := twoMemberCluster("prod", srv.URL)

	if _, err := cl.FetchAlerts(context.Background(), nil); err == nil {
		t.Fatal("expected error on a 4xx response")
	}
	if got := requests("/api/v2/alerts"); got != 1 {
		t.Errorf("alert requests = %d, want 1 (4xx is a definitive answer, not retryable)", got)
	}
}

func TestFetchAlerts_MemberDown_OtherMemberStillServesAlerts(t *testing.T) {
	up := alertsServer(t, []alertmanager.GettableAlert{{Fingerprint: "fp1", Status: alertmanager.GettableAlertStatus{State: "active"}}})
	down := downServer(t)

	cl := twoMemberCluster("prod", up.URL, down.URL)
	alerts, err := cl.FetchAlerts(context.Background(), nil)
	if err != nil {
		t.Fatalf("FetchAlerts: %v (must not fail when only one member is down)", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("len(alerts) = %d, want 1", len(alerts))
	}

	upStates := cl.MemberUpStates()
	if !upStates[config.DeriveMemberName(up.URL)] {
		t.Error("up member must be marked up")
	}
	if upStates[config.DeriveMemberName(down.URL)] {
		t.Error("down member must be marked down")
	}
}

func TestFetchAlerts_AllMembersDown_ReturnsError(t *testing.T) {
	down1 := downServer(t)
	down2 := downServer(t)

	cl := twoMemberCluster("prod", down1.URL, down2.URL)
	_, err := cl.FetchAlerts(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error when all members are down")
	}
}

func TestFetchAlerts_SingleMember_NoSeenOn(t *testing.T) {
	srv := alertsServer(t, []alertmanager.GettableAlert{{Fingerprint: "fp1"}})
	cl := twoMemberCluster("dev", srv.URL)

	alerts, err := cl.FetchAlerts(context.Background(), nil)
	if err != nil {
		t.Fatalf("FetchAlerts: %v", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("len(alerts) = %d, want 1", len(alerts))
	}
	if alerts[0].SeenOn != nil {
		t.Errorf("SeenOn = %v, want nil for single-member cluster (byte-identical payload guarantee)", alerts[0].SeenOn)
	}
}

func TestFetchAlerts_MultiMember_SeenOnPopulated(t *testing.T) {
	srv1 := alertsServer(t, []alertmanager.GettableAlert{{Fingerprint: "fp1"}})
	srv2 := alertsServer(t, []alertmanager.GettableAlert{{Fingerprint: "fp1"}})
	cl := twoMemberCluster("prod", srv1.URL, srv2.URL)

	alerts, err := cl.FetchAlerts(context.Background(), nil)
	if err != nil {
		t.Fatalf("FetchAlerts: %v", err)
	}
	if len(alerts) != 1 {
		t.Fatalf("len(alerts) = %d, want 1 (deduplicated)", len(alerts))
	}
	if len(alerts[0].SeenOn) != 2 {
		t.Errorf("SeenOn = %v, want 2 members", alerts[0].SeenOn)
	}
}

func TestFetchAlerts_ObservesPerMemberDuration(t *testing.T) {
	srv1 := alertsServer(t, nil)
	srv2 := alertsServer(t, nil)
	cl := twoMemberCluster("prod", srv1.URL, srv2.URL)

	var mu sync.Mutex
	observed := make(map[string]bool)
	_, err := cl.FetchAlerts(context.Background(), func(member string, seconds float64) {
		mu.Lock()
		observed[member] = true
		mu.Unlock()
	})
	if err != nil {
		t.Fatalf("FetchAlerts: %v", err)
	}
	if len(observed) != 2 {
		t.Errorf("observed durations for %d members, want 2: %v", len(observed), observed)
	}
}

func TestFetchSilences_MergesAcrossMembers(t *testing.T) {
	srv1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]alertmanager.GettableSilence{{ID: "s1"}})
	}))
	defer srv1.Close()
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]alertmanager.GettableSilence{{ID: "s2"}})
	}))
	defer srv2.Close()

	cl := twoMemberCluster("prod", srv1.URL, srv2.URL)
	silences, err := cl.FetchSilences(context.Background(), nil)
	if err != nil {
		t.Fatalf("FetchSilences: %v", err)
	}
	if len(silences) != 2 {
		t.Fatalf("len(silences) = %d, want 2", len(silences))
	}
}

func TestFetchSilences_AllMembersDown_ReturnsError(t *testing.T) {
	down1 := downServer(t)
	down2 := downServer(t)
	cl := twoMemberCluster("prod", down1.URL, down2.URL)

	_, err := cl.FetchSilences(context.Background(), nil)
	if err == nil {
		t.Fatal("expected error when all members are down")
	}
}

func TestCreateSilence_FirstMemberSucceeds(t *testing.T) {
	var hit string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = r.Host
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(alertmanager.PostSilenceResponse{SilenceID: "new-id"})
	}))
	defer srv.Close()
	down := downServer(t)

	cl := twoMemberCluster("prod", srv.URL, down.URL)
	id, err := cl.CreateSilence(context.Background(), alertmanager.PostableSilence{Comment: "x"})
	if err != nil {
		t.Fatalf("CreateSilence: %v", err)
	}
	if id != "new-id" {
		t.Errorf("id = %q, want new-id", id)
	}
	if hit == "" {
		t.Error("expected the healthy member to receive the request")
	}
}

func TestCreateSilence_FirstMemberDown_RetriesSecondMember(t *testing.T) {
	down := downServer(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(alertmanager.PostSilenceResponse{SilenceID: "new-id"})
	}))
	defer srv.Close()

	cl := twoMemberCluster("prod", down.URL, srv.URL)
	id, err := cl.CreateSilence(context.Background(), alertmanager.PostableSilence{Comment: "x"})
	if err != nil {
		t.Fatalf("CreateSilence: %v (must retry against the next member on transport failure)", err)
	}
	if id != "new-id" {
		t.Errorf("id = %q, want new-id", id)
	}
}

func TestCreateSilence_AllMembersDown_ReturnsError(t *testing.T) {
	down1 := downServer(t)
	down2 := downServer(t)
	cl := twoMemberCluster("prod", down1.URL, down2.URL)

	_, err := cl.CreateSilence(context.Background(), alertmanager.PostableSilence{Comment: "x"})
	if err == nil {
		t.Fatal("expected error when all members are down")
	}
}

func TestCreateSilence_PrefersKnownHealthyMemberFirst(t *testing.T) {
	// Prime the cluster's cached health state: member 1 down, member 2 up.
	down := downServer(t)
	var hit bool
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hit = true
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/api/v2/alerts" {
			_ = json.NewEncoder(w).Encode([]alertmanager.GettableAlert{})
			return
		}
		_ = json.NewEncoder(w).Encode(alertmanager.PostSilenceResponse{SilenceID: "id"})
	}))
	defer up.Close()

	cl := twoMemberCluster("prod", down.URL, up.URL)
	if _, err := cl.FetchAlerts(context.Background(), nil); err != nil {
		t.Fatalf("priming FetchAlerts: %v", err)
	}

	hit = false
	if _, err := cl.CreateSilence(context.Background(), alertmanager.PostableSilence{}); err != nil {
		t.Fatalf("CreateSilence: %v", err)
	}
	if !hit {
		t.Error("expected the known-healthy member (2nd in config order) to be tried first")
	}
}

func TestDeleteSilence_FirstMemberDown_RetriesSecondMember(t *testing.T) {
	down := downServer(t)
	var deleted bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deleted = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cl := twoMemberCluster("prod", down.URL, srv.URL)
	if err := cl.DeleteSilence(context.Background(), "id1"); err != nil {
		t.Fatalf("DeleteSilence: %v", err)
	}
	if !deleted {
		t.Error("expected the next member to receive the delete")
	}
}

func TestDeleteSilence_AllMembersDown_ReturnsError(t *testing.T) {
	down1 := downServer(t)
	down2 := downServer(t)
	cl := twoMemberCluster("prod", down1.URL, down2.URL)

	if err := cl.DeleteSilence(context.Background(), "id1"); err == nil {
		t.Fatal("expected error when all members are down")
	}
}

// badRequestServer returns a 4xx like Alertmanager's own validation rejection.
func badRequestServer(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "invalid matcher", http.StatusBadRequest)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestCreateSilence_FirstMember4xx_DoesNotRetrySecondMember(t *testing.T) {
	rejecting := badRequestServer(t)
	secondCalled := false
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secondCalled = true
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(alertmanager.PostSilenceResponse{SilenceID: "new-id"})
	}))
	defer second.Close()

	cl := twoMemberCluster("prod", rejecting.URL, second.URL)
	_, err := cl.CreateSilence(context.Background(), alertmanager.PostableSilence{Comment: "x"})
	if err == nil {
		t.Fatal("expected the 4xx to be returned, not retried away")
	}
	var amErr *alertmanager.AMError
	if !errors.As(err, &amErr) || amErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected an AMError with status 400, got: %v", err)
	}
	if secondCalled {
		t.Error("second member must not be called after a 4xx from the first — Alertmanager already rejected the request on its merits")
	}
}

func TestDeleteSilence_FirstMember4xx_DoesNotRetrySecondMember(t *testing.T) {
	rejecting := badRequestServer(t)
	secondCalled := false
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secondCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer second.Close()

	cl := twoMemberCluster("prod", rejecting.URL, second.URL)
	err := cl.DeleteSilence(context.Background(), "id1")
	if err == nil {
		t.Fatal("expected the 4xx to be returned, not retried away")
	}
	if secondCalled {
		t.Error("second member must not be called after a 4xx from the first")
	}
}
