package auth

import (
	"context"
	"errors"

	"golang.org/x/crypto/bcrypt"

	"github.com/kj187/jarvis/backend/internal/users"
)

// InternalProvider authenticates users against bcrypt hashes stored in the DB.
type InternalProvider struct {
	users *users.Store
}

// NewInternalProvider creates an InternalProvider backed by the given users store.
func NewInternalProvider(store *users.Store) *InternalProvider {
	return &InternalProvider{users: store}
}

func (p *InternalProvider) Mode() string { return "internal" }

func (p *InternalProvider) AuthURL(_, _ string) string { return "" }

func (p *InternalProvider) Exchange(_ context.Context, _, _ string) (*User, error) {
	return nil, errors.New("exchange not supported in internal mode")
}

// Authenticate validates username + password.
// It always runs bcrypt to prevent timing oracles on user existence.
func (p *InternalProvider) Authenticate(ctx context.Context, username, password string) (*User, error) {
	u, err := p.users.GetByUsername(ctx, username)
	if err != nil {
		return nil, err
	}

	// Always run bcrypt to equalise timing regardless of whether the user exists.
	// The dummy hash is a real bcrypt hash of a random string so it takes full bcrypt time.
	const dummyHash = "$2a$12$qfknBnqg4.HYjFqT3nDBzeiJAIMB7VH1TMi5F/0KDNHZB.f7lSTlG"
	hashToCompare := dummyHash
	if u != nil && u.PasswordHash != "" {
		hashToCompare = u.PasswordHash
	}
	if bcrypt.CompareHashAndPassword([]byte(hashToCompare), []byte(password)) != nil {
		return nil, errors.New("invalid credentials")
	}
	if u == nil {
		// Should never reach here in practice (bcrypt will fail for dummy hash),
		// but guard defensively.
		return nil, errors.New("invalid credentials")
	}

	_ = p.users.UpdateLastLogin(ctx, u.ID)
	return &User{
		ID:       u.ID,
		Username: u.Username,
		Email:    u.Email,
		Role:     u.Role,
		Provider: u.Provider,
	}, nil
}

func (p *InternalProvider) Info() ProviderInfo {
	return ProviderInfo{Mode: "internal", LoginURL: ""}
}

// HashPassword creates a bcrypt hash of the given plaintext password.
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	return string(b), err
}
