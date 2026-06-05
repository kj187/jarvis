//go:build !prod

package static

import "embed"

// StaticFiles is empty in dev mode — Vite handles the frontend.
var StaticFiles embed.FS
