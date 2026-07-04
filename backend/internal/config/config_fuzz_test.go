package config

import (
	"bytes"
	"encoding/hex"
	"testing"
)

// FuzzParseSecretKey verifies that parseSecretKey never panics and never
// returns an error: empty input yields a nil key, valid hex is decoded,
// and everything else passes through as raw bytes.
func FuzzParseSecretKey(f *testing.F) {
	seeds := []string{
		"",
		"deadbeef",
		"DEADBEEF",
		"0",
		"00",
		"zz",
		"not-hex!",
		"6a61727669732d7365637265742d6b6579",
	}
	for _, s := range seeds {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, raw string) {
		key, err := parseSecretKey(raw)
		if err != nil {
			t.Errorf("parseSecretKey must never error, got %v for %q", err, raw)
		}
		if raw == "" {
			if key != nil {
				t.Errorf("empty input must return nil key, got %v", key)
			}
			return
		}
		if decoded, hexErr := hex.DecodeString(raw); hexErr == nil {
			if !bytes.Equal(key, decoded) {
				t.Errorf("valid hex input %q must be hex-decoded", raw)
			}
			return
		}
		if string(key) != raw {
			t.Errorf("non-hex input %q must pass through as raw bytes, got %q", raw, key)
		}
	})
}
