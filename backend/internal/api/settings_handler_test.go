package api

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"reflect"
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

func TestGetSettings_Anonymous(t *testing.T) {
	srv, _ := newAuthServer(t)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/settings", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	if err := srv.getSettings(c); err != nil {
		t.Fatalf("getSettings: %v", err)
	}

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		User   *map[string]interface{} `json:"user"`
		Global map[string]interface{}  `json:"global"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.User != nil {
		t.Fatalf("user = %v, want nil", resp.User)
	}
	if resp.Global == nil || len(resp.Global) != 0 {
		t.Fatalf("global = %v, want {}", resp.Global)
	}
}

func TestGetSettings_GlobalDurationsFromConfig(t *testing.T) {
	srv, _ := newAuthServer(t)
	srv.cfg.SilenceDurations = []int{15, 60, 43200}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/settings", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	if err := srv.getSettings(c); err != nil {
		t.Fatalf("getSettings: %v", err)
	}

	var resp struct {
		Global map[string]interface{} `json:"global"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := map[string]interface{}{
		"silenceDurations": []interface{}{float64(15), float64(60), float64(43200)},
	}
	if !reflect.DeepEqual(resp.Global, want) {
		t.Fatalf("global = %v, want %v", resp.Global, want)
	}
}

func TestPutSettings_Anonymous(t *testing.T) {
	srv, _ := newAuthServer(t)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/settings", strings.NewReader(`{"theme":"light"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	callHandler(t, srv.putSettings, c, rec)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestPutSettings_ThenGet(t *testing.T) {
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "settings-user", "password123456!", "user")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "user", Provider: "internal"}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/settings", strings.NewReader(`{"theme":"light"}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(auth.ContextKey, caller)
	if err := srv.putSettings(c); err != nil {
		t.Fatalf("putSettings: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("put status = %d, want 204; body: %s", rec.Code, rec.Body.String())
	}

	getReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/settings", nil)
	getRec := httptest.NewRecorder()
	getC := echo.New().NewContext(getReq, getRec)
	getC.Set(auth.ContextKey, caller)
	if err := srv.getSettings(getC); err != nil {
		t.Fatalf("getSettings: %v", err)
	}
	var resp struct {
		User map[string]interface{} `json:"user"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.User["theme"] != "light" {
		t.Fatalf("user.theme = %v, want light", resp.User["theme"])
	}
}

func TestPutSettings_RejectsNonObject(t *testing.T) {
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "arr-user", "password123456!", "user")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "user", Provider: "internal"}

	for _, body := range []string{`[1,2,3]`, `not json`, `42`, `null`, `"a string"`} {
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/settings", strings.NewReader(body))
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		c := echo.New().NewContext(req, rec)
		c.Set(auth.ContextKey, caller)
		callHandler(t, srv.putSettings, c, rec)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status = %d, want 400", body, rec.Code)
		}
	}
}

func TestPutSettings_RejectsOversized(t *testing.T) {
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "big-user", "password123456!", "user")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "user", Provider: "internal"}

	huge := `{"pad":"` + strings.Repeat("x", 17*1024) + `"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/settings", strings.NewReader(huge))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(auth.ContextKey, caller)
	callHandler(t, srv.putSettings, c, rec)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPutSettings_AcceptsEmptyObject(t *testing.T) {
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "empty-user", "password123456!", "user")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "user", Provider: "internal"}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/settings", strings.NewReader(`{}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(auth.ContextKey, caller)
	if err := srv.putSettings(c); err != nil {
		t.Fatalf("putSettings: %v", err)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
}

func TestDeleteSettings(t *testing.T) {
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "del-user", "password123456!", "user")
	caller := &auth.User{ID: u.ID, Username: u.Username, Role: "user", Provider: "internal"}

	putReq := httptest.NewRequestWithContext(context.Background(), http.MethodPut, "/api/v1/settings", strings.NewReader(`{"theme":"light"}`))
	putReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	putRec := httptest.NewRecorder()
	putC := echo.New().NewContext(putReq, putRec)
	putC.Set(auth.ContextKey, caller)
	if err := srv.putSettings(putC); err != nil {
		t.Fatalf("putSettings: %v", err)
	}

	delReq := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/api/v1/settings", nil)
	delRec := httptest.NewRecorder()
	delC := echo.New().NewContext(delReq, delRec)
	delC.Set(auth.ContextKey, caller)
	if err := srv.deleteSettings(delC); err != nil {
		t.Fatalf("deleteSettings: %v", err)
	}
	if delRec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", delRec.Code)
	}

	getReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/settings", nil)
	getRec := httptest.NewRecorder()
	getC := echo.New().NewContext(getReq, getRec)
	getC.Set(auth.ContextKey, caller)
	if err := srv.getSettings(getC); err != nil {
		t.Fatalf("getSettings: %v", err)
	}
	var resp struct {
		User *map[string]interface{} `json:"user"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.User != nil {
		t.Fatalf("user = %v, want nil after delete", resp.User)
	}
}

// TestGetSettings_RealHTTPRoundTrip drives GET/PUT through a real
// httptest.Server + the full router (real cookie-based RequireAuth/
// OptionalAuth middleware, not the c.Set(auth.ContextKey, ...) shortcut the
// other tests in this file use). It caught a real bug during development:
// GET /api/v1/settings has no RequireAuth (it must also answer anonymously),
// but without a middleware that at least *tries* to resolve the cookie, the
// handler's auth.UserFromContext(c) was always nil — an authenticated caller
// saw their own PUT silently "disappear" on the very next GET.
func TestGetSettings_RealHTTPRoundTrip(t *testing.T) {
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
	provider := auth.NewInternalProvider(userStore)
	alertStore := &history.AlertStore{}
	store := history.NewStore(database, dialect)
	hub := ws.NewHub(nil, nil, metrics.New("settings-roundtrip-test"))
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{AuthProvider: "internal", SecretKey: testSecretKey}

	e := NewRouter(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, embed.FS{}, &fakeTriggerer{}, provider, userStore, settingsStore, globalSettingsStore, metrics.New("settings-roundtrip-test"), fanout.NoopFanout{})
	ts := httptest.NewServer(e)
	defer ts.Close()

	ctx := context.Background()

	setupBody, _ := json.Marshal(map[string]string{"username": "roundtrip-user", "password": "password123456!"})
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

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	loginBody, _ := json.Marshal(map[string]string{"username": "roundtrip-user", "password": "password123456!"})
	loginReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, ts.URL+"/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginResp, err := client.Do(loginReq)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	_ = loginResp.Body.Close()
	if loginResp.StatusCode != http.StatusOK {
		t.Fatalf("login status = %d", loginResp.StatusCode)
	}

	putReq, _ := http.NewRequestWithContext(ctx, http.MethodPut, ts.URL+"/api/v1/settings", bytes.NewReader([]byte(`{"theme":"light"}`)))
	putReq.Header.Set("Content-Type", "application/json")
	putResp, err := client.Do(putReq)
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	_ = putResp.Body.Close()
	if putResp.StatusCode != http.StatusNoContent {
		t.Fatalf("put status = %d", putResp.StatusCode)
	}

	// Authenticated GET (same cookie jar) must see the just-written row.
	authedGetReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/settings", nil)
	authedGet, err := client.Do(authedGetReq)
	if err != nil {
		t.Fatalf("authed get: %v", err)
	}
	defer func() { _ = authedGet.Body.Close() }()
	var authedBody struct {
		User map[string]interface{} `json:"user"`
	}
	if err := json.NewDecoder(authedGet.Body).Decode(&authedBody); err != nil {
		t.Fatalf("decode authed get: %v", err)
	}
	if authedBody.User["theme"] != "light" {
		t.Fatalf("authenticated GET user.theme = %v, want light (got %+v)", authedBody.User["theme"], authedBody)
	}

	// Anonymous GET (no cookie) must still answer with user: null, not an error.
	anonGetReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/settings", nil)
	anonGet, err := http.DefaultClient.Do(anonGetReq)
	if err != nil {
		t.Fatalf("anon get: %v", err)
	}
	defer func() { _ = anonGet.Body.Close() }()
	var anonBody struct {
		User *map[string]interface{} `json:"user"`
	}
	if err := json.NewDecoder(anonGet.Body).Decode(&anonBody); err != nil {
		t.Fatalf("decode anon get: %v", err)
	}
	if anonBody.User != nil {
		t.Fatalf("anonymous GET user = %v, want nil", anonBody.User)
	}
}
