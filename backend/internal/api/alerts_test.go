package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/globalsettings"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/models"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

func newTestServer(t testing.TB) (*Server, *history.AlertStore) {
	srv, alertStore, _, _ := newTestServerFixture(t)
	return srv, alertStore
}

func newTestServerAndDB(t testing.TB) (*Server, *history.AlertStore, *sql.DB) {
	srv, alertStore, _, database := newTestServerFixture(t)
	return srv, alertStore, database
}

func newTestServerFixture(t testing.TB) (*Server, *history.AlertStore, *history.Store, *sql.DB) {
	t.Helper()
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })

	alertStore := &history.AlertStore{}
	store := history.NewStore(database, dialect)
	userStore := users.NewStore(database, dialect)
	settingsStore := settings.NewStore(database, dialect)
	globalSettingsStore := globalsettings.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("test"))
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{}

	return NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, nil, auth.NoneProvider{}, userStore, settingsStore, globalSettingsStore, fanout.NoopFanout{}), alertStore, store, database
}

type boundedWriteRecorder struct {
	header   http.Header
	status   int
	total    int
	maxWrite int
}

func encodedMatchers(count int) string {
	matchers := make([]map[string]string, count)
	for i := range matchers {
		matchers[i] = map[string]string{"name": "label", "operator": "=", "value": "value"}
	}
	data, _ := json.Marshal(matchers)
	return url.QueryEscape(string(data))
}

func encodedMatchersWithValue(count, valueBytes int) string {
	matchers := make([]map[string]string, count)
	for i := range matchers {
		matchers[i] = map[string]string{"name": "label", "operator": "=", "value": strings.Repeat("v", valueBytes)}
	}
	data, _ := json.Marshal(matchers)
	return url.QueryEscape(string(data))
}

func (w *boundedWriteRecorder) Header() http.Header { return w.header }

func (w *boundedWriteRecorder) WriteHeader(status int) { w.status = status }

func (w *boundedWriteRecorder) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	w.total += len(p)
	if len(p) > w.maxWrite {
		w.maxWrite = len(p)
	}
	return len(p), nil
}

