package api

import (
	"errors"
	"strings"
	"testing"

	"github.com/kj187/jarvis/backend/internal/models"
)

func validMatcher() models.SilenceMatcher {
	return models.SilenceMatcher{Name: "alertname", Value: "Test", IsEqual: true, IsRegex: false}
}

func TestValidateSilenceMatchers(t *testing.T) {
	tests := []struct {
		name      string
		matchers  []models.SilenceMatcher
		wantErr   bool
		errSubstr string
	}{
		{
			name:    "valid single matcher",
			matchers: []models.SilenceMatcher{validMatcher()},
		},
		{
			name:      "empty matcher list",
			matchers:  []models.SilenceMatcher{},
			wantErr:   true,
			errSubstr: "at least one matcher",
		},
		{
			name:      "nil matcher list",
			matchers:  nil,
			wantErr:   true,
			errSubstr: "at least one matcher",
		},
		{
			name:      "empty matcher name",
			matchers:  []models.SilenceMatcher{{Name: "", Value: "x", IsEqual: true}},
			wantErr:   true,
			errSubstr: "name must not be empty",
		},
		{
			name:      "invalid regex",
			matchers:  []models.SilenceMatcher{{Name: "instance", Value: "a(", IsEqual: true, IsRegex: true}},
			wantErr:   true,
			errSubstr: "invalid regular expression",
		},
		{
			name: "valid RE2 syntax that JS RegExp rejects (inline flag)",
			// (?i) is valid RE2 syntax (Go's regexp = RE2, same engine as Alertmanager)
			// even though it fails to compile as a JS RegExp in the frontend preview.
			matchers: []models.SilenceMatcher{{Name: "instance", Value: "(?i)watchdog", IsEqual: true, IsRegex: true}},
		},
		{
			name: "equal matcher on empty value matches empty string but a second matcher is meaningful",
			matchers: []models.SilenceMatcher{
				{Name: "instance", Value: "", IsEqual: true, IsRegex: false},
				validMatcher(),
			},
		},
		{
			name:      "only a matcher matching the empty string",
			matchers:  []models.SilenceMatcher{{Name: "instance", Value: "", IsEqual: true, IsRegex: false}},
			wantErr:   true,
			errSubstr: "must not match the empty string",
		},
		{
			name:      "only a negative matcher matching empty (foo != x matches empty since x != \"\")",
			matchers:  []models.SilenceMatcher{{Name: "instance", Value: "x", IsEqual: false, IsRegex: false}},
			wantErr:   true,
			errSubstr: "must not match the empty string",
		},
		{
			name:     "negative matcher with empty value does NOT match empty (meaningful)",
			matchers: []models.SilenceMatcher{{Name: "instance", Value: "", IsEqual: false, IsRegex: false}},
		},
		{
			name:      "regex matching empty string (.*) alone is not meaningful",
			matchers:  []models.SilenceMatcher{{Name: "instance", Value: ".*", IsEqual: true, IsRegex: true}},
			wantErr:   true,
			errSubstr: "must not match the empty string",
		},
		{
			// !~ "web1" is satisfied by almost everything, including a missing/empty
			// label ("" doesn't match "web1" either) — so alone it's not meaningful.
			name:      "negative regex whose pattern does not match empty is itself not meaningful",
			matchers:  []models.SilenceMatcher{{Name: "instance", Value: "web1", IsEqual: false, IsRegex: true}},
			wantErr:   true,
			errSubstr: "must not match the empty string",
		},
		{
			// !~ ".*" never matches anything (everything matches ".*", so its negation
			// is never true) — including the empty string, which is exactly what makes
			// this matcher "meaningful" per the same empty-string check.
			name:     "negative regex whose pattern DOES match empty is meaningful",
			matchers: []models.SilenceMatcher{{Name: "instance", Value: ".*", IsEqual: false, IsRegex: true}},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateSilenceMatchers(tt.matchers)
			if tt.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("expected no error, got: %v", err)
			}
			if tt.wantErr && !strings.Contains(err.Error(), tt.errSubstr) {
				t.Fatalf("error = %q, want substring %q", err.Error(), tt.errSubstr)
			}
		})
	}
}

func TestSanitizeAMMessage(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "extracts message field from JSON error body",
			in:   `{"message": "silence must contain at least one matcher"}`,
			want: "silence must contain at least one matcher",
		},
		{
			name: "collapses newlines and extra whitespace",
			in:   "line one\nline   two\n",
			want: "line one line two",
		},
		{
			name: "falls back to a generic message for an empty body",
			in:   "",
			want: "alertmanager rejected the request",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sanitizeAMMessage(tt.in); got != tt.want {
				t.Errorf("sanitizeAMMessage(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}

	t.Run("truncates a very long message", func(t *testing.T) {
		long := strings.Repeat("a", 1000)
		got := sanitizeAMMessage(long)
		if len([]rune(got)) > 301 {
			t.Errorf("expected truncated message, got length %d", len([]rune(got)))
		}
		if !strings.HasSuffix(got, "…") {
			t.Errorf("expected truncated message to end with ellipsis, got %q", got)
		}
	})
}

func TestIsUniqueViolation(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"sqlite unique violation", errors.New("insert silence template: UNIQUE constraint failed: silence_templates.name"), true},
		{"postgres unique violation", errors.New(`insert silence template: duplicate key value violates unique constraint "silence_templates_name_key"`), true},
		{"unrelated error", errors.New("connection refused"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isUniqueViolation(tt.err); got != tt.want {
				t.Errorf("isUniqueViolation(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}
