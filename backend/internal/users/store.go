package users

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	idb "github.com/kj187/jarvis/backend/internal/db"
)

// User represents a Jarvis user account.
type User struct {
	ID           string
	Username     string
	Email        string
	PasswordHash string // bcrypt; empty for OIDC-only users
	Role         string // "user" | "admin"
	Provider     string // "internal" | "oidc"
	OIDCSub      string
	// Groups are the values of the IdP's groups claim as of the user's last
	// SSO login (empty for internal users and when no claim is configured).
	Groups      []string
	CreatedAt   time.Time
	LastLoginAt *time.Time
}

// CreateUser holds the fields required to create a new user.
type CreateUser struct {
	Username     string
	Email        string
	PasswordHash string
	Role         string
	Provider     string
	OIDCSub      string
	Groups       []string
}

// Store handles all database operations for the users table.
type Store struct {
	db      *sql.DB
	dialect idb.Dialect
}

// NewStore creates a new Store.
func NewStore(database *sql.DB, dialect idb.Dialect) *Store {
	return &Store{db: database, dialect: dialect}
}

// rebind converts SQLite-style ? placeholders to PostgreSQL $N placeholders.
func (s *Store) rebind(query string) string {
	if s.dialect == idb.DialectSQLite {
		return query
	}
	n := 0
	var b strings.Builder
	b.Grow(len(query) + 16)
	for _, ch := range query {
		if ch == '?' {
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		} else {
			b.WriteRune(ch)
		}
	}
	return b.String()
}

func (s *Store) scanUser(row interface{ Scan(...any) error }) (*User, error) {
	var u User
	var email, passwordHash, oidcSub sql.NullString
	var groupsJSON string
	var lastLoginAt sql.NullTime
	err := row.Scan(
		&u.ID, &u.Username, &email, &passwordHash,
		&u.Role, &u.Provider, &oidcSub, &groupsJSON, &u.CreatedAt, &lastLoginAt,
	)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(groupsJSON), &u.Groups); err != nil {
		return nil, fmt.Errorf("users: decode oidc_groups: %w", err)
	}
	u.Email = email.String
	u.PasswordHash = passwordHash.String
	u.OIDCSub = oidcSub.String
	if lastLoginAt.Valid {
		t := lastLoginAt.Time
		u.LastLoginAt = &t
	}
	return &u, nil
}

const selectCols = `id, username, email, password_hash, role, provider, oidc_sub, oidc_groups, created_at, last_login_at`

// encodeGroups serialises a group list for the oidc_groups column; nil and
// empty both store '[]' so the column is never NULL.
func encodeGroups(groups []string) (string, error) {
	if len(groups) == 0 {
		return "[]", nil
	}
	b, err := json.Marshal(groups)
	if err != nil {
		return "", fmt.Errorf("users: encode oidc_groups: %w", err)
	}
	return string(b), nil
}

