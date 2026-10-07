package originpolicy

import "testing"

// The single rule behind the HTTP origin guard and the WebSocket upgrade
// (Critical Invariant #11): listed, or the request's own host; never a wildcard.
func TestAllowed(t *testing.T) {
	list := []string{"https://jarvis.example.com", "http://localhost:5173"}
	cases := []struct {
		name    string
		origin  string
		host    string
		allowed []string
		want    bool
	}{
		{"listed origin", "https://jarvis.example.com", "internal:8080", list, true},
		{"own host with list (proxy, scheme differs)", "https://internal:8080", "internal:8080", list, true},
		{"own host over plain http with list", "http://internal:8080", "internal:8080", list, true},
		{"foreign origin with list", "https://evil.example", "internal:8080", list, false},
		{"same host, other port is foreign", "http://internal:9999", "internal:8080", list, false},
		{"empty list: own host http", "http://internal:8080", "internal:8080", nil, true},
		{"empty list: own host https", "https://internal:8080", "internal:8080", nil, true},
		{"empty list: foreign origin", "https://evil.example", "internal:8080", nil, false},
		{"wildcard entry is a literal, not a wildcard", "https://evil.example", "internal:8080", []string{"*"}, false},
		{"own host with a non-http scheme is rejected", "ftp://internal:8080", "internal:8080", nil, false},
		{"own host with a non-http scheme is rejected despite a list", "chrome-extension://internal:8080", "internal:8080", list, false},
		{"listed origin is matched case-insensitively", "https://jarvis.example.com", "internal:8080", []string{"https://Jarvis.Example.com"}, true},
		{"own host is matched case-insensitively", "http://Internal:8080", "internal:8080", nil, true},
		{"opaque null origin", "null", "internal:8080", nil, false},
		{"unparsable origin", "://", "internal:8080", nil, false},
		{"host-less origin", "https://", "", nil, false},
		{"empty origin is not decided here", "", "internal:8080", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Allowed(tc.origin, tc.host, tc.allowed); got != tc.want {
				t.Errorf("Allowed(%q, %q, %v) = %v, want %v", tc.origin, tc.host, tc.allowed, got, tc.want)
			}
		})
	}
}
