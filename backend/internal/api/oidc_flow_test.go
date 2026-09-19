package api

import (
	"strings"
	"testing"
)

func TestSanitizeReturnTo(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"root", "/", "/"},
		{"path with query and hash", "/silences?cluster=prod&q=a%20b#x", "/silences?cluster=prod&q=a%20b#x"},
		{"absolute url", "https://evil.example/", ""},
		{"scheme-relative", "//evil.example/", ""},
		{"backslash trick", "/\\evil.example", ""},
		{"embedded backslash", "/a\\b", ""},
		{"no leading slash", "silences", ""},
		{"javascript scheme", "javascript:alert(1)", ""},
		{"newline injection", "/a\r\nSet-Cookie: x=y", ""},
		{"tab", "/a\tb", ""},
		{"auth path", "/auth/oidc/start", ""},
		{"api path", "/api/v1/alerts", ""},
		{"ws path", "/ws", ""},
		{"too long", "/" + strings.Repeat("a", 3000), ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeReturnTo(tt.in); got != tt.want {
				t.Errorf("sanitizeReturnTo(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestOIDCStateRoundTrip(t *testing.T) {
	tests := []struct {
		name       string
		popup      bool
		returnTo   string
		wantTarget string
	}{
		{"plain login lands on root", false, "", "/"},
		{"popup lands on the close page", true, "", "/?login=popup-done"},
		{"return_to lands on the origin page", false, "/silences?x=1", "/silences?x=1"},
		{"popup wins over return_to", true, "/silences", "/?login=popup-done"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw := encodeOIDCState("st", "ver", tt.popup, tt.returnTo)
			state, verifier, target, ok := decodeOIDCState(raw)
			if !ok || state != "st" || verifier != "ver" {
				t.Fatalf("decode(%q) = %q %q %v", raw, state, verifier, ok)
			}
			if target != tt.wantTarget {
				t.Errorf("landing target = %q, want %q", target, tt.wantTarget)
			}
		})
	}
}

func TestDecodeOIDCState_LegacyTwoFieldCookie(t *testing.T) {
	// Cookies issued before the popup/return_to flow have only state|verifier.
	state, verifier, target, ok := decodeOIDCState("st|ver")
	if !ok || state != "st" || verifier != "ver" || target != "/" {
		t.Fatalf("got %q %q %q %v", state, verifier, target, ok)
	}
}

func TestDecodeOIDCState_RejectsMalformed(t *testing.T) {
	for _, raw := range []string{"", "onlystate"} {
		if _, _, _, ok := decodeOIDCState(raw); ok {
			t.Errorf("decodeOIDCState(%q) accepted malformed input", raw)
		}
	}
}

func TestDecodeOIDCState_TamperedReturnToFallsBackToRoot(t *testing.T) {
	// A cookie is client-controlled: even a forged return_to must not redirect off-site.
	_, _, target, ok := decodeOIDCState("st|ver|r:" + "Ly9ldmlsLmV4YW1wbGU") // base64url("//evil.example")
	if !ok || target != "/" {
		t.Fatalf("target = %q ok=%v, want / true", target, ok)
	}
}