func TestGetAlerts_Empty(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

func TestGetAlerts_WithAlerts(t *testing.T) {
	srv, alertStore := newTestServer(t)
	alertStore.Set([]models.EnrichedAlert{
		{Fingerprint: "abc123", Labels: map[string]string{"alertname": "Test", "severity": "critical"}, Status: models.AlertStatus{State: "active"}, ClusterName: "homelab"},
	})

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
	if !contains(rec.Body.String(), "abc123") {
		t.Errorf("expected abc123 in response: %s", rec.Body.String())
	}
}

func TestGetAlerts_ResolvedFromDB(t *testing.T) {
	srv, _ := newTestServer(t)

	// Seed a resolved alert in the DB.
	if err := srv.store.UpsertFingerprint("aabbccddeeff0011", "DBAlert", "homelab", map[string]string{"alertname": "DBAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := srv.store.RecordStatusChange("aabbccddeeff0011", "homelab", "http://am:9093", "firing", time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	if err := srv.store.RecordResolved("aabbccddeeff0011", time.Now()); err != nil {
		t.Fatalf("RecordResolved: %v", err)
	}

	// Alert is NOT in the in-memory store — must come from DB.
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.QueryParams().Set("state", "resolved")

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !contains(rec.Body.String(), "aabbccddeeff0011") {
		t.Errorf("expected fingerprint in response: %s", rec.Body.String())
	}
}

func TestGetAlerts_ResolvedFromDB_ExcludesRefired(t *testing.T) {
	srv, _ := newTestServer(t)

	if err := srv.store.UpsertFingerprint("aabbccddeeff0022", "RefiredAlert", "homelab", map[string]string{"alertname": "RefiredAlert"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := srv.store.RecordStatusChange("aabbccddeeff0022", "homelab", "http://am:9093", "firing", time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}
	if err := srv.store.RecordResolved("aabbccddeeff0022", time.Now()); err != nil {
		t.Fatalf("RecordResolved: %v", err)
	}
	// Re-fire
	if _, _, err := srv.store.RecordStatusChange("aabbccddeeff0022", "homelab", "http://am:9093", "firing", time.Now(), nil); err != nil {
		t.Fatalf("RecordStatusChange re-fire: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.QueryParams().Set("state", "resolved")

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if contains(rec.Body.String(), "aabbccddeeff0022") {
		t.Errorf("re-fired alert should not appear in resolved: %s", rec.Body.String())
	}
}

func TestGetAlerts_ResolvedStreamsJSONAndFilters(t *testing.T) {
	srv, _, _ := newTestServerAndDB(t)
	now := time.Now().UTC()
	for i, tc := range []struct {
		fingerprint string
		cluster     string
		severity    string
	}{
		{"aabbccddeeff0101", "cluster-a", "critical"},
		{"aabbccddeeff0102", "cluster-a", "warning"},
		{"aabbccddeeff0103", "cluster-b", "critical"},
	} {
		if err := srv.store.UpsertFingerprint(tc.fingerprint, "Streamed", tc.cluster, map[string]string{
			"alertname": "Streamed", "severity": tc.severity, "@receiver": " primary, secondary ",
		}); err != nil {
			t.Fatalf("UpsertFingerprint: %v", err)
		}
		at := now.Add(time.Duration(i) * time.Second)
		if _, _, err := srv.store.RecordStatusChange(tc.fingerprint, tc.cluster, "http://am", "firing", at, map[string]string{"summary": tc.fingerprint}); err != nil {
			t.Fatalf("RecordStatusChange: %v", err)
		}
		if err := srv.store.RecordResolvedForCluster(tc.fingerprint, tc.cluster, at); err != nil {
			t.Fatalf("RecordResolvedForCluster: %v", err)
		}
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved&cluster=cluster-a&severity=critical", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if got := rec.Header().Get(echo.HeaderContentType); got != resolvedStreamContentType {
		t.Fatalf("Content-Type = %q, want %q", got, resolvedStreamContentType)
	}
	if !strings.HasSuffix(rec.Body.String(), "]\n") {
		t.Fatalf("response does not end in ]\\n: %q", rec.Body.String())
	}
	var alerts []models.EnrichedAlert
	if err := json.Unmarshal(rec.Body.Bytes(), &alerts); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(alerts) != 1 || alerts[0].Fingerprint != "aabbccddeeff0101" {
		t.Fatalf("alerts = %#v, want only cluster-a critical", alerts)
	}
	if got := alerts[0].Receivers; len(got) != 2 || got[0].Name != "primary" || got[1].Name != "secondary" {
		t.Fatalf("receivers = %#v", got)
	}
}

func TestGetAlerts_ResolvedEmptyStream(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if got := rec.Body.String(); got != "[]\n" {
		t.Fatalf("body = %q, want []\\n", got)
	}
}

func TestGetAlerts_ResolvedUsesBoundedResponseBuffer(t *testing.T) {
	srv, _, database := newTestServerAndDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	tx, err := database.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin fixture transaction: %v", err)
	}
	for i := 0; i < 300; i++ {
		fp := fmt.Sprintf("%016x", i+1)
		if _, err := tx.ExecContext(context.Background(), `
			INSERT INTO alert_fingerprints (fingerprint, alertname, cluster_name, first_seen_at, last_seen_at, occurrence_count, labels)
			VALUES (?, 'BoundedStream', 'cluster-a', ?, ?, 1, ?)
		`, fp, now, now, `{"alertname":"BoundedStream","severity":"critical"}`); err != nil {
			_ = tx.Rollback()
			t.Fatalf("insert fingerprint: %v", err)
		}
		if _, err := tx.ExecContext(context.Background(), `
			INSERT INTO alert_events
				(fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
			VALUES (?, 'cluster-a', 'http://am', 'resolved', ?, ?, ?)
		`, fp, now, `{"summary":"bounded response chunk"}`, now); err != nil {
			_ = tx.Rollback()
			t.Fatalf("insert event: %v", err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit fixture transaction: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	writer := &boundedWriteRecorder{header: make(http.Header)}
	c := e.NewContext(req, writer)
	if err := srv.getAlerts(c); err != nil {
		t.Fatalf("getAlerts: %v", err)
	}
	if writer.total <= resolvedStreamBufferSize {
		t.Fatalf("fixture response = %d bytes, want > stream buffer", writer.total)
	}
	if writer.maxWrite > resolvedStreamBufferSize {
		t.Fatalf("largest response write = %d bytes, want <= %d", writer.maxWrite, resolvedStreamBufferSize)
	}
}

func TestGetAlerts_ResolvedErrorBeforeCommitReturns500(t *testing.T) {
	srv, _, database := newTestServerAndDB(t)
	if err := srv.store.UpsertFingerprint("aabbccddeeff0111", "Broken", "cluster-a", map[string]string{"alertname": "Broken"}); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, err := database.ExecContext(context.Background(), `
		INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, recorded_at)
		VALUES (?, ?, ?, 'resolved', ?, ?)
	`, "aabbccddeeff0111", "cluster-a", "http://am", "not-a-time", "also-not-a-time"); err != nil {
		t.Fatalf("insert malformed event: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	err := srv.getAlerts(c)
	if err == nil {
		t.Fatal("getAlerts error = nil, want HTTP 500")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusInternalServerError {
		t.Fatalf("error = %v, want HTTP 500", err)
	}
	if c.Response().Committed || rec.Body.Len() != 0 {
		t.Fatalf("response committed before first row: committed=%v body=%q", c.Response().Committed, rec.Body.String())
	}
}

func TestGetAlerts_ResolvedErrorAfterCommitAbortsStream(t *testing.T) {
	srv, _, database := newTestServerAndDB(t)
	now := time.Now().UTC().Truncate(time.Second)
	for _, tc := range []struct {
		fingerprint string
		startsAt    any
		recordedAt  time.Time
		annotations string
	}{
		{"aabbccddeeff0121", now.Add(-time.Hour), now, `{"summary":"` + strings.Repeat("x", resolvedStreamBufferSize+1024) + `"}`},
		{"aabbccddeeff0122", "not-a-time", now.Add(-time.Second), `{}`},
	} {
		if err := srv.store.UpsertFingerprint(tc.fingerprint, "StreamFailure", "cluster-a", map[string]string{"alertname": "StreamFailure"}); err != nil {
			t.Fatalf("UpsertFingerprint: %v", err)
		}
		if _, err := database.ExecContext(context.Background(), `
			INSERT INTO alert_events
				(fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
			VALUES (?, ?, ?, 'resolved', ?, ?, ?)
		`, tc.fingerprint, "cluster-a", "http://am", tc.startsAt, tc.annotations, tc.recordedAt); err != nil {
			t.Fatalf("insert event: %v", err)
		}
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts?state=resolved", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	defer func() {
		got := recover()
		if got != http.ErrAbortHandler {
			t.Fatalf("panic = %v, want http.ErrAbortHandler", got)
		}
		if !c.Response().Committed {
			t.Fatal("response was not committed before stream abort")
		}
		if strings.HasSuffix(rec.Body.String(), "]\n") {
			t.Fatalf("aborted stream was closed as valid JSON: %q", rec.Body.String())
		}
	}()
	_ = srv.getAlerts(c)
}

func TestGetAlerts_ResolvedErrorAfterCommitAbortsHTTPConnection(t *testing.T) {
	httpServer, database := newTestRouterWithDB(t, nil)
	defer httpServer.Close()
	now := time.Now().UTC().Truncate(time.Second)
	for _, tc := range []struct {
		fingerprint string
		startsAt    any
		recordedAt  time.Time
		annotations string
		labels      string
	}{
		{"aabbccddeeff0131", now.Add(-time.Hour), now, `{"summary":"` + strings.Repeat("x", resolvedStreamBufferSize+1024) + `"}`, `{"alertname":"Committed"}`},
		{"aabbccddeeff0132", "not-a-time", now.Add(-time.Second), `{}`, `{"alertname":"Broken"}`},
	} {
		if _, err := database.ExecContext(context.Background(), `
			INSERT INTO alert_fingerprints (fingerprint, alertname, cluster_name, first_seen_at, last_seen_at, occurrence_count, labels)
			VALUES (?, ?, 'cluster-a', ?, ?, 1, ?)
		`, tc.fingerprint, "StreamFailure", now, now, tc.labels); err != nil {
			t.Fatalf("insert fingerprint: %v", err)
		}
		if _, err := database.ExecContext(context.Background(), `
			INSERT INTO alert_events
				(fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
			VALUES (?, 'cluster-a', 'http://am', 'resolved', ?, ?, ?)
		`, tc.fingerprint, tc.startsAt, tc.annotations, tc.recordedAt); err != nil {
			t.Fatalf("insert event: %v", err)
		}
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, httpServer.URL+"/api/v1/alerts?state=resolved", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET resolved stream: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, readErr := io.ReadAll(resp.Body)
	if readErr == nil {
		t.Fatalf("read error = nil, want aborted HTTP connection; body length=%d", len(body))
	}
	if strings.HasSuffix(string(body), "]\n") {
		t.Fatalf("aborted response was closed as valid JSON: %q", body)
	}
}

func TestParseResolvedPageQuery(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
		wantErr    bool
	}{
		{"defaults", "", 25, 0, false},
		{"allowed page", "limit=50&offset=100", 50, 100, false},
		{"minimum limit", "limit=10", 10, 0, false},
		{"maximum limit", "limit=100", 100, 0, false},
		{"empty limit", "limit=", 0, 0, true},
		{"signed offset", "offset=%2B1", 0, 0, true},
		{"negative offset", "offset=-1", 0, 0, true},
		{"maximum offset", "offset=2147483547", 25, 2147483547, false},
		{"overflow offset", "offset=2147483548", 0, 0, true},
		{"unsupported limit", "limit=20", 0, 0, true},
		{"duplicate", "limit=25&limit=50", 0, 0, true},
		{"unknown", "wat=1", 0, 0, true},
		{"null matchers", "matchers=null", 0, 0, true},
		{"unknown matcher field", `matchers=%5B%7B%22name%22%3A%22a%22%2C%22operator%22%3A%22%3D%22%2C%22value%22%3A%22b%22%2C%22id%22%3A%221%22%7D%5D`, 0, 0, true},
		{"empty matcher operator", "matchers=" + url.QueryEscape(`[{"name":"a","operator":"","value":"b"}]`), 0, 0, true},
		{"matcher name too long", "matchers=" + url.QueryEscape(`[{"name":"`+strings.Repeat("a", 257)+`","operator":"=","value":"b"}]`), 0, 0, true},
		{"maximum matcher name", "matchers=" + url.QueryEscape(`[{"name":"`+strings.Repeat("a", 256)+`","operator":"=","value":"b"}]`), 25, 0, false},
		{"maximum matcher value", "matchers=" + url.QueryEscape(`[{"name":"a","operator":"=","value":"`+strings.Repeat("b", 1024)+`"}]`), 25, 0, false},
		{"matcher value too long", "matchers=" + url.QueryEscape(`[{"name":"a","operator":"=","value":"`+strings.Repeat("b", 1025)+`"}]`), 0, 0, true},
		{"cluster too long", "cluster=" + strings.Repeat("a", 257), 0, 0, true},
		{"severity too long", "severity=" + strings.Repeat("a", 65), 0, 0, true},
		{"search too long", "search=" + strings.Repeat("a", 257), 0, 0, true},
		{"fifty matchers", "matchers=" + encodedMatchers(50), 25, 0, false},
		{"fifty-one matchers", "matchers=" + encodedMatchers(51), 0, 0, true},
		{"decoded matchers too large", "matchers=" + encodedMatchersWithValue(10, 800), 0, 0, true},
		{"fingerprint detail", "fingerprint=aabbccddeeff0011&cluster=prod", 1, 0, false},
		{"empty fingerprint", "fingerprint=", 0, 0, true},
		{"fingerprint rejects limit", "fingerprint=aabbccddeeff0011&limit=25", 0, 0, true},
		{"invalid fingerprint", "fingerprint=ABC", 0, 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/resolved?"+tc.query, nil)
			c := e.NewContext(req, httptest.NewRecorder())
			got, err := parseResolvedPageQuery(c)
			if (err != nil) != tc.wantErr {
				t.Fatalf("parseResolvedPageQuery error = %v, wantErr %v", err, tc.wantErr)
			}
			if err == nil && (got.Limit != tc.wantLimit || got.Offset != tc.wantOffset) {
				t.Fatalf("page = limit %d offset %d, want %d/%d", got.Limit, got.Offset, tc.wantLimit, tc.wantOffset)
			}
		})
	}
}

func TestGetResolvedAlertsPage(t *testing.T) {
	httpServer, database := newTestRouterWithDB(t, nil)
	defer httpServer.Close()
	now := time.Now().UTC().Truncate(time.Second)
	for i, severity := range []string{"critical", "warning"} {
		fp := fmt.Sprintf("aabbccddeeff02%02x", i)
		if _, err := database.ExecContext(context.Background(), `
			INSERT INTO alert_fingerprints (fingerprint, alertname, cluster_name, labels, first_seen_at, last_seen_at, occurrence_count)
			VALUES (?, 'Paged', 'prod', ?, ?, ?, 1)
		`, fp, `{"alertname":"Paged","severity":"`+severity+`"}`, now, now); err != nil {
			t.Fatalf("insert fingerprint: %v", err)
		}
		if _, err := database.ExecContext(context.Background(), `
			INSERT INTO alert_events (fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at)
			VALUES (?, 'prod', 'http://am', 'resolved', ?, '{}', ?)
		`, fp, now.Add(-time.Hour), now.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatalf("insert event: %v", err)
		}
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet,
		httpServer.URL+"/api/v1/alerts/resolved?limit=10&severity=critical", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET resolved page: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var page models.ResolvedAlertsPage
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		t.Fatalf("decode page: %v", err)
	}
	if page.Total != 1 || len(page.Alerts) != 1 || page.Alerts[0].Labels["severity"] != "critical" {
		t.Fatalf("page = %#v", page)
	}
	if page.InvalidMatchers == nil {
		t.Fatal("invalidMatchers = nil, want []")
	}
}

func TestGetResolvedAlertsPage_InvalidQueryIsGeneric400(t *testing.T) {
	httpServer := newTestRouter(t, nil)
	defer httpServer.Close()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet,
		httpServer.URL+"/api/v1/alerts/resolved?limit=20", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET invalid resolved page: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), "invalid resolved alert query") {
		t.Fatalf("status/body = %d %q", resp.StatusCode, body)
	}
}

func TestValidateFingerprint(t *testing.T) {
	valid := []string{
		"1234567890abcdef", // exactly 16 hex chars
		"abcdef1234567890",
		"ffffffffffffffff",
		"0000000000000000",
	}
	invalid := []string{
		"INVALID!",          // non-hex
		"abc123",            // too short
		"1234567890abcdef0", // too long (17 chars)
		"1234567890ABCDEF",  // uppercase rejected
		"",
	}
	for _, fp := range valid {
		if !validateFingerprint(fp) {
			t.Errorf("validateFingerprint(%q) = false, want true", fp)
		}
	}
	for _, fp := range invalid {
		if validateFingerprint(fp) {
			t.Errorf("validateFingerprint(%q) = true, want false", fp)
		}
	}
}

func TestGetAlertHistory_InvalidFingerprint(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/INVALID!/history", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.getAlertHistory(c)
	if err == nil {
		t.Error("expected error for invalid fingerprint, got nil")
	}
}

func TestGetAlertTimeline_InvalidFingerprint(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/INVALID!/timeline", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.getAlertTimeline(c)
	if err == nil {
		t.Error("expected error for invalid fingerprint, got nil")
	}
}

func TestGetAlertHeatmap_InvalidFingerprint(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/INVALID!/heatmap?range=24h", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")
	c.QueryParams().Set("range", "24h")

	err := srv.getAlertHeatmap(c)
	if err == nil {
		t.Error("expected error for invalid fingerprint, got nil")
	}
}

func TestGetAlertHeatmap_InvalidRange(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	fp := "aabbccddeeff0044"
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/"+fp+"/heatmap?range=1y", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)
	c.QueryParams().Set("range", "1y")

	err := srv.getAlertHeatmap(c)
	if err == nil {
		t.Fatal("expected error for invalid range, got nil")
	}
	httpErr, ok := err.(*echo.HTTPError)
	if !ok || httpErr.Code != http.StatusBadRequest {
		t.Errorf("expected 400 HTTPError, got %v", err)
	}
}

func TestGetAlertHeatmap_MissingRange(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	fp := "aabbccddeeff0055"
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/"+fp+"/heatmap", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)

	if err := srv.getAlertHeatmap(c); err == nil {
		t.Error("expected error for missing range, got nil")
	}
}

func TestGetAlertHeatmap_HappyPath(t *testing.T) {
	srv, _ := newTestServer(t)
	fp := "aabbccddeeff0066"
	cluster := "homelab"
	now := time.Now().UTC()

	if err := srv.store.UpsertFingerprint(fp, "TestAlert", cluster, nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := srv.store.RecordStatusChange(fp, cluster, "http://am:9093", "firing", now.Add(-1*time.Hour), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/"+fp+"/heatmap?range=24h&cluster="+cluster, nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)
	c.QueryParams().Set("range", "24h")
	c.QueryParams().Set("cluster", cluster)

	if err := srv.getAlertHeatmap(c); err != nil {
		t.Fatalf("getAlertHeatmap: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if !contains(rec.Body.String(), `"range":"24h"`) {
		t.Errorf("expected range in response: %s", rec.Body.String())
	}
	if !contains(rec.Body.String(), "firingStarts") {
		t.Errorf("expected firingStarts in response: %s", rec.Body.String())
	}
}

func TestGetAlertHeatmap_ClusterScoped(t *testing.T) {
	srv, _ := newTestServer(t)
	fp := "aabbccddeeff0077"
	now := time.Now().UTC()

	if err := srv.store.UpsertFingerprint(fp, "TestAlert", "cluster-a", nil); err != nil {
		t.Fatalf("UpsertFingerprint: %v", err)
	}
	if _, _, err := srv.store.RecordStatusChange(fp, "cluster-a", "http://am:9093", "firing", now.Add(-1*time.Hour), nil); err != nil {
		t.Fatalf("RecordStatusChange: %v", err)
	}

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/alerts/"+fp+"/heatmap?range=24h&cluster=cluster-b", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues(fp)
	c.QueryParams().Set("range", "24h")
	c.QueryParams().Set("cluster", "cluster-b")

	if err := srv.getAlertHeatmap(c); err != nil {
		t.Fatalf("getAlertHeatmap: %v", err)
	}
	if contains(rec.Body.String(), now.Add(-1*time.Hour).Format("2006-01-02T15:04")) {
		t.Errorf("expected no data for wrong cluster, got: %s", rec.Body.String())
	}
}

func TestGetHealth(t *testing.T) {
	srv, _ := newTestServer(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	if err := srv.getHealth(c); err != nil {
		t.Fatalf("getHealth: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d", rec.Code)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsStr(s, substr))
}

func containsStr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
