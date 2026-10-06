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
			Issuer:    "jarvis",
			Audience:  jwt.ClaimStrings{"jarvis"},
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

// forgedClaims builds claims that are valid in every respect except the one a
// test overrides.
func forgedClaims(mutate func(*jwt.RegisteredClaims)) jwt.Claims {
	rc := jwt.RegisteredClaims{
		Subject:   "u1",
		Issuer:    "jarvis",
		Audience:  jwt.ClaimStrings{"jarvis"},
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	mutate(&rc)
	return struct {
		jwt.RegisteredClaims
		Name     string `json:"name"`
		Role     string `json:"role"`
		Provider string `json:"provider"`
	}{rc, "mallory", "admin", "internal"}
}

// The parser must accept exactly the tokens CreateToken issues. Each case is a
// token that is signed with the right key (or not signed at all) and still has
// to be refused.
func TestParseToken_RejectsForgedOrIncompleteTokens(t *testing.T) {
	sign := func(m jwt.SigningMethod, c jwt.Claims, key any) string {
		s, err := jwt.NewWithClaims(m, c).SignedString(key)
		if err != nil {
			t.Fatalf("sign: %v", err)
		}
		return s
	}
	noop := func(*jwt.RegisteredClaims) {}

	cases := []struct {
		name  string
		token string
	}{
		{"alg=none", sign(jwt.SigningMethodNone, forgedClaims(noop), jwt.UnsafeAllowNoneSignatureType)},
		{"alg=HS384", sign(jwt.SigningMethodHS384, forgedClaims(noop), testKey)},
		{"alg=HS512", sign(jwt.SigningMethodHS512, forgedClaims(noop), testKey)},
		{"no exp", sign(jwt.SigningMethodHS256, forgedClaims(func(c *jwt.RegisteredClaims) { c.ExpiresAt = nil }), testKey)},
		{"expired", sign(jwt.SigningMethodHS256, forgedClaims(func(c *jwt.RegisteredClaims) { c.ExpiresAt = jwt.NewNumericDate(time.Now().Add(-time.Minute)) }), testKey)},
		{"wrong issuer", sign(jwt.SigningMethodHS256, forgedClaims(func(c *jwt.RegisteredClaims) { c.Issuer = "someone-else" }), testKey)},
		{"no issuer", sign(jwt.SigningMethodHS256, forgedClaims(func(c *jwt.RegisteredClaims) { c.Issuer = "" }), testKey)},
		{"wrong audience", sign(jwt.SigningMethodHS256, forgedClaims(func(c *jwt.RegisteredClaims) { c.Audience = jwt.ClaimStrings{"other-app"} }), testKey)},
		{"no audience", sign(jwt.SigningMethodHS256, forgedClaims(func(c *jwt.RegisteredClaims) { c.Audience = nil }), testKey)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := auth.ParseToken(testKey, tc.token); err == nil {
				t.Error("token was accepted")
			}
		})
	}

	// Control: the same forged shape with every field right is accepted, so the
	// cases above fail because of the one thing they change.
	good := sign(jwt.SigningMethodHS256, forgedClaims(noop), testKey)
	if _, err := auth.ParseToken(testKey, good); err != nil {
		t.Errorf("control token rejected: %v", err)
	}
}

func TestCreateToken_SetsIssuerAndAudience(t *testing.T) {
	tok, err := auth.CreateToken(testKey, &auth.User{ID: "u1", Username: "bob", Role: "user", Provider: "internal"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	var rc jwt.RegisteredClaims
	if _, _, err := jwt.NewParser().ParseUnverified(tok, &rc); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if rc.Issuer != "jarvis" {
		t.Errorf("iss = %q, want jarvis", rc.Issuer)
	}
	if len(rc.Audience) != 1 || rc.Audience[0] != "jarvis" {
		t.Errorf("aud = %v, want [jarvis]", rc.Audience)
	}
}
