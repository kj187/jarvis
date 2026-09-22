package api

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/fanout"
	"github.com/kj187/jarvis/backend/internal/globalsettings"
	"github.com/kj187/jarvis/backend/internal/history"
	"github.com/kj187/jarvis/backend/internal/metrics"
	"github.com/kj187/jarvis/backend/internal/settings"
	"github.com/kj187/jarvis/backend/internal/users"
	"github.com/kj187/jarvis/backend/internal/ws"
)

// TestListGlobalSettingsSections_EmptyByDefault documents Phase 0's
// deliberate simplification (Sam's scope decision, item 2): no section is
// registered yet, so the admin UI must see an empty list and render its
// empty state, not an error.
func TestListGlobalSettingsSections_EmptyByDefault(t *testing.T) {
	srv, _ := newAuthServer(t)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/admin/settings", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	if err := srv.listGlobalSettingsSections(c); err != nil {
		t.Fatalf("listGlobalSettingsSections: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		Sections []string `json:"sections"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Sections == nil || len(resp.Sections) != 0 {
		t.Fatalf("sections = %v, want empty (not null)", resp.Sections)
	}
}

func TestListGlobalSettingsSections_ListsRegistered(t *testing.T) {
	srv, _ := newAuthServer(t)
	srv.globalSettingsStore.Register("access", nil)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/admin/settings", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	if err := srv.listGlobalSettingsSections(c); err != nil {
		t.Fatalf("listGlobalSettingsSections: %v", err)
	}

	var resp struct {
		Sections []string `json:"sections"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(resp.Sections) != 1 || resp.Sections[0] != "access" {
		t.Fatalf("sections = %v, want [access]", resp.Sections)
	}
}

// TestGetGlobalSetting_UnregisteredSection_404 is the API-level half of
// "an unknown section is a 404" — Phase 0 registers nothing at all.
func TestGetGlobalSetting_UnregisteredSection_404(t *testing.T) {
	srv, _ := newAuthServer(t)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/admin/settings/access", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("section")
	c.SetParamValues("access")
	callHandler(t, srv.getGlobalSetting, c, rec)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestGetGlobalSetting_RegisteredButNeverSet_ReturnsNullValue(t *testing.T) {
	srv, _ := newAuthServer(t)
	srv.globalSettingsStore.Register("access", nil)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/admin/settings/access", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("section")
	c.SetParamValues("access")
	if err := srv.getGlobalSetting(c); err != nil {
		t.Fatalf("getGlobalSetting: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Section string          `json:"section"`
		Value   json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Section != "access" {
		t.Errorf("section = %q, want access", resp.Section)
	}
	if string(resp.Value) != "null" {
		t.Errorf("value = %s, want null", resp.Value)
	}
}

func TestPutGlobalSetting_UnregisteredSection_404(t *testing.T) {
	srv, _ := newAuthServer(t)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/admin/settings/access", strings.NewReader(`{"rules":[]}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("section")
	c.SetParamValues("access")
	callHandler(t, srv.putGlobalSetting, c, rec)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body: %s", rec.Code, rec.Body.String())
	}
}

