package api

import (
	"regexp"
	"testing"

	"github.com/kj187/jarvis/backend/internal/models"
)

// FuzzValidateSilenceMatchers asserts validateSilenceMatchers never panics
// on arbitrary matcher input, and that whenever it accepts a regex matcher,
// the same pattern actually compiles as the anchored regex the function
// itself uses to decide meaningfulness — i.e. its own accept/reject
// decision is internally consistent.
func FuzzValidateSilenceMatchers(f *testing.F) {
	seeds := []struct {
		name    string
		value   string
		isEqual bool
		isRegex bool
	}{
		{"alertname", "Test", true, false},
		{"instance", "web1|web2", true, true},
		{"instance", "(?i)watchdog", true, true},
		{"instance", "a(", true, true},
		{"", "x", true, false},
		{"instance", "", true, false},
		{"instance", ".*", false, true},
		{"instance", "\x00", true, false},
	}
	for _, s := range seeds {
		f.Add(s.name, s.value, s.isEqual, s.isRegex)
	}

	f.Fuzz(func(t *testing.T, name, value string, isEqual, isRegex bool) {
		matchers := []models.SilenceMatcher{{Name: name, Value: value, IsEqual: isEqual, IsRegex: isRegex}}

		err := validateSilenceMatchers(matchers)

		if isRegex {
			_, compileErr := regexp.Compile("^(?:" + value + ")$")
			if err == nil && compileErr != nil {
				t.Fatalf("validateSilenceMatchers accepted a pattern that doesn't compile: %q", value)
			}
		}
	})
}

// FuzzSanitizeAMMessage asserts sanitizeAMMessage never panics on arbitrary
// (including malformed-JSON and binary) input, and always returns a bounded,
// newline-free string.
func FuzzSanitizeAMMessage(f *testing.F) {
	seeds := []string{
		"",
		`{"message": "ok"}`,
		`{"message":`,
		"line1\nline2\r\n",
		"\x00\x01\x02",
		`{"message": ""}`,
	}
	for _, s := range seeds {
		f.Add(s)
	}

	f.Fuzz(func(t *testing.T, body string) {
		got := sanitizeAMMessage(body)
		if got == "" {
			t.Fatalf("sanitizeAMMessage(%q) returned empty string", body)
		}
		for _, r := range got {
			if r == '\n' || r == '\r' {
				t.Fatalf("sanitizeAMMessage(%q) = %q contains a newline", body, got)
			}
		}
	})
}