// Create inserts a new user and returns the created record.
func (s *Store) Create(ctx context.Context, cu *CreateUser) (*User, error) {
	id := uuid.New().String()
	now := time.Now().UTC()
	groupsJSON, err := encodeGroups(cu.Groups)
	if err != nil {
		return nil, err
	}
	q := s.rebind(`INSERT INTO users (id, username, email, password_hash, role, provider, oidc_sub, oidc_groups, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	email := sql.NullString{String: cu.Email, Valid: cu.Email != ""}
	ph := sql.NullString{String: cu.PasswordHash, Valid: cu.PasswordHash != ""}
	oidcSub := sql.NullString{String: cu.OIDCSub, Valid: cu.OIDCSub != ""}
	if _, err := s.db.ExecContext(ctx, q, id, cu.Username, email, ph, cu.Role, cu.Provider, oidcSub, groupsJSON, now); err != nil {
		return nil, fmt.Errorf("users.Create: %w", err)
	}
	return s.GetByID(ctx, id)
}

// GetByID returns a user by primary key.
func (s *Store) GetByID(ctx context.Context, id string) (*User, error) {
	q := s.rebind(`SELECT ` + selectCols + ` FROM users WHERE id = ?`)
	u, err := s.scanUser(s.db.QueryRowContext(ctx, q, id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

// GetByUsername returns a user by username (case-sensitive).
func (s *Store) GetByUsername(ctx context.Context, username string) (*User, error) {
	q := s.rebind(`SELECT ` + selectCols + ` FROM users WHERE username = ?`)
	u, err := s.scanUser(s.db.QueryRowContext(ctx, q, username))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

// GetByOIDCSub returns a user by OIDC subject claim.
func (s *Store) GetByOIDCSub(ctx context.Context, sub string) (*User, error) {
	q := s.rebind(`SELECT ` + selectCols + ` FROM users WHERE oidc_sub = ?`)
	u, err := s.scanUser(s.db.QueryRowContext(ctx, q, sub))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return u, err
}

// UpsertOIDCUser creates or updates an OIDC user by subject claim.
// role must be "admin" or "user"; role, groups and a non-empty e-mail are applied
// on every login so changes in the IdP are reflected without manual intervention
// (they take effect at the next login, never mid-session).
func (s *Store) UpsertOIDCUser(ctx context.Context, sub, username, email, role string, groups []string) (*User, error) {
	existing, err := s.GetByOIDCSub(ctx, sub)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if existing.Role != role {
			if err := s.UpdateRole(ctx, existing.ID, role); err != nil {
				return nil, err
			}
			existing.Role = role
		}
		if email != "" && existing.Email != email {
			if err := s.updateEmail(ctx, existing.ID, email); err != nil {
				return nil, err
			}
			existing.Email = email
		}
		if !slices.Equal(existing.Groups, groups) {
			if err := s.updateGroups(ctx, existing.ID, groups); err != nil {
				return nil, err
			}
			existing.Groups = groups
		}
		return existing, nil
	}
	candidate := username
	if candidate == "" {
		candidate = sub
	}
	candidate, err = s.nextAvailableUsername(ctx, candidate)
	if err != nil {
		return nil, err
	}
	return s.Create(ctx, &CreateUser{
		Username: candidate,
		Email:    email,
		Role:     role,
		Provider: "oidc",
		OIDCSub:  sub,
		Groups:   groups,
	})
}

// updateEmail replaces the stored e-mail address of a user.
func (s *Store) updateEmail(ctx context.Context, id, email string) error {
	q := s.rebind(`UPDATE users SET email = ? WHERE id = ?`)
	if _, err := s.db.ExecContext(ctx, q, email, id); err != nil {
		return fmt.Errorf("users.updateEmail: %w", err)
	}
	return nil
}

// updateGroups replaces the stored IdP group set of a user.
func (s *Store) updateGroups(ctx context.Context, id string, groups []string) error {
	groupsJSON, err := encodeGroups(groups)
	if err != nil {
		return err
	}
	q := s.rebind(`UPDATE users SET oidc_groups = ? WHERE id = ?`)
	if _, err := s.db.ExecContext(ctx, q, groupsJSON, id); err != nil {
		return fmt.Errorf("users.updateGroups: %w", err)
	}
	return nil
}

func (s *Store) nextAvailableUsername(ctx context.Context, base string) (string, error) {
	candidate := base
	for i := 0; ; i++ {
		u, err := s.GetByUsername(ctx, candidate)
		if err != nil {
			return "", err
		}
		if u == nil {
			return candidate, nil
		}
		if i == 0 {
			candidate = base + "-oidc"
			continue
		}
		candidate = fmt.Sprintf("%s-oidc-%d", base, i+1)
	}
}

// UpdateLastLogin sets last_login_at for the given user ID.
func (s *Store) UpdateLastLogin(ctx context.Context, id string) error {
	q := s.rebind(`UPDATE users SET last_login_at = ? WHERE id = ?`)
	_, err := s.db.ExecContext(ctx, q, time.Now().UTC(), id)
	return err
}

// Count returns the total number of users.
func (s *Store) Count(ctx context.Context) (int, error) {
	var n int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&n)
	return n, err
}

// List returns all users ordered by created_at ascending.
func (s *Store) List(ctx context.Context) ([]*User, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+selectCols+` FROM users ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var users []*User
	for rows.Next() {
		u, err := s.scanUser(rows)
		if err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// Delete removes a user by ID.
func (s *Store) Delete(ctx context.Context, id string) error {
	q := s.rebind(`DELETE FROM users WHERE id = ?`)
	_, err := s.db.ExecContext(ctx, q, id)
	return err
}

// UpdateRole sets the role for a user by ID.
func (s *Store) UpdateRole(ctx context.Context, id, role string) error {
	q := s.rebind(`UPDATE users SET role = ? WHERE id = ?`)
	_, err := s.db.ExecContext(ctx, q, role, id)
	return err
}
