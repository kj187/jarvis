//go:build prod

package static

import "embed"

//go:embed all:dist
var StaticFiles embed.FS
