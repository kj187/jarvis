package auth

import (
	"context"
	"errors"
)

// NoneProvider is used when JARVIS_AUTH_PROVIDER=none.
// All auth operations return errors; write actions are blocked by middleware.
type NoneProvider struct{}

func (NoneProvider) Mode() string { return "none" }

func (NoneProvider) AuthURL(_, _ string) string { return "" }

func (NoneProvider) Exchange(_ context.Context, _, _ string) (*User, error) {
	return nil, errors.New("auth disabled")
}

func (NoneProvider) Authenticate(_ context.Context, _, _ string) (*User, error) {
	return nil, errors.New("auth disabled")
}

func (NoneProvider) Info() ProviderInfo {
	return ProviderInfo{Mode: "none", LoginURL: ""}
}
