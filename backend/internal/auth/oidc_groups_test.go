package auth

import (
	"reflect"
	"testing"
)

func TestClaimStrings(t *testing.T) {
	claims := map[string]any{
		"cognito:groups": []any{"eu-central-1_X_microsoftonline", "Operator"},
		"single":         "frontend",
		"mixed":          []any{"a", 7, "b", nil},
		"number":         42,
		"empty":          []any{},
	}
	cases := []struct {
		name, claim string
		want        []string
	}{
		{"array claim with a colon in its name", "cognito:groups", []string{"eu-central-1_X_microsoftonline", "Operator"}},
		{"single string claim", "single", []string{"frontend"}},
		{"non-string array items are skipped", "mixed", []string{"a", "b"}},
		{"unsupported type", "number", nil},
		{"empty array", "empty", nil},
		{"absent claim", "groups", nil},
		{"claim not configured", "", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := claimStrings(claims, tc.claim)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("claimStrings(%q) = %v, want %v", tc.claim, got, tc.want)
			}
		})
	}
}

func TestResolveRole(t *testing.T) {
	cases := []struct {
		name       string
		adminValue string
		groups     []string
		want       string
	}{
		{"member of the admin group", "Operator", []string{"x", "Operator"}, "admin"},
		{"not a member", "Operator", []string{"x"}, "user"},
		{"no groups at all", "Operator", nil, "user"},
		{"no admin value configured", "", []string{"Operator"}, "user"},
		{"match is exact, not a substring", "Operator", []string{"Operators"}, "user"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := &OIDCProvider{adminValue: tc.adminValue}
			if got := p.resolveRole(tc.groups); got != tc.want {
				t.Fatalf("resolveRole(%v) = %q, want %q", tc.groups, got, tc.want)
			}
		})
	}
}
