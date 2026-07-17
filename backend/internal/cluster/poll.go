package cluster

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/kj187/jarvis/backend/internal/alertmanager"
	"github.com/kj187/jarvis/backend/internal/models"
)

// FetchDurationFunc receives the observed fetch duration for one member —
// used by the caller to record a per-member fetch-duration metric. May be nil.
type FetchDurationFunc func(member string, seconds float64)

// fetchRetryDelay is the pause before the single retry FetchAlerts and
// FetchSilences make on a retryable per-member error — long enough to let a
// one-off transient reset (e.g. a service-mesh sidecar tearing down a
// connection) clear. The retry is a second, independent request with its own
// 10s client timeout, so the worst case for a hard-down member roughly
// doubles (≈20s per poll instead of ≈10s); polls run sequentially and never
// overlap, a slow poll just delays the next tick.
const fetchRetryDelay = 250 * time.Millisecond

// FetchAlerts polls all members in parallel and returns the deduplicated,
// enriched alert set for this cluster (see mergeAlerts). Returns an error
// only when ALL members failed — a single member's failure does not fail the
// whole cluster; an alert is real if ANY member reports it (union
// semantics). Updates the cached per-member up-state read by MemberUpStates.
func (c *Cluster) FetchAlerts(ctx context.Context, onDuration FetchDurationFunc) ([]models.EnrichedAlert, error) {
	if len(c.Members) == 0 {
		return nil, nil
	}

	type result struct {
		member *Member
		alerts []alertmanager.GettableAlert
		err    error
	}
	results := make([]result, len(c.Members))
	var wg sync.WaitGroup
	for i, m := range c.Members {
		wg.Add(1)
		go func(idx int, m *Member) {
			defer wg.Done()
			start := time.Now()
			alerts, err := m.Client.GetAlerts(ctx)
			if err != nil && ctx.Err() == nil && isRetryableUpstreamError(err) {
				// A single transient upstream blip is common and self-heals
				// immediately — one retry avoids logging/alerting on it as a
				// poll failure (see CreateSilence/DeleteSilence, which apply
				// the same retry-once policy on the write side). onDuration
				// deliberately reports the total including the retry: the
				// metric reflects this member's contribution to poll latency.
				sleepCtx(ctx, fetchRetryDelay)
				alerts, err = m.Client.GetAlerts(ctx)
			}
			if onDuration != nil {
				onDuration(m.Name, time.Since(start).Seconds())
			}
			results[idx] = result{member: m, alerts: alerts, err: err}
		}(i, m)
	}
	wg.Wait()

	byMember := make(map[string][]alertmanager.GettableAlert, len(c.Members))
	linkURLByMember := make(map[string]string, len(c.Members))
	order := make([]string, 0, len(c.Members))
	var lastErr error
	anyOK := false
	for _, res := range results {
		c.setMemberUp(res.member.Name, res.err == nil)
		linkURLByMember[res.member.Name] = res.member.LinkURL
		if res.err != nil {
			lastErr = res.err
			continue
		}
		anyOK = true
		byMember[res.member.Name] = res.alerts
		order = append(order, res.member.Name)
	}
	if !anyOK {
		return nil, fmt.Errorf("all members of cluster %q failed: %w", c.Name, lastErr)
	}

	merged := mergeAlerts(byMember, order)
	// Single-member clusters keep SeenOn empty so existing payloads stay byte-identical.
	if len(c.Members) <= 1 {
		for i := range merged {
			merged[i].seenOn = nil
		}
	}
	return enrichMerged(merged, c.Name, linkURLByMember), nil
}

// FetchSilences polls all members in parallel and returns the deduplicated
// silence set (union by ID, newest UpdatedAt wins). Returns an error only
// when ALL members failed.
func (c *Cluster) FetchSilences(ctx context.Context, onDuration FetchDurationFunc) ([]alertmanager.GettableSilence, error) {
	if len(c.Members) == 0 {
		return nil, nil
	}

	type result struct {
		member   *Member
		silences []alertmanager.GettableSilence
		err      error
	}
	results := make([]result, len(c.Members))
	var wg sync.WaitGroup
	for i, m := range c.Members {
		wg.Add(1)
		go func(idx int, m *Member) {
			defer wg.Done()
			start := time.Now()
			silences, err := m.Client.GetSilences(ctx)
			if err != nil && ctx.Err() == nil && isRetryableUpstreamError(err) {
				sleepCtx(ctx, fetchRetryDelay)
				silences, err = m.Client.GetSilences(ctx)
			}
			if onDuration != nil {
				onDuration(m.Name, time.Since(start).Seconds())
			}
			results[idx] = result{member: m, silences: silences, err: err}
		}(i, m)
	}
	wg.Wait()

	byMember := make(map[string][]alertmanager.GettableSilence, len(c.Members))
	order := make([]string, 0, len(c.Members))
	var lastErr error
	anyOK := false
	for _, res := range results {
		if res.err != nil {
			lastErr = res.err
			continue
		}
		anyOK = true
		byMember[res.member.Name] = res.silences
		order = append(order, res.member.Name)
	}
	if !anyOK {
		return nil, lastErr
	}
	return mergeSilences(byMember, order), nil
}

