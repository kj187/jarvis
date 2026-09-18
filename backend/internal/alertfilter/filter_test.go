package alertfilter

import (
	_ "embed"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

//go:embed testdata/conformance.json
var conformanceJSON []byte

type conformanceCase struct {
	Reason           string               `json:"reason"`
	Alert            models.EnrichedAlert `json:"alert"`
	Matchers         []Matcher            `json:"matchers"`
	Search           string               `json:"search"`
	Now              time.Time            `json:"now"`
	ExpectedResolved bool                 `json:"expectedResolved"`
	InvalidMatchers  []int                `json:"invalidMatchers"`
}

func resolvedFilterAlert() models.EnrichedAlert {
	return models.EnrichedAlert{
		Labels: map[string]string{
			"alertname": "HighLatency",
			"instance":  "api-01",
			"empty":     "",
			"@receiver": "label-fallback",
		},
		Receivers:   []models.Receiver{{Name: " primary "}, {Name: "secondary"}},
		ClusterName: "prod-eu",
		StartsAt:    time.Date(2026, 9, 17, 9, 30, 0, 0, time.UTC),
	}
}

func TestCompileAndMatch(t *testing.T) {
	now := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		matcher Matcher
		want    bool
	}{
		{"equal", Matcher{"instance", "=", "api-01"}, true},
		{"missing equals empty", Matcher{"missing", "=", ""}, true},
		{"not equal", Matcher{"instance", "!=", "web-01"}, true},
		{"regex substring", Matcher{"instance", "=~", "api"}, true},
		{"negative regex", Matcher{"instance", "!~", "web"}, true},
		{"cluster pseudo label", Matcher{"@cluster", "=", "prod-eu"}, true},
		{"unclaimed pseudo label", Matcher{"@claimed-by", "=", ""}, true},
		{"receiver equality trims list", Matcher{"receiver", "=", "primary"}, true},
		{"receiver negative sees every item", Matcher{"@receiver", "!=", "primary"}, false},
		{"receiver regex sees any item", Matcher{"receiver", "=~", "cond"}, true},
		{"age greater", Matcher{"@age", ">", "15m"}, true},
		{"age less", Matcher{"@age", "<", "1h"}, true},
		{"age rejects combined duration", Matcher{"@age", ">", "1h30m"}, false},
		{"age rejects unsupported operator", Matcher{"@age", "=", "30m"}, false},
		{"comparison rejected for label", Matcher{"instance", ">", "api"}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			compiled, invalid := Compile([]Matcher{tc.matcher})
			if len(invalid) != 0 {
				t.Fatalf("invalid = %v", invalid)
			}
			if got := compiled.Match(resolvedFilterAlert(), now); got != tc.want {
				t.Fatalf("Match() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestCompile_InvalidRegexHasOperatorSpecificFallback(t *testing.T) {
	compiled, invalid := Compile([]Matcher{
		{Name: "instance", Operator: "=~", Value: "("},
		{Name: "instance", Operator: "!~", Value: "("},
	})
	if len(invalid) != 2 || invalid[0] != 0 || invalid[1] != 1 {
		t.Fatalf("invalid = %v, want [0 1]", invalid)
	}
	if compiled.Match(resolvedFilterAlert(), time.Now()) {
		t.Fatal("AND match with invalid positive regex = true, want false")
	}

	negative, _ := Compile([]Matcher{{Name: "instance", Operator: "!~", Value: "("}})
	if !negative.Match(resolvedFilterAlert(), time.Now()) {
		t.Fatal("invalid negative regex = false, want true")
	}
}

func TestMatchesSearch_IndividualRealLabelNamesAndValuesOnly(t *testing.T) {
	labels := map[string]string{"alertname": "HighLatency", "instance": "api-01", "team": "Core Platform", "@receiver": "secret-oncall"}
	for _, search := range []string{"high", "INSTANCE", "platform"} {
		if !MatchesSearch(labels, search) {
			t.Errorf("MatchesSearch(%q) = false", search)
		}
	}
	for _, search := range []string{`latency\",\"instance`, "prod-eu", "primary", "secret-oncall"} {
		if MatchesSearch(labels, search) {
			t.Errorf("MatchesSearch(%q) = true", search)
		}
	}
}

func TestAgeOverflowBehavesAsPositiveInfinity(t *testing.T) {
	compiled, invalid := Compile([]Matcher{{Name: "@age", Operator: "<", Value: "999999999999999999999999999999d"}})
	if len(invalid) != 0 {
		t.Fatalf("invalid = %v", invalid)
	}
	if !compiled.Match(resolvedFilterAlert(), time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)) {
		t.Fatal("finite age was not less than overflowing positive duration")
	}
}

func TestResolvedFilterConformance(t *testing.T) {
	var fixtures []conformanceCase
	if err := json.Unmarshal(conformanceJSON, &fixtures); err != nil {
		t.Fatalf("unmarshal conformance fixture: %v", err)
	}
	for i, fixture := range fixtures {
		t.Run(fixture.Reason, func(t *testing.T) {
			compiled, invalid := Compile(fixture.Matchers)
			if !reflect.DeepEqual(invalid, fixture.InvalidMatchers) {
				t.Fatalf("case %d invalidMatchers = %v, want %v", i, invalid, fixture.InvalidMatchers)
			}
			got := compiled.Match(fixture.Alert, fixture.Now) && MatchesSearch(fixture.Alert.Labels, fixture.Search)
			if got != fixture.ExpectedResolved {
				t.Fatalf("case %d match = %v, want %v", i, got, fixture.ExpectedResolved)
			}
		})
	}
}
