package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/kj187/jarvis/backend/internal/auth"
	"github.com/kj187/jarvis/backend/internal/cluster"
	"github.com/kj187/jarvis/backend/internal/config"
	idb "github.com/kj187/jarvis/backend/internal/db"
	"github.com/kj187/jarvis/backend/internal/history"
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
	hub := ws.NewHub(nil, nil)
	go hub.Run()
	registry := cluster.NewRegistry(nil)
	cfg := &config.Config{AuthProvider: "internal"}

	srv := NewServer(alertStore, store, hub, registry, cfg, nil, auth.NewInternalProvider(userStore), userStore)
	return srv, userStore
}

func postSetupReq(t *testing.T, srv *Server, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"username": username, "password": password})
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
