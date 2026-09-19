package config

import (
	"reflect"
	"strings"
	"testing"
)

func TestParseSilenceDurations(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want []int
	}{
		{"empty is unset", "", nil},
		{"whitespace only is unset", "   ", nil},
		{"single minutes", "5m", []int{5}},
		{"all units", "30m,4h,1d,1w,1y", []int{30, 240, 1440, 10080, 525600}},
		{"month as days", "30d", []int{43200}},
		{"sorted ascending", "1w,5m,1h", []int{5, 60, 10080}},
		{"deduplicated across units", "60m,1h,1h", []int{60}},
		{"whitespace and empty entries tolerated", " 5m , ,1h,", []int{5, 60}},
		{"exact max", "365d", []int{525600}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseSilenceDurations("JARVIS_SILENCE_DURATIONS", tc.raw)
			if err != nil {
				t.Fatalf("ParseSilenceDurations(%q) error: %v", tc.raw, err)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("ParseSilenceDurations(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestParseSilenceDurations_Invalid(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{"missing unit", "30"},
		{"missing number", "h"},
		{"unknown unit", "5s"},
		{"month unit is ambiguous", "1M"},
		{"uppercase unit", "1H"},
		{"negative", "-5m"},
		{"zero", "0m"},
		{"decimal", "1.5h"},
		{"compound", "1h30m"},
		{"word", "forever"},
		{"above max minutes", "525601m"},
		{"above max days", "366d"},
		{"above max years", "2y"},
		{"overflow", "99999999999999999999d"},
		{"too many choices", "1m,2m,3m,4m,5m,6m,7m,8m,9m,10m,11m,12m,13m"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseSilenceDurations("JARVIS_SILENCE_DURATIONS", tc.raw)
			if err == nil {
				t.Fatalf("ParseSilenceDurations(%q) = %v, want error", tc.raw, got)
			}
			if !strings.Contains(err.Error(), "JARVIS_SILENCE_DURATIONS") {
				t.Errorf("error %q should name the env var", err)
			}
		})
	}
}

func TestParseSilenceDurations_MaxChoicesAccepted(t *testing.T) {
	got, err := ParseSilenceDurations("K", "1m,2m,3m,4m,5m,6m,7m,8m,9m,10m,11m,12m")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(got) != MaxSilenceDurationChoices {
		t.Errorf("len = %d, want %d", len(got), MaxSilenceDurationChoices)
	}
}

func TestLoad_SilenceDurations(t *testing.T) {
	t.Setenv("JARVIS_SILENCE_DURATIONS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.SilenceDurations != nil {
		t.Errorf("default must be unset, got %v", cfg.SilenceDurations)
	}

	t.Setenv("JARVIS_SILENCE_DURATIONS", "15m,1h,30d")
	cfg, err = Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if want := []int{15, 60, 43200}; !reflect.DeepEqual(cfg.SilenceDurations, want) {
		t.Errorf("SilenceDurations = %v, want %v", cfg.SilenceDurations, want)
	}
}

func TestLoad_SilenceDurations_InvalidFailsStartup(t *testing.T) {
	t.Setenv("JARVIS_SILENCE_DURATIONS", "5m,banana")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "JARVIS_SILENCE_DURATIONS") {
		t.Errorf("Load() error = %v, want it to name JARVIS_SILENCE_DURATIONS", err)
	}
}
