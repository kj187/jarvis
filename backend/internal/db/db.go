package db

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strings"
	"time"

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

// Pool defaults for PostgreSQL. An unbounded pool exhausted the connection
// slots of a shared RDS instance in production (SQLSTATE 53300): every
// request burst opened fresh connections (database/sql default MaxIdleConns
// of 2 closed them right after), multiplied by the number of pods. MaxIdle
// equals MaxOpen so burst connections are reused instead of churned.
const (
	defaultMaxOpenConns    = 10
	defaultConnMaxLifetime = 30 * time.Minute
	defaultConnMaxIdleTime = 5 * time.Minute
)

type poolConfig struct {
	maxOpenConns int
}

func defaultPoolConfig() poolConfig {
	return poolConfig{maxOpenConns: defaultMaxOpenConns}
}

// Option customizes how Open configures the connection pool.
type Option func(*poolConfig)

// WithMaxOpenConns caps the PostgreSQL connection pool (per process; idle
// connections are kept up to the same cap). Values < 1 are ignored. SQLite
// is unaffected — it is always single-connection.
func WithMaxOpenConns(n int) Option {
	return func(c *poolConfig) {
		if n >= 1 {
			c.maxOpenConns = n
		}
	}
}

// Open opens a database connection for the given DSN and returns the
// connection and its dialect. Use RedactDSN before logging the DSN.
func Open(dsn string, opts ...Option) (*sql.DB, Dialect, error) {
	cfg := defaultPoolConfig()
	for _, opt := range opts {
		opt(&cfg)
	}
	switch DetectDialect(dsn) {
	case DialectPostgres:
		return openPostgres(dsn, cfg)
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

func openPostgres(dsn string, cfg poolConfig) (*sql.DB, Dialect, error) {
	database, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, DialectPostgres, fmt.Errorf("open postgres: %w", err)
	}

	database.SetMaxOpenConns(cfg.maxOpenConns)
	database.SetMaxIdleConns(cfg.maxOpenConns)
	database.SetConnMaxLifetime(defaultConnMaxLifetime)
	database.SetConnMaxIdleTime(defaultConnMaxIdleTime)

	if err := database.PingContext(context.Background()); err != nil {
		_ = database.Close()
		return nil, DialectPostgres, fmt.Errorf("ping postgres: %w", err)
	}

	return database, DialectPostgres, nil
}