func TestPutGlobalSetting_ThenGet_RoundTrips(t *testing.T) {
	srv, store := newAuthServer(t)
	srv.globalSettingsStore.Register("access", nil)
	u := createTestUser(t, store, "settings-admin", "password123456!", "admin")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "admin", Provider: "internal"}

	putReq := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/admin/settings/access", strings.NewReader(`{"rules":[]}`))
	putReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	putRec := httptest.NewRecorder()
	putC := echo.New().NewContext(putReq, putRec)
	putC.SetParamNames("section")
	putC.SetParamValues("access")
	putC.Set(auth.ContextKey, caller)
	if err := srv.putGlobalSetting(putC); err != nil {
		t.Fatalf("putGlobalSetting: %v", err)
	}
	if putRec.Code != http.StatusNoContent {
		t.Fatalf("put status = %d, want 204; body: %s", putRec.Code, putRec.Body.String())
	}

	getReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/admin/settings/access", nil)
	getRec := httptest.NewRecorder()
	getC := echo.New().NewContext(getReq, getRec)
	getC.SetParamNames("section")
	getC.SetParamValues("access")
	if err := srv.getGlobalSetting(getC); err != nil {
		t.Fatalf("getGlobalSetting: %v", err)
	}
	var resp struct {
		Value     json.RawMessage `json:"value"`
		UpdatedBy string          `json:"updatedBy"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if string(resp.Value) != `{"rules":[]}` {
		t.Errorf("value = %s, want {\"rules\":[]}", resp.Value)
	}
	if resp.UpdatedBy != "settings-admin" {
		t.Errorf("updatedBy = %q, want settings-admin", resp.UpdatedBy)
	}
}

func TestPutGlobalSetting_RejectsInvalidJSON(t *testing.T) {
	srv, store := newAuthServer(t)
	srv.globalSettingsStore.Register("access", nil)
	u := createTestUser(t, store, "bad-json-admin", "password123456!", "admin")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "admin", Provider: "internal"}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/admin/settings/access", strings.NewReader(`not json`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("section")
	c.SetParamValues("access")
	c.Set(auth.ContextKey, caller)
	callHandler(t, srv.putGlobalSetting, c, rec)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// TestPutGlobalSetting_RejectsNonObjectJSON mirrors settings_handler.go's
// putSettings shape check: valid JSON that is not an object (null, array,
// number, string) must be rejected, not stored. Without this, a stored
// `null` is indistinguishable in GET from "never written" (Get returns
// value: null in both cases), which would give the later "access" section
// an ambiguous contract.
func TestPutGlobalSetting_RejectsNonObjectJSON(t *testing.T) {
	srv, store := newAuthServer(t)
	srv.globalSettingsStore.Register("access", nil)
	u := createTestUser(t, store, "non-object-admin", "password123456!", "admin")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "admin", Provider: "internal"}

	for _, body := range []string{`null`, `[]`, `"x"`, `3`} {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/admin/settings/access", strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		c := echo.New().NewContext(req, rec)
		c.SetParamNames("section")
		c.SetParamValues("access")
		c.Set(auth.ContextKey, caller)
		callHandler(t, srv.putGlobalSetting, c, rec)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, rec.Code)
		}
	}
}

// TestPutGlobalSetting_RejectsFailingValidator confirms a registered
// section's validator gates the write, and that a validation failure
// answers 400 rather than 500 or a silent write — with a fixed message, never
// the validator's own error text (Workflow Rule 5: "Error responses never
// leak internal details" — same house pattern as settings_handler.go).
func TestPutGlobalSetting_RejectsFailingValidator(t *testing.T) {
	srv, store := newAuthServer(t)
	srv.globalSettingsStore.Register("access", func(json.RawMessage) error {
		return errors.New("boom: column xyz constraint violated")
	})
	u := createTestUser(t, store, "invalid-admin", "password123456!", "admin")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "admin", Provider: "internal"}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/admin/settings/access", strings.NewReader(`{}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("section")
	c.SetParamValues("access")
	c.Set(auth.ContextKey, caller)
	callHandler(t, srv.putGlobalSetting, c, rec)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "boom") {
		t.Fatalf("body leaks validator internals: %s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid settings payload") {
		t.Fatalf("body = %s, want fixed message \"invalid settings payload\"", rec.Body.String())
	}
}

