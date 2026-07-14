package leader

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type patchRequest struct {
	method      string
	path        string
	contentType string
	auth        string
	body        string
}

func newPatchRecordingServer(t *testing.T) (*httptest.Server, *[]patchRequest) {
	t.Helper()
	var requests []patchRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, patchRequest{
			method:      r.Method,
			path:        r.URL.Path,
			contentType: r.Header.Get("Content-Type"),
			auth:        r.Header.Get("Authorization"),
			body:        string(body),
		})
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, &requests
}

func TestPodLabeler_Promotion_PatchesAddLabel(t *testing.T) {
	srv, requests := newPatchRecordingServer(t)
	p := &PodLabeler{
		client: srv.Client(), apiServer: srv.URL, token: "tok-123",
		namespace: "default", podName: "jarvis-0", logger: testLogger(), enabled: true,
	}

	p.OnLeadershipChange(true)

	if len(*requests) != 1 {
		t.Fatalf("expected 1 PATCH request, got %d", len(*requests))
	}
	req := (*requests)[0]
	if req.method != http.MethodPatch {
		t.Errorf("method = %q, want PATCH", req.method)
	}
	if req.path != "/api/v1/namespaces/default/pods/jarvis-0" {
		t.Errorf("path = %q, want /api/v1/namespaces/default/pods/jarvis-0", req.path)
	}
	if req.contentType != "application/merge-patch+json" {
		t.Errorf("Content-Type = %q, want application/merge-patch+json", req.contentType)
	}
	if req.auth != "Bearer tok-123" {
		t.Errorf("Authorization = %q, want Bearer tok-123", req.auth)
	}
	if !strings.Contains(req.body, `"jarvis.kj187.de/role":"leader"`) {
		t.Errorf("body = %s, want it to set jarvis.kj187.de/role=leader", req.body)
	}
}

func TestPodLabeler_StepDownAfterPromotion_PatchesRemoveLabel(t *testing.T) {
	srv, requests := newPatchRecordingServer(t)
	p := &PodLabeler{
		client: srv.Client(), apiServer: srv.URL, token: "tok-123",
		namespace: "default", podName: "jarvis-0", logger: testLogger(), enabled: true,
	}

	p.OnLeadershipChange(true)
	p.OnLeadershipChange(false)

	if len(*requests) != 2 {
		t.Fatalf("expected 2 PATCH requests, got %d", len(*requests))
	}
	if !strings.Contains((*requests)[1].body, `"jarvis.kj187.de/role":null`) {
		t.Errorf("step-down body = %s, want it to null out jarvis.kj187.de/role", (*requests)[1].body)
	}
}

func TestPodLabeler_StepDownWithoutPriorPromotion_DoesNotPatch(t *testing.T) {
	srv, requests := newPatchRecordingServer(t)
	p := &PodLabeler{
		client: srv.Client(), apiServer: srv.URL, token: "tok-123",
		namespace: "default", podName: "jarvis-0", logger: testLogger(), enabled: true,
	}

	// Elector.Subscribe fires immediately with the not-yet-leader initial
	// state — this must not try to remove a label that was never added.
	p.OnLeadershipChange(false)

	if len(*requests) != 0 {
		t.Fatalf("expected no PATCH requests, got %d", len(*requests))
	}
}

func TestPodLabeler_Disabled_NeverPatches(t *testing.T) {
	srv, requests := newPatchRecordingServer(t)
	p := &PodLabeler{client: srv.Client(), apiServer: srv.URL, logger: testLogger(), enabled: false}

	p.OnLeadershipChange(true)
	p.OnLeadershipChange(false)

	if len(*requests) != 0 {
		t.Fatalf("disabled PodLabeler must never PATCH, got %d requests", len(*requests))
	}
}

// TestNewPodLabeler_NoServiceAccountMount_Disabled verifies the primary
// outside-Kubernetes detection signal: without the ServiceAccount token file
// (never present in a normal test/CI environment), NewPodLabeler disables
// itself instead of failing.
func TestNewPodLabeler_NoServiceAccountMount_Disabled(t *testing.T) {
	p := NewPodLabeler(testLogger())
	if p.enabled {
		t.Skip("running with a real ServiceAccount mount present — nothing to assert here")
	}
	// Must still be safe to call.
	p.OnLeadershipChange(true)
	p.OnLeadershipChange(false)
}
