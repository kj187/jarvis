package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestGetComments_Empty(t *testing.T) { //nolint:dupl
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")

	if err := srv.getComments(c); err != nil {
		t.Fatalf("getComments: %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != "[]\n" {
		t.Errorf("expected empty array, got %s", rec.Body.String())
	}
}

func TestGetComments_InvalidFingerprint(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.getComments(c)
	if err == nil {
		t.Fatal("expected error for invalid fingerprint")
	}
}

func TestAddComment_HappyPath(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "abc123")
	e := echo.New()

	body := map[string]interface{}{"authorName": "alice", "body": "looks good"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")

	if err := srv.addComment(c); err != nil {
		t.Fatalf("addComment: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Errorf("status = %d, want 201", rec.Code)
	}
	if !contains(rec.Body.String(), "alice") {
		t.Errorf("expected author in response: %s", rec.Body.String())
	}
	if !contains(rec.Body.String(), "looks good") {
		t.Errorf("expected body in response: %s", rec.Body.String())
	}
}

func TestAddComment_InvalidFingerprint(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	body := map[string]interface{}{"authorName": "alice", "body": "test"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("INVALID!")

	err := srv.addComment(c)
	if err == nil {
		t.Fatal("expected error for invalid fingerprint")
	}
}

func TestAddComment_MissingFields(t *testing.T) {
	tests := []struct {
		name string
		body map[string]interface{}
	}{
		{"missing authorName", map[string]interface{}{"body": "no author"}},
		{"missing body", map[string]interface{}{"authorName": "alice"}},
	}
	for _, tt := range tests { //nolint:dupl
		t.Run(tt.name, func(t *testing.T) {
			srv, _, store := newTestServerFull(t)
			seedFP(t, store, "abc123")
			e := echo.New()
			b, _ := json.Marshal(tt.body)
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("fingerprint")
			c.SetParamValues("abc123")

			err := srv.addComment(c)
			if err == nil {
				t.Fatalf("expected error for %s", tt.name)
			}
			he, ok := err.(*echo.HTTPError)
			if !ok || he.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %v", err)
			}
		})
	}
}

func TestAddComment_TooLong(t *testing.T) {
	tests := []struct {
		name string
		body map[string]interface{}
	}{
		{"authorName too long", map[string]interface{}{"authorName": string(make([]rune, 101)), "body": "ok"}},
		{"body too long", map[string]interface{}{"authorName": "alice", "body": string(make([]rune, 10_001))}},
	}
	for _, tt := range tests { //nolint:dupl
		t.Run(tt.name, func(t *testing.T) {
			srv, _, store := newTestServerFull(t)
			seedFP(t, store, "abc123")
			e := echo.New()
			b, _ := json.Marshal(tt.body)
			req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
			req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("fingerprint")
			c.SetParamValues("abc123")

			err := srv.addComment(c)
			if err == nil {
				t.Fatalf("expected error for %s", tt.name)
			}
			he, ok := err.(*echo.HTTPError)
			if !ok || he.Code != http.StatusBadRequest {
				t.Errorf("expected 400, got %v", err)
			}
		})
	}
}

func TestGetComments_AfterAdd(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "abc123")
	e := echo.New()

	body := map[string]interface{}{"authorName": "bob", "body": "checking this"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")
	if err := srv.addComment(c); err != nil {
		t.Fatalf("addComment: %v", err)
	}

	req2 := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
	rec2 := httptest.NewRecorder()
	c2 := e.NewContext(req2, rec2)
	c2.SetParamNames("fingerprint")
	c2.SetParamValues("abc123")
	if err := srv.getComments(c2); err != nil {
		t.Fatalf("getComments: %v", err)
	}
	if !contains(rec2.Body.String(), "bob") {
		t.Errorf("expected bob in comments: %s", rec2.Body.String())
	}
}

func TestDeleteComment_Errors(t *testing.T) {
	tests := []struct {
		name string
		id   string
		want int
	}{
		{"not found", "999", http.StatusNotFound},
		{"invalid id", "notanumber", http.StatusBadRequest},
		{"zero id", "0", http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, _, _ := newTestServerFull(t)
			e := echo.New()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/", nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("fingerprint", "id")
			c.SetParamValues("abc123", tt.id)

			err := srv.deleteComment(c)
			if err == nil {
				t.Fatalf("expected error for %s", tt.name)
			}
			he, ok := err.(*echo.HTTPError)
			if !ok || he.Code != tt.want {
				t.Errorf("expected %d, got %v", tt.want, err)
			}
		})
	}
}

func TestDeleteComment_InvalidFingerprint(t *testing.T) {
	srv, _, _ := newTestServerFull(t)
	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint", "id")
	c.SetParamValues("INVALID!", "1")

	err := srv.deleteComment(c)
	if err == nil {
		t.Fatal("expected error for invalid fingerprint")
	}
}

func TestDeleteComment_HappyPath(t *testing.T) {
	srv, _, store := newTestServerFull(t)
	seedFP(t, store, "abc123")
	e := echo.New()

	// Add a comment first to get a real ID
	body := map[string]interface{}{"authorName": "carol", "body": "to be deleted"}
	b, _ := json.Marshal(body)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fingerprint")
	c.SetParamValues("abc123")
	if err := srv.addComment(c); err != nil {
		t.Fatalf("addComment: %v", err)
	}

	var comment struct {
		ID int64 `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &comment); err != nil {
		t.Fatalf("unmarshal comment: %v", err)
	}

	req2 := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/", nil)
	rec2 := httptest.NewRecorder()
	c2 := e.NewContext(req2, rec2)
	c2.SetParamNames("fingerprint", "id")
	c2.SetParamValues("abc123", fmt.Sprintf("%d", comment.ID))
	if err := srv.deleteComment(c2); err != nil {
		t.Fatalf("deleteComment: %v", err)
	}
	if rec2.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204", rec2.Code)
	}
}
