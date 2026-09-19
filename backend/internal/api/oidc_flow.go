package api

import (
	"encoding/base64"
	"net/url"
	"strings"
)

const (
	// oidcPopupLanding is where the SSO popup ends up: the SPA sees the marker,
	// tells the opener over a BroadcastChannel and closes the window.
	oidcPopupLanding = "/?login=popup-done"

	// maxReturnToLen bounds the value we accept into the state cookie.
	maxReturnToLen = 2048

	oidcFlowPopup    = "popup"
	oidcFlowReturnTo = "r:"
)

// sanitizeReturnTo returns raw when it is a same-origin, in-app path the user
// may safely be sent back to after logging in, and "" otherwise. Only relative
// paths pass — never a scheme, host, "//host" or backslash form — so the login
// flow cannot be turned into an open redirect. API and auth paths are refused
// too: they are no pages to come back to.
func sanitizeReturnTo(raw string) string {
	if raw == "" || len(raw) > maxReturnToLen || raw[0] != '/' {
		return ""
	}
	if len(raw) > 1 && (raw[1] == '/' || raw[1] == '\\') {
		return ""
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return ""
		}
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "" || u.Host != "" || u.User != nil {
		return ""
	}
	for _, prefix := range []string{"/auth/", "/api/", "/ws"} {
		if strings.HasPrefix(u.Path, prefix) || u.Path == strings.TrimSuffix(prefix, "/") {
			return ""
		}
	}
	return raw
}

// encodeOIDCState packs everything the callback needs into the PKCE state
// cookie value: state|verifier[|popup | |r:<base64url(return_to)>]. All parts
// are base64url or a fixed token, so "|" is a safe separator.
func encodeOIDCState(state, verifier string, popup bool, returnTo string) string {
	v := state + "|" + verifier
	switch {
	case popup:
		return v + "|" + oidcFlowPopup
	case returnTo != "":
		return v + "|" + oidcFlowReturnTo + base64.RawURLEncoding.EncodeToString([]byte(returnTo))
	}
	return v
}

// decodeOIDCState is the inverse of encodeOIDCState and resolves where to send
// the browser after a successful login. The cookie is client-controlled, so the
// return path is re-validated here — a forged value falls back to "/". Cookies
// issued before the popup/return_to flow (two fields) still decode.
func decodeOIDCState(raw string) (state, verifier, landing string, ok bool) {
	parts := strings.SplitN(raw, "|", 3)
	if len(parts) < 2 {
		return "", "", "", false
	}
	state, verifier, landing = parts[0], parts[1], "/"
	if len(parts) == 3 {
		switch flow := parts[2]; {
		case flow == oidcFlowPopup:
			landing = oidcPopupLanding
		case strings.HasPrefix(flow, oidcFlowReturnTo):
			if b, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(flow, oidcFlowReturnTo)); err == nil {
				if p := sanitizeReturnTo(string(b)); p != "" {
					landing = p
				}
			}
		}
	}
	return state, verifier, landing, true
}