// CreateSilence sends the silence to the first healthy member (config
// order); on transport failure or a 5xx response, retries once against the
// next healthy member. Never sent to all members — gossip replicates
// silences between real HA members, so posting to every member would create
// duplicates. Does NOT retry a 4xx response (see isRetryableUpstreamError) — the
// request reached Alertmanager and was rejected on its merits (invalid
// matcher, bad ID, …); a second member will reject it identically, so
// retrying only adds latency and (for a non-idempotent create) risks a
// duplicate if the first response was lost after Alertmanager had already
// applied the write.
func (c *Cluster) CreateSilence(ctx context.Context, s alertmanager.PostableSilence) (string, error) {
	members := c.writeOrder()
	if len(members) == 0 {
		return "", fmt.Errorf("cluster %q has no members", c.Name)
	}
	var lastErr error
	for i := 0; i < attemptCount(members); i++ {
		id, err := members[i].Client.CreateSilence(ctx, s)
		if err == nil {
			return id, nil
		}
		lastErr = err
		if !isRetryableUpstreamError(err) {
			return "", err
		}
	}
	return "", lastErr
}

// DeleteSilence mirrors CreateSilence's member-selection and retry behavior.
func (c *Cluster) DeleteSilence(ctx context.Context, id string) error {
	members := c.writeOrder()
	if len(members) == 0 {
		return fmt.Errorf("cluster %q has no members", c.Name)
	}
	var lastErr error
	for i := 0; i < attemptCount(members); i++ {
		err := members[i].Client.DeleteSilence(ctx, id)
		if err == nil {
			return nil
		}
		lastErr = err
		if !isRetryableUpstreamError(err) {
			return err
		}
	}
	return lastErr
}

// isRetryableUpstreamError reports whether a failed request (read or write)
// is worth retrying: true for transport/network errors and 5xx responses,
// false for a 4xx *alertmanager.AMError — Alertmanager received and
// rejected the request on its merits, and a retry (against the same or
// another member, both enforce identical validation) would get the same
// answer.
func isRetryableUpstreamError(err error) bool {
	var amErr *alertmanager.AMError
	if errors.As(err, &amErr) {
		return amErr.StatusCode >= 500
	}
	return true
}

// sleepCtx sleeps for d or returns early if ctx is cancelled.
func sleepCtx(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// attemptCount caps write retries at 2: the first healthy member, plus one retry.
func attemptCount(members []*Member) int {
	if len(members) > 2 {
		return 2
	}
	return len(members)
}

// writeOrder returns members ordered healthy-first (config order preserved
// within each group), based on the cached up-state from the last
// FetchAlerts. Members with unknown state (no poll yet) count as healthy so
// writes work before the first poll completes.
func (c *Cluster) writeOrder() []*Member {
	c.upMu.Lock()
	defer c.upMu.Unlock()
	healthy := make([]*Member, 0, len(c.Members))
	var unhealthy []*Member
	for _, m := range c.Members {
		if up, known := c.up[m.Name]; known && !up {
			unhealthy = append(unhealthy, m)
			continue
		}
		healthy = append(healthy, m)
	}
	return append(healthy, unhealthy...)
}

func (c *Cluster) setMemberUp(name string, up bool) {
	c.upMu.Lock()
	if c.up == nil {
		c.up = make(map[string]bool)
	}
	c.up[name] = up
	c.upMu.Unlock()
}

// MemberUpStates returns a copy of the last-poll-success flag per member.
// Read at scrape time by the metrics collector — never performs an upstream
// HTTP call itself.
func (c *Cluster) MemberUpStates() map[string]bool {
	c.upMu.Lock()
	defer c.upMu.Unlock()
	out := make(map[string]bool, len(c.up))
	for k, v := range c.up {
		out[k] = v
	}
	return out
}