// TestAdminSettings_RequireAdmin_RealHTTP drives a real httptest.Server + the
// full router (RequireAdmin middleware wired in router.go, real cookie-based
// auth — same style as TestGetSettings_RealHTTPRoundTrip) to confirm a
// non-admin caller is rejected and an admin caller is accepted. The unit
// tests above call the handlers directly and bypass the middleware group
// entirely, so they cannot catch a missing route registration or a forgotten
// RequireAdmin.
func TestAdminSettings_RequireAdmin_RealHTTP(t *testing.T) {
	database, dialect, err := idb.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := idb.Migrate(database, dialect); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	auth.SetSecretKey(testSecretKey)

	userStore := users.NewStore(database, dialect)
	settingsStore := settings.NewStore(database, dialect)
	globalSettingsStore := globalsettings.NewStore(database, dialect)
	globalSettingsStore.Register("access", nil)
	provider := auth.NewInternalProvider(userStore)
	alertStore := &history.AlertStore{}
	store := history.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("admin-settings-test"))
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{AuthProvider: "internal", SecretKey: testSecretKey}

	e := NewRouter(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, embed.FS{}, &fakeTriggerer{}, provider, userStore, settingsStore, globalSettingsStore, metrics.New("admin-settings-test"), fanout.NoopFanout{})
	ts := httptest.NewServer(e)
	defer ts.Close()

	ctx := context.Background()

	// First user via /setup becomes admin (existing internal-mode contract).
	setupBody, _ := json.Marshal(map[string]string{"username": "admin-caller", "password": "password123456!"})
	setupReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/setup", bytes.NewReader(setupBody))
	setupReq.Header.Set("Content-Type", "application/json")
	setupResp, err := http.DefaultClient.Do(setupReq)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	_ = setupResp.Body.Close()
	if setupResp.StatusCode != http.StatusOK {
		t.Fatalf("setup status = %d", setupResp.StatusCode)
	}

	adminJar, _ := cookiejar.New(nil)
	adminClient := &http.Client{Jar: adminJar}
	loginBody, _ := json.Marshal(map[string]string{"username": "admin-caller", "password": "password123456!"})
	loginReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginResp, err := adminClient.Do(loginReq)
	if err != nil {
		t.Fatalf("admin login: %v", err)
	}
	_ = loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("admin login status = %d", loginResp.StatusCode)
	}

	putReq, _ := http.NewRequestWithContext(ctx, http.MethodPut, ts.URL+"/api/v1/admin/settings/access", bytes.NewReader([]byte(`{"rules":[]}`)))
	putReq.Header.Set("Content-Type", "application/json")
	putResp, err := adminClient.Do(putReq)
	if err != nil {
		t.Fatalf("admin put: %v", err)
	}
	_ = putResp.Body.Close()
	if putResp.StatusCode != http.StatusNoContent {
		t.Fatalf("admin put status = %d, want 204", putResp.StatusCode)
	}

	// A plain user, created via the now-admin's own admin API, must be
	// rejected by RequireAdmin.
	createBody, _ := json.Marshal(map[string]string{"username": "plain-user", "password": "password123456!", "role": "user"})
	createReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/api/v1/admin/users", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createResp, err := adminClient.Do(createReq)
	if err != nil {
		t.Fatalf("create plain user: %v", err)
	}
	_ = createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("create plain user status = %d", createResp.StatusCode)
	}

	plainJar, _ := cookiejar.New(nil)
	plainClient := &http.Client{Jar: plainJar}
	plainLoginBody, _ := json.Marshal(map[string]string{"username": "plain-user", "password": "password123456!"})
	plainLoginReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/auth/login", bytes.NewReader(plainLoginBody))
	plainLoginReq.Header.Set("Content-Type", "application/json")
	plainLoginResp, err := plainClient.Do(plainLoginReq)
	if err != nil {
		t.Fatalf("plain login: %v", err)
	}
	_ = plainLoginResp.Body.Close()
	if plainLoginResp.StatusCode != http.StatusOK {
		t.Fatalf("plain login status = %d", plainLoginResp.StatusCode)
	}

	plainGetReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/admin/settings/access", nil)
	plainGetResp, err := plainClient.Do(plainGetReq)
	if err != nil {
		t.Fatalf("plain get: %v", err)
	}
	_ = plainGetResp.Body.Close()
	if plainGetResp.StatusCode != http.StatusForbidden {
		t.Fatalf("plain get status = %d, want 403", plainGetResp.StatusCode)
	}
}
