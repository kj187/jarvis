package alertmanager

import (
	"net/http"

	"github.com/kj187/jarvis/backend/internal/version"
)

// userAgentRoundTripper sets a Jarvis-identifying User-Agent on every
// outgoing request, replacing Go's default "Go-http-client/1.1" so
// Alertmanager access logs show who is calling.
type userAgentRoundTripper struct {
	base http.RoundTripper
}

func (u *userAgentRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	r := req.Clone(req.Context())
	r.Header.Set("User-Agent", "Jarvis/"+version.Version)
	return u.base.RoundTrip(r)
}
