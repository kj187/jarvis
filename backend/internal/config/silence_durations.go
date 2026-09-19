package config

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

const (
	// MaxSilenceDurationMinutes caps a single configured duration at one year.
	MaxSilenceDurationMinutes = 365 * 24 * 60
	// MaxSilenceDurationChoices caps how many buttons a list may define, so the
	// Fast-Silence and Extend menus stay usable.
	MaxSilenceDurationChoices = 12
)

// silenceDurationUnits maps a duration suffix to its length in minutes. "y" is
// a flat 365 days; there is deliberately no month unit (30d says what it means).
var silenceDurationUnits = map[byte]int{
	'm': 1,
	'h': 60,
	'd': 24 * 60,
	'w': 7 * 24 * 60,
	'y': MaxSilenceDurationMinutes,
}

// ParseSilenceDurations parses a comma-separated duration list such as
// "5m,1h,1d,1w,30d" into minutes — ascending and deduplicated. An empty (or
// whitespace-only) value means "not configured" and returns nil. key names the
// env var in error messages. Mirrors parseSilenceDuration in
// frontend/src/lib/silenceDurations.ts; keep the grammar in sync.
func ParseSilenceDurations(key, raw string) ([]int, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	seen := make(map[int]bool)
	var out []int
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		minutes, err := parseSilenceDuration(part)
		if err != nil {
			return nil, fmt.Errorf("invalid %s: %w", key, err)
		}
		if !seen[minutes] {
			seen[minutes] = true
			out = append(out, minutes)
		}
	}
	if len(out) > MaxSilenceDurationChoices {
		return nil, fmt.Errorf("invalid %s: at most %d durations allowed, got %d", key, MaxSilenceDurationChoices, len(out))
	}
	sort.Ints(out)
	return out, nil
}

// parseSilenceDuration parses one "<number><unit>" entry (units m, h, d, w, y).
func parseSilenceDuration(s string) (int, error) {
	if len(s) < 2 {
		return 0, fmt.Errorf("%q is not a duration like 30m, 4h, 1d, 1w or 1y", s)
	}
	unit, ok := silenceDurationUnits[s[len(s)-1]]
	if !ok {
		return 0, fmt.Errorf("%q has an unknown unit (use m, h, d, w or y)", s)
	}
	digits := s[:len(s)-1]
	for _, r := range digits {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("%q is not a duration like 30m, 4h, 1d, 1w or 1y", s)
		}
	}
	n, err := strconv.Atoi(digits)
	if err != nil || n < 1 || n > MaxSilenceDurationMinutes/unit {
		return 0, fmt.Errorf("%q must be between 1m and 365d", s)
	}
	return n * unit, nil
}
