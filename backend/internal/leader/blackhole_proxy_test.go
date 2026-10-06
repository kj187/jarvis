package leader

import (
	"context"
	"net"
	"net/url"
	"sync"
	"testing"
)

// blackholeProxy is a minimal TCP proxy in front of PostgreSQL that can be
// switched into a blackhole: from then on it keeps every socket open but
// silently stops forwarding in both directions — what a network partition or
// a dropped node looks like to the client (no FIN, no RST, no ACK).
// Toxiproxy would do the same; a 60-line in-process proxy avoids another
// container in the test setup.
type blackholeProxy struct {
	ln       net.Listener
	upstream string

	mu         sync.Mutex
	blackholed bool
	conns      []net.Conn // every socket (client and upstream side) we hold open
	upstreams  []net.Conn
}

// newBlackholeProxy listens on a loopback port and forwards to the host:port
// of dsn. It returns the proxy and a copy of dsn pointing at the proxy.
func newBlackholeProxy(t *testing.T, dsn string) (*blackholeProxy, string) {
	t.Helper()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse dsn: %v", err)
	}
	ln, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	p := &blackholeProxy{ln: ln, upstream: u.Host}
	t.Cleanup(p.close)
	go p.accept()

	u.Host = ln.Addr().String()
	return p, u.String()
}

func (p *blackholeProxy) accept() {
	for {
		c, err := p.ln.Accept()
		if err != nil {
			return
		}
		up, err := (&net.Dialer{}).DialContext(context.Background(), "tcp", p.upstream)
		if err != nil {
			_ = c.Close()
			continue
		}
		p.mu.Lock()
		p.conns = append(p.conns, c, up)
		p.upstreams = append(p.upstreams, up)
		p.mu.Unlock()
		go p.pipe(up, c)
		go p.pipe(c, up)
	}
}

// pipe copies src to dst, discarding the bytes while blackholed.
func (p *blackholeProxy) pipe(dst, src net.Conn) {
	buf := make([]byte, 32*1024)
	for {
		n, err := src.Read(buf)
		if n > 0 && !p.isBlackholed() {
			if _, werr := dst.Write(buf[:n]); werr != nil {
				return
			}
		}
		if err != nil {
			return
		}
	}
}

func (p *blackholeProxy) isBlackholed() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.blackholed
}

// Blackhole starts dropping all traffic without closing any socket.
func (p *blackholeProxy) Blackhole() {
	p.mu.Lock()
	p.blackholed = true
	p.mu.Unlock()
}

// DropUpstream closes the proxy's connections to PostgreSQL. It models the
// server finally reaping the dead session through its own tcp_keepalives_*
// (docs/postgres-ha.md), which releases the session-level advisory lock.
func (p *blackholeProxy) DropUpstream() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.upstreams {
		_ = c.Close()
	}
}

func (p *blackholeProxy) close() {
	_ = p.ln.Close()
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, c := range p.conns {
		_ = c.Close()
	}
}
