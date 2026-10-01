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
		name        string
		adminGroups []string
		groups      []string
		want        string
	}{
		{"member of the admin group", []string{"Operator"}, []string{"x", "Operator"}, "admin"},
		{"not a member", []string{"Operator"}, []string{"x"}, "user"},
		{"no groups at all", []string{"Operator"}, nil, "user"},
		{"no admin group configured", nil, []string{"Operator"}, "user"},
		{"match is exact, not a substring", []string{"Operator"}, []string{"Operators"}, "user"},
		{"member of the first of several", []string{"admin_a", "admin_b"}, []string{"admin_a"}, "admin"},
		{"member of the last of several", []string{"admin_a", "admin_b"}, []string{"x", "admin_b"}, "admin"},
		{"member of none of several", []string{"admin_a", "admin_b"}, []string{"x"}, "user"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := &OIDCProvider{adminGroups: tc.adminGroups}
			if got := p.resolveRole(tc.groups); got != tc.want {
				t.Fatalf("resolveRole(%v) = %q, want %q", tc.groups, got, tc.want)
			}
		})
	}
}
