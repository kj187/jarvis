package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
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

func newSetupServer(t *testing.T) (*Server, *users.Store) {
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
	cfg := &config.Config{AuthProvider: "internal"}

	srv := NewServer(alertStore, history.NewSilenceStore(), store, hub, registry, cfg, nil, auth.NewInternalProvider(userStore), userStore, settingsStore, globalSettingsStore, fanout.NoopFanout{})
	return srv, userStore
}

func postSetupReq(t *testing.T, srv *Server, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	return postSetupReqWithToken(t, srv, username, password, "")
}

func postSetupReqWithToken(t *testing.T, srv *Server, username, password, token string) *httptest.ResponseRecorder {
	t.Helper()
	payload := map[string]string{"username": username, "password": password}
	if token != "" {
		payload["setupToken"] = token
	}
	body, _ := json.Marshal(payload)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/setup", bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	if err := srv.postSetup(c); err != nil {
		e.DefaultHTTPErrorHandler(err, c)
	}
	return rec
}

func TestPostSetup_FirstCall(t *testing.T) {
	srv, _ := newSetupServer(t)
	rec := postSetupReq(t, srv, "admin", "supersecretpassword!")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]bool
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if !resp["ok"] {
		t.Fatal("expected ok=true")
	}
}

func TestPostSetup_SecondCall_Forbidden(t *testing.T) {
	srv, store := newSetupServer(t)
	ctx := context.Background()

	hash, _ := auth.HashPassword("initialpassword123!")
	_, _ = store.Create(ctx, &users.CreateUser{
		Username:     "existing",
		Role:         "admin",
		Provider:     "internal",
		PasswordHash: hash,
	})

	rec := postSetupReq(t, srv, "admin2", "anotherpassword123!")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestPostSetup_ShortPassword(t *testing.T) {
	srv, _ := newSetupServer(t)
	rec := postSetupReq(t, srv, "admin", "short")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPostSetup_InvalidUsername(t *testing.T) {
	srv, _ := newSetupServer(t)
	rec := postSetupReq(t, srv, "a b", "validpassword123!")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestPostSetup_NonInternalMode_NotAvailable(t *testing.T) {
	srv, _ := newSetupServer(t)
	srv.authProvider = auth.NoneProvider{}
	rec := postSetupReq(t, srv, "admin", "supersecretpassword!")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestPostSetup_ConcurrentRequests_CreateExactlyOneAdmin(t *testing.T) {
	srv, store := newSetupServer(t)
	const n = 8
	codes := make([]int, n)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			codes[i] = postSetupReq(t, srv, "admin"+strconv.Itoa(i), "supersecretpassword!").Code
		}(i)
	}
	close(start)
	wg.Wait()

	ok, forbidden := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusOK:
			ok++
		case http.StatusForbidden:
			forbidden++
		default:
			t.Errorf("unexpected status %d", c)
		}
	}
	if ok != 1 || forbidden != n-1 {
		t.Fatalf("200s = %d, 403s = %d, want 1 and %d", ok, forbidden, n-1)
	}
	if got, _ := store.Count(context.Background()); got != 1 {
		t.Fatalf("users = %d, want 1", got)
	}
}

func TestPostSetup_SetupToken(t *testing.T) {
	cases := []struct {
		name      string
		token     string
		wantCode  int
		wantUsers int
	}{
		{"missing token", "", http.StatusUnauthorized, 0},
		{"wrong token", "not-the-token", http.StatusUnauthorized, 0},
		{"correct token", "s3cret-setup-token", http.StatusOK, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, store := newSetupServer(t)
			srv.cfg.SetupToken = "s3cret-setup-token"
			rec := postSetupReqWithToken(t, srv, "admin", "supersecretpassword!", tc.token)
			if rec.Code != tc.wantCode {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, tc.wantCode, rec.Body.String())
			}
			if got, _ := store.Count(context.Background()); got != tc.wantUsers {
				t.Fatalf("users = %d, want %d", got, tc.wantUsers)
			}
		})
	}
}

func TestPostSetup_NoTokenConfigured_IgnoresSuppliedToken(t *testing.T) {
	srv, _ := newSetupServer(t)
	rec := postSetupReqWithToken(t, srv, "admin", "supersecretpassword!", "anything")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestAuthInfo_SetupTokenRequired(t *testing.T) {
	for _, tc := range []struct {
		name  string
		token string
		want  bool
	}{{"token configured", "s3cret-setup-token", true}, {"no token", "", false}} {
		t.Run(tc.name, func(t *testing.T) {
			srv, _ := newSetupServer(t)
			srv.cfg.SetupToken = tc.token
			e := echo.New()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/auth/info", nil)
			rec := httptest.NewRecorder()
			if err := srv.getAuthInfo(e.NewContext(req, rec)); err != nil {
				t.Fatalf("getAuthInfo: %v", err)
			}
			var info map[string]any
			_ = json.Unmarshal(rec.Body.Bytes(), &info)
			if got, _ := info["setupTokenRequired"].(bool); got != tc.want {
				t.Fatalf("setupTokenRequired = %v, want %v (body %s)", got, tc.want, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "s3cret") {
				t.Fatal("auth info leaked the setup token")
			}
		})
	}
}
