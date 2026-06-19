package users

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	idb "github.com/kj187/jarvis/backend/internal/db"
)

// User represents a Jarvis user account.
type User struct {
	ID          string
	Username    string
	Email       string
	PasswordHash string // bcrypt; empty for OIDC-only users
	Role        string // "user" | "admin"
	Provider    string // "internal" | "oidc"
	OIDCSub     string
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
	var lastLoginAt sql.NullTime
	err := row.Scan(
		&u.ID, &u.Username, &email, &passwordHash,
		&u.Role, &u.Provider, &oidcSub, &u.CreatedAt, &lastLoginAt,
	)
	if err != nil {
		return nil, err
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

const selectCols = `id, username, email, password_hash, role, provider, oidc_sub, created_at, last_login_at`

// Create inserts a new user and returns the created record.
func (s *Store) Create(ctx context.Context, cu *CreateUser) (*User, error) {
	id := uuid.New().String()
	now := time.Now().UTC()
	q := s.rebind(`INSERT INTO users (id, username, email, password_hash, role, provider, oidc_sub, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
	email := sql.NullString{String: cu.Email, Valid: cu.Email != ""}
	ph := sql.NullString{String: cu.PasswordHash, Valid: cu.PasswordHash != ""}
	oidcSub := sql.NullString{String: cu.OIDCSub, Valid: cu.OIDCSub != ""}
	if _, err := s.db.ExecContext(ctx, q, id, cu.Username, email, ph, cu.Role, cu.Provider, oidcSub, now); err != nil {
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
// role must be "admin" or "user"; it is applied on every login so OIDC group
// changes are reflected without manual intervention.
func (s *Store) UpsertOIDCUser(ctx context.Context, sub, username, email, role string) (*User, error) {
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
	})
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
