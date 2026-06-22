package alertmanager

import "net/http"

// Auth holds per-cluster authentication options for outgoing Alertmanager requests.
// Priority (highest wins): OAuth2 > BearerToken > BasicUser/BasicPass > Headers.
type Auth struct {
	BearerToken string
	BasicUser   string
	BasicPass   string
	Headers     map[string]string
	// OAuth2 enables dynamic token fetching via the client_credentials grant.
	// When set it takes priority over all other auth options.
	OAuth2 *OAuth2ClientConfig
}

// authRoundTripper injects authentication into every outgoing HTTP request.
// Priority (highest wins): BearerToken > BasicUser/BasicPass > Headers.
type authRoundTripper struct {
	base http.RoundTripper
	auth Auth
}

func (a *authRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	r := req.Clone(req.Context())
	for k, v := range a.auth.Headers {
		r.Header.Set(k, v)
	}
	if a.auth.BasicUser != "" {
		r.SetBasicAuth(a.auth.BasicUser, a.auth.BasicPass)
	}
	if a.auth.BearerToken != "" {
		r.Header.Set("Authorization", "Bearer "+a.auth.BearerToken)
	}
	return a.base.RoundTrip(r)
}
