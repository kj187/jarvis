package db

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
	_ "modernc.org/sqlite"
)

// Dialect identifies the database engine.
type Dialect string

const (
	DialectSQLite   Dialect = "sqlite"
	DialectPostgres Dialect = "postgres"
)

// DetectDialect returns the dialect for a given DSN.
// DSNs starting with "postgres://" or "postgresql://" are PostgreSQL;
// everything else is treated as a SQLite file path.
func DetectDialect(dsn string) Dialect {
	if strings.HasPrefix(dsn, "postgres://") || strings.HasPrefix(dsn, "postgresql://") {
		return DialectPostgres
	}
	return DialectSQLite
}

// RedactDSN replaces the password in a DSN with "***" for safe log output.
// Returns the original string if it cannot be parsed or has no password.
func RedactDSN(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil || u.User == nil {
		return dsn
	}
	_, hasPassword := u.User.Password()
	if !hasPassword {
		return dsn
	}
	// Rebuild manually to avoid url.String() percent-encoding "***".
	redacted := u.Scheme + "://" + u.User.Username() + ":***@" + u.Host + u.RequestURI()
	return redacted
}

// Open opens a database connection for the given DSN and returns the
// connection and its dialect. Use RedactDSN before logging the DSN.
func Open(dsn string) (*sql.DB, Dialect, error) {
	switch DetectDialect(dsn) {
	case DialectPostgres:
		return openPostgres(dsn)
	default:
		return openSQLite(dsn)
	}
}

// Migrate creates all tables and indexes for the given dialect (idempotent).
func Migrate(database *sql.DB, dialect Dialect) error {
	switch dialect {
	case DialectPostgres:
		return migratePostgres(database)
	default:
		return migrateSQLite(database)
	}
}

func openSQLite(path string) (*sql.DB, Dialect, error) {
	if path != ":memory:" {
		if err := ensureDir(path); err != nil {
			return nil, DialectSQLite, err
		}
	}

	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, DialectSQLite, fmt.Errorf("open sqlite: %w", err)
	}

	// SQLite requires a single writer to avoid "database is locked".
	database.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	}
	for _, p := range pragmas {
		if _, err := database.ExecContext(context.Background(), p); err != nil {
			return nil, DialectSQLite, fmt.Errorf("apply pragma %q: %w", p, err)
		}
	}

	return database, DialectSQLite, nil
}

func openPostgres(dsn string) (*sql.DB, Dialect, error) {
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, DialectPostgres, fmt.Errorf("open postgres: %w", err)
	}

	if err := database.PingContext(context.Background()); err != nil {
		_ = database.Close()
		return nil, DialectPostgres, fmt.Errorf("ping postgres: %w", err)
	}

	return database, DialectPostgres, nil
}
