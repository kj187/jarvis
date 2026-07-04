package db

import (
	"net/url"
	"strings"
	"testing"
)

// FuzzRedactDSN verifies that RedactDSN never panics and, most importantly,
// never leaks a password into its output (Critical Invariant: JARVIS_DB_DSN
// is never logged raw).
func FuzzRedactDSN(f *testing.F) {
	seeds := []string{
		"postgres://user:secret@localhost:5432/jarvis",
		"postgresql://user:p%40ss%2Fword@db.example.com/jarvis?sslmode=disable",
		"postgres://user@localhost/jarvis",
		"postgres://:onlypassword@host/db",
		"http://a:b@[::1]:80/path?q=1#frag",
		"/data/jarvis.db",
		":memory:",
		"",
		"://not a url at all",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, dsn string) {
		redacted := RedactDSN(dsn) // must not panic

		u, err := url.Parse(dsn)
		if err != nil || u.User == nil {
			if redacted != dsn {
				t.Errorf("unparseable/userless DSN must pass through unchanged: %q -> %q", dsn, redacted)
			}
			return
		}
		password, hasPassword := u.User.Password()
		if !hasPassword {
			if redacted != dsn {
				t.Errorf("DSN without password must pass through unchanged: %q -> %q", dsn, redacted)
			}
			return
		}
		if password == "" || password == "***" {
			return
		}
		// A leaked password would appear in its DSN position ":password@".
		// A plain substring check false-positives on passwords that are
		// themselves URL-structural characters ("@", "*", ...), so match
		// the full ":password@" pattern instead — unless that pattern
		// legitimately occurs in a non-password part of the DSN (username,
		// host, path, query), which redaction must not touch.
		leakPattern := ":" + password + "@"
		nonSecretParts := u.User.Username() + u.Host + u.RequestURI()
		if !strings.Contains(nonSecretParts, leakPattern) && strings.Contains(redacted, leakPattern) {
			t.Errorf("password leaked into redacted DSN: %q -> %q", dsn, redacted)
		}
	})
}
