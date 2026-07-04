package history

import "testing"

// FuzzParseNullableTimeString verifies that parseNullableTimeString never
// panics and keeps its error/Valid contract consistent: empty input yields
// an invalid NullTime without error, successful parses are Valid, and
// failed parses are never Valid.
func FuzzParseNullableTimeString(f *testing.F) {
	seeds := []string{
		"",
		"2026-07-04T13:37:00Z",
		"2026-07-04T13:37:00.123456789+02:00",
		"2026-07-04 13:37:00",
		"2026-07-04 13:37:00.999999999-07:00",
		"2026-07-04 13:37:00.999999999 -0700 MST",
		"2026-07-04 13:37:00 +0000 MST",
		"0001-01-01T00:00:00Z",
		"not a time",
		"2026-13-45 99:99:99",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, value string) {
		nt, err := parseNullableTimeString(value) // must not panic

		if value == "" {
			if err != nil || nt.Valid {
				t.Errorf("empty input must yield invalid NullTime without error, got valid=%v err=%v", nt.Valid, err)
			}
			return
		}
		if err == nil && !nt.Valid {
			t.Errorf("nil error but invalid NullTime for %q", value)
		}
		if err != nil && nt.Valid {
			t.Errorf("error %v but valid NullTime for %q", err, value)
		}
	})
}
