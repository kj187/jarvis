package api

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/kj187/jarvis/backend/internal/models"
)

// validateSilenceMatchers checks the matcher list against Alertmanager's own
// silence-validation rules (silence/silence.go Validate in Alertmanager):
// at least one matcher, no empty names, every regex must compile, and at
// least one matcher must not match the empty string (a silence made only of
// matchers that are trivially satisfied by an absent label silences nothing
// meaningful, and Alertmanager rejects it). Go's regexp package is RE2 — the
// same engine Alertmanager uses — so a pattern that compiles here is
// guaranteed to compile in Alertmanager too, including syntax the frontend's
// JS RegExp can't evaluate (e.g. inline flags like `(?i)`).
func validateSilenceMatchers(matchers []models.SilenceMatcher) error {
	if len(matchers) == 0 {
		return fmt.Errorf("at least one matcher is required")
	}
	hasMeaningfulMatcher := false
	for _, m := range matchers {
		if m.Name == "" {
			return fmt.Errorf("matcher name must not be empty")
		}
		matchesEmpty, err := matcherMatchesEmptyString(m)
		if err != nil {
			return fmt.Errorf("matcher %q: invalid regular expression", m.Name)
		}
		if !matchesEmpty {
			hasMeaningfulMatcher = true
		}
	}
	if !hasMeaningfulMatcher {
		return fmt.Errorf("at least one matcher must not match the empty string")
	}
	return nil
}

// matcherMatchesEmptyString reports whether the matcher would match a label
// value of "" (i.e. a missing label) — matching Alertmanager's own matcher
// semantics (anchored regex; a missing label is treated as "").
func matcherMatchesEmptyString(m models.SilenceMatcher) (bool, error) {
	if m.IsRegex {
		re, err := regexp.Compile("^(?:" + m.Value + ")$")
		if err != nil {
			return false, err
		}
		matches := re.MatchString("")
		if m.IsEqual {
			return matches, nil
		}
		return !matches, nil
	}
	if m.IsEqual {
		return m.Value == "", nil
	}
	return m.Value != "", nil
}

// isUniqueViolation reports whether err represents a unique-constraint
// violation from either backing store dialect (SQLite or PostgreSQL) —
// substring-matched rather than dialect-switched, so a driver upgrade or
// wording change on either side doesn't silently stop this from firing.
func isUniqueViolation(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "UNIQUE constraint failed") ||
		strings.Contains(msg, "duplicate key value violates unique constraint")
}

// sanitizeAMMessage extracts a safe-to-display message from an Alertmanager
// error response body: unwraps the common `{"message": "..."}` error shape,
// collapses whitespace/newlines, and truncates to a bounded length so a
// pathological AM response can't blow up the response body or leak binary
// noise to the client.
func sanitizeAMMessage(body string) string {
	msg := body
	var parsed struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err == nil && parsed.Message != "" {
		msg = parsed.Message
	}
	msg = strings.Join(strings.Fields(msg), " ")
	const maxLen = 300
	if r := []rune(msg); len(r) > maxLen {
		msg = string(r[:maxLen]) + "…"
	}
	if msg == "" {
		msg = "alertmanager rejected the request"
	}
	return msg
}
