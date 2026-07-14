package leader

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// Binding Constants (tmp/fable/multi-replica.md D7) — use verbatim, do not rename.
const (
	// PodLabelKey/PodLabelValue: jarvis.kj187.de/role=leader. Informational
	// only — every pod serves all traffic regardless of leadership, this is
	// purely so `kubectl get pods -L jarvis.kj187.de/role` shows who's
	// currently leader.
	PodLabelKey   = "jarvis.kj187.de/role"
	PodLabelValue = "leader"

	// Downward API env vars the chart injects to identify this pod.
	envPodName      = "POD_NAME"
	envPodNamespace = "POD_NAMESPACE"

	serviceAccountDir   = "/var/run/secrets/kubernetes.io/serviceaccount"
	serviceAccountToken = serviceAccountDir + "/token"
	serviceAccountCA    = serviceAccountDir + "/ca.crt"

	podLabelRequestTimeout = 10 * time.Second
)

// PodLabeler labels this pod jarvis.kj187.de/role=leader on promotion and
// removes the label on graceful step-down (D7), via a direct HTTPS call to
// the Kubernetes API server — no client-go. Registered as an
// Elector.Subscribe callback. Outside Kubernetes (compose, bare Docker) —
// detected by the ServiceAccount token mount's absence — every call is a
// no-op. A failed PATCH is logged and never fatal: leadership itself lives
// entirely in the PostgreSQL advisory lock (D2), the label is decoration.
type PodLabeler struct {
	client    *http.Client
	apiServer string
	token     string
	namespace string
	podName   string
	logger    *slog.Logger
	enabled   bool

	// hasLabel tracks whether THIS process added the label, so a step-down
	// before ever being promoted (Subscribe fires immediately with the
	// not-yet-leader initial state — see internal/history's own note on the
	// same Elector behavior) never issues a pointless remove PATCH.
	hasLabel bool
}

// NewPodLabeler builds a PodLabeler using the standard in-cluster
// ServiceAccount mount, the KUBERNETES_SERVICE_HOST/PORT env vars Kubernetes
// injects into every pod, and the Downward API env vars POD_NAME/
// POD_NAMESPACE (the chart sets these — see charts/jarvis/templates/deployment.yaml).
// Disables itself (logging why) if any of these are missing, rather than
// failing startup — the label is optional decoration.
func NewPodLabeler(logger *slog.Logger) *PodLabeler {
	tokenBytes, err := os.ReadFile(serviceAccountToken)
	if err != nil {
		// Expected outside Kubernetes (compose, bare Docker) — not an error.
		return &PodLabeler{logger: logger, enabled: false}
	}
	podName := os.Getenv(envPodName)
	namespace := os.Getenv(envPodNamespace)
	if podName == "" || namespace == "" {
		logger.Warn("leader pod label: disabled — POD_NAME/POD_NAMESPACE not set")
		return &PodLabeler{logger: logger, enabled: false}
	}
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" {
		logger.Warn("leader pod label: disabled — KUBERNETES_SERVICE_HOST/PORT not set")
		return &PodLabeler{logger: logger, enabled: false}
	}
	caCert, err := os.ReadFile(serviceAccountCA)
	if err != nil {
		logger.Warn("leader pod label: disabled — read ServiceAccount CA cert failed", "err", err)
		return &PodLabeler{logger: logger, enabled: false}
	}
	pool := x509.NewCertPool()
	pool.AppendCertsFromPEM(caCert)

	return &PodLabeler{
		client: &http.Client{
			Timeout:   podLabelRequestTimeout,
			Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}},
		},
		apiServer: fmt.Sprintf("https://%s:%s", host, port),
		token:     strings.TrimSpace(string(tokenBytes)),
		namespace: namespace,
		podName:   podName,
		logger:    logger,
		enabled:   true,
	}
}

// OnLeadershipChange is the Elector.Subscribe callback.
func (p *PodLabeler) OnLeadershipChange(isLeader bool) {
	if !p.enabled {
		return
	}
	if isLeader {
		p.patch(fmt.Sprintf(`{"metadata":{"labels":{%q:%q}}}`, PodLabelKey, PodLabelValue))
		p.hasLabel = true
		return
	}
	if !p.hasLabel {
		return
	}
	p.patch(fmt.Sprintf(`{"metadata":{"labels":{%q:null}}}`, PodLabelKey))
	p.hasLabel = false
}

// patch sends a merge-patch (application/merge-patch+json) to this pod's own
// /api/v1/namespaces/<ns>/pods/<name> — a merge patch adds/creates the
// labels map as needed (unlike a JSON Patch "add", which fails if
// metadata.labels doesn't already exist) and removes a key by setting it to
// null, so the same request shape covers both promotion and step-down.
func (p *PodLabeler) patch(body string) {
	url := fmt.Sprintf("%s/api/v1/namespaces/%s/pods/%s", p.apiServer, p.namespace, p.podName)
	ctx, cancel := context.WithTimeout(context.Background(), podLabelRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader([]byte(body)))
	if err != nil {
		p.logger.Error("leader pod label: build request failed", "err", err)
		return
	}
	req.Header.Set("Content-Type", "application/merge-patch+json")
	req.Header.Set("Authorization", "Bearer "+p.token)

	resp, err := p.client.Do(req)
	if err != nil {
		p.logger.Error("leader pod label: PATCH failed", "err", err)
		return
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(resp.Body)
		p.logger.Error("leader pod label: PATCH non-2xx", "status", resp.StatusCode, "body", string(respBody))
	}
}
