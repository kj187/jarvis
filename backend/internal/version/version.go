package version

// Version is set at build time via -ldflags "-X github.com/kj187/jarvis/backend/internal/version.Version=v1.2.3".
// Falls back to "dev" for local development.
var Version = "dev"
