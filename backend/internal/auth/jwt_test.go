package auth_test

import (
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/kj187/jarvis/backend/internal/auth"
)

var testKey = []byte("aaaabbbbccccddddeeeeffffgggghhhh") // 32 bytes

func TestCreateAndParseToken(t *testing.T) {
	user := &auth.User{
		ID:       "user-1",
		Username: "alice",
		Role:     "admin",
		Provider: "internal",
	}

	tok, err := auth.CreateToken(testKey, user)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if tok == "" {
		t.Fatal("empty token")
	}

	got, err := auth.ParseToken(testKey, tok)
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if got.ID != user.ID {
		t.Fatalf("ID = %q, want %q", got.ID, user.ID)
	}
	if got.Role != "admin" {
		t.Fatalf("role = %q, want admin", got.Role)
	}
}

func TestParseToken_WrongKey(t *testing.T) {
	user := &auth.User{ID: "u1", Username: "bob", Role: "user", Provider: "internal"}
	tok, _ := auth.CreateToken(testKey, user)

	other := []byte("00000000111111112222222233333333")
	_, err := auth.ParseToken(other, tok)
	if err == nil {
		t.Fatal("expected error for wrong key")
	}
}

func TestParseToken_Tampered(t *testing.T) {
	user := &auth.User{ID: "u1", Username: "bob", Role: "user", Provider: "internal"}
	tok, _ := auth.CreateToken(testKey, user)

	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatal("expected 3-part JWT")
	}
	parts[1] = parts[1] + "tampered"
	tampered := strings.Join(parts, ".")
	_, err := auth.ParseToken(testKey, tampered)
	if err == nil {
		t.Fatal("expected error for tampered token")
	}
}

func TestParseToken_Expired(t *testing.T) {
	// Build an already-expired token manually.
	type claims struct {
		jwt.RegisteredClaims
		Name     string `json:"name"`
		Role     string `json:"role"`
		Provider string `json:"provider"`
	}
	past := time.Now().Add(-2 * time.Hour)
	c := claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "u1",
			IssuedAt:  jwt.NewNumericDate(past.Add(-24 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(past),
		},
		Name: "old", Role: "user", Provider: "internal",
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(testKey)

	_, err := auth.ParseToken(testKey, tok)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestParseToken_CarriesTokenVersion(t *testing.T) {
	tok, err := auth.CreateToken(testKey, &auth.User{ID: "u1", Username: "bob", Role: "user", Provider: "internal", TokenVersion: 7})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := auth.ParseToken(testKey, tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.TokenVersion != 7 {
		t.Fatalf("TokenVersion = %d, want 7", got.TokenVersion)
	}
}
