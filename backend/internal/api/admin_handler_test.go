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
	"github.com/kj187/jarvis/backend/internal/users"
)

func TestListUsers(t *testing.T) {
	srv, store := newAuthServer(t)
	createTestUser(t, store, "alice", "password123456!", "admin")
	createTestUser(t, store, "bob", "password123456!", "user")

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/admin/users", nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	_ = srv.listUsers(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var list []map[string]interface{}
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 2 {
		t.Fatalf("expected 2 users, got %d", len(list))
	}
}

func TestCreateUser_Admin(t *testing.T) {
	srv, _ := newAuthServer(t)
	adminUser := &auth.User{ID: "adm-1", Username: "admin", Role: "admin", Provider: "internal"}

	body, _ := json.Marshal(map[string]string{"username": "newuser", "password": "newpassword1234!", "role": "user"})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/admin/users", bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.Set(auth.ContextKey, adminUser)
	_ = srv.createUser(c)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}
}

func callHandler(t *testing.T, handler func(echo.Context) error, c echo.Context, rec *httptest.ResponseRecorder) {
	t.Helper()
	e := echo.New()
	if err := handler(c); err != nil {
		e.DefaultHTTPErrorHandler(err, c)
	}
	_ = rec
}

func TestUpdateUser_CannotUpdateSelf(t *testing.T) {
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "self", "password123456!", "admin")
	caller := &auth.User{ID: u.ID, Username: "self", Role: "admin", Provider: "internal"}

	body, _ := json.Marshal(map[string]string{"role": "user"})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPatch, "/api/v1/admin/users/"+u.ID, bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(u.ID)
	c.Set(auth.ContextKey, caller)
	callHandler(t, srv.updateUser, c, rec)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestDeleteUser_CannotDeleteSelf(t *testing.T) {
	srv, store := newAuthServer(t)
	u := createTestUser(t, store, "selfdelete", "password123456!", "admin")
	caller := &auth.User{ID: u.ID, Username: "selfdelete", Role: "admin", Provider: "internal"}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/api/v1/admin/users/"+u.ID, nil)
	rec := httptest.NewRecorder()
	e := echo.New()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(u.ID)
	c.Set(auth.ContextKey, caller)
	callHandler(t, srv.deleteUser, c, rec)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestUpdateRole(t *testing.T) {
	srv, store := newAuthServer(t)
	target := createTestUser(t, store, "target", "password123456!", "user")
	admin := createTestUser(t, store, "adminactor", "password123456!", "admin")
	caller := &auth.User{ID: admin.ID, Username: "adminactor", Role: "admin", Provider: "internal"}

	body, _ := json.Marshal(map[string]string{"role": "admin"})
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPatch, "/api/v1/admin/users/"+target.ID, bytes.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(target.ID)
	c.Set(auth.ContextKey, caller)
	_ = srv.updateUser(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	got, _ := store.GetByID(context.Background(), target.ID)
	if got == nil || got.Role != "admin" {
		t.Fatalf("role not updated")
	}
}

func TestDeleteUser(t *testing.T) {
	srv, store := newAuthServer(t)
	target := createTestUser(t, store, "tobedeleted", "password123456!", "user")
	admin := createTestUser(t, store, "admindelete", "password123456!", "admin")
	caller := &auth.User{ID: admin.ID, Username: "admindelete", Role: "admin", Provider: "internal"}

	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/api/v1/admin/users/"+target.ID, nil)
	rec := httptest.NewRecorder()
	c := echo.New().NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(target.ID)
	c.Set(auth.ContextKey, caller)
	_ = srv.deleteUser(c)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	got, _ := store.GetByID(context.Background(), target.ID)
	if got != nil {
		t.Fatal("expected user to be deleted")
	}
}

// TestListUsers uses the createTestUser helper defined in auth_handler_test.go
// since both are in package api.
var _ = (*users.User)(nil) // compile-check import
