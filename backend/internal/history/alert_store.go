package history

import (
	"encoding/json"
	"maps"
	"sort"
	"sync"
	"time"

	"github.com/kj187/jarvis/backend/internal/models"
)

const ResolvedBufferTTL = 20 * time.Minute

type resolvedEntry struct {
	alert     models.EnrichedAlert
	expiresAt time.Time
}

// AlertStore is an in-memory store for the current poll snapshot.
// All methods are safe for concurrent use. Maps/slices returned by Get() and
// EncodedSnapshot() are shared, not deep-copied, and must be treated as
// read-only by callers (API handlers, recorder, metrics) — only the store's
// own mutation methods ever write into them.
type AlertStore struct {
	mu             sync.RWMutex
	alerts         []models.EnrichedAlert
	resolvedBuffer map[string]resolvedEntry
	now            func() time.Time

	// version increments exactly once per mutation that changes what Get()
	// would return (see bumpVersionLocked). cachedVersion/cachedJSON/cacheValid
	// implement EncodedSnapshot()'s cache: a version mismatch means stale.
	version       uint64
	cachedVersion uint64
	cachedJSON    []byte
	cacheValid    bool
}

func (s *AlertStore) currentTime() time.Time {
	if s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

func alertSnapshotKey(fingerprint, clusterName string) string {
	return fingerprint + "\x1f" + clusterName
}

// Set replaces the active alert snapshot. Alerts that reappear as active are
// removed from the resolved buffer (they came back before the 20-min window).
// Incoming alerts are cloned before storage (cloneEnrichedAlert) so mutating
// the caller's slice/maps afterward never affects the store. Always bumps
// the cache version, even for a content-identical snapshot — the caller
// (Recorder.broadcastAlertsIfChanged) is the one responsible for suppressing
// a redundant WS broadcast by content hash, not this store.
func (s *AlertStore) Set(alerts []models.EnrichedAlert) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cloned := make([]models.EnrichedAlert, len(alerts))
	for i, a := range alerts {
		cloned[i] = cloneEnrichedAlert(a)
	}
	activeKeys := make(map[string]struct{}, len(cloned))
	active := make([]models.EnrichedAlert, 0, len(cloned))
	for _, a := range cloned {
		key := alertSnapshotKey(a.Fingerprint, a.ClusterName)
		if a.Status.State != "resolved" {
			activeKeys[key] = struct{}{}
			active = append(active, a)
		}
	}
	for key := range activeKeys {
		delete(s.resolvedBuffer, key)
	}
	s.alerts = active
	for _, a := range cloned {
		if a.Status.State != "resolved" {
			continue
		}
		key := alertSnapshotKey(a.Fingerprint, a.ClusterName)
		if _, activeExists := activeKeys[key]; activeExists {
			continue
		}
		s.seedResolvedLocked(a, s.currentTime())
	}
	s.bumpVersionLocked()
}

// Reset clears both the active list and the resolved buffer. Unlike Set(nil),
// which intentionally preserves the resolved buffer for its 20-minute
// visibility window, Reset wipes the store entirely — used only by the e2e
// test-reset route so a resolved alert from one test can't leak into the
// next test's alert list for up to 20 minutes.
func (s *AlertStore) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.alerts = nil
	s.resolvedBuffer = nil
	s.bumpVersionLocked()
}

// Get returns a copy of all alerts: currently active + resolved buffer,
// in a stable, total order (startsAt desc, then fingerprint asc, then
// clusterName asc). The ordering is deterministic across polls even though
// the upstream Alertmanager response order and the resolvedBuffer map
// iteration order are not — without it every poll reshuffles the list and
// the frontend alert grouping visibly flickers. fingerprint+clusterName is
// unique and stable per alert, so the sort is a total order. The returned
// alerts' Labels/Annotations/Receivers/etc. are shared with the store's
// internal copies (shallow struct copy only) — treat them as read-only.
func (s *AlertStore) Get() []models.EnrichedAlert {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.snapshotLocked()
}

// snapshotLocked builds the same ordered copy as Get(). Callers must already
// hold s.mu (read or write) — never call Get() itself while holding the
// write lock, its own RLock would deadlock.
func (s *AlertStore) snapshotLocked() []models.EnrichedAlert {
	result := make([]models.EnrichedAlert, len(s.alerts))
	copy(result, s.alerts)
	for _, entry := range s.resolvedBuffer { // nil-map range is safe in Go
		result = append(result, entry.alert)
	}
	sort.Slice(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if !a.StartsAt.Equal(b.StartsAt) {
			return a.StartsAt.After(b.StartsAt)
		}
		if a.Fingerprint != b.Fingerprint {
			return a.Fingerprint < b.Fingerprint
		}
		return a.ClusterName < b.ClusterName
	})
	return result
}

// bumpVersionLocked marks the cached JSON encoding stale. Callers must hold
// s.mu (write lock) — every mutation that changes what Get() would return
// calls this exactly once.
func (s *AlertStore) bumpVersionLocked() {
	s.version++
	s.cacheValid = false
}

// EncodedSnapshot returns the current alert list already JSON-encoded as an
// array, plus the version it was built from. The bytes are never mutated
// after being cached, so they are safe to share across concurrent callers
// (an HTTP response body, a WS envelope) without copying. Rebuilt only when
// the store changed since the last call.
func (s *AlertStore) EncodedSnapshot() ([]byte, uint64, error) {
	s.mu.RLock()
	if s.cacheValid && s.cachedVersion == s.version {
		data, version := s.cachedJSON, s.version
		s.mu.RUnlock()
		return data, version, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cacheValid && s.cachedVersion == s.version {
		return s.cachedJSON, s.version, nil
	}
	data, err := json.Marshal(s.snapshotLocked())
	if err != nil {
		return nil, 0, err
	}
	s.cachedJSON = data
	s.cachedVersion = s.version
	s.cacheValid = true
	return s.cachedJSON, s.version, nil
}

// SetActiveClaim patches the active claim for a specific alert (fingerprint +
// cluster). The claim is cloned (cloneClaim) so the caller mutating it
// afterward never affects the store. A no-op (alert not found) never bumps
// the cache version.
func (s *AlertStore) SetActiveClaim(fingerprint, clusterName string, claim *models.Claim) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.alerts {
		if s.alerts[i].Fingerprint == fingerprint && s.alerts[i].ClusterName == clusterName {
			s.alerts[i].ActiveClaim = cloneClaim(claim)
			s.bumpVersionLocked()
			return
		}
	}
}

// ClearActiveClaim removes the active claim for a specific alert (fingerprint
// + cluster). A no-op (alert not found) never bumps the cache version.
func (s *AlertStore) ClearActiveClaim(fingerprint, clusterName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.alerts {
		if s.alerts[i].Fingerprint == fingerprint && s.alerts[i].ClusterName == clusterName {
			s.alerts[i].ActiveClaim = nil
			s.bumpVersionLocked()
			return
		}
	}
}

// MarkResolved moves the alert to the resolved buffer so it stays visible for
// 20 minutes after disappearing from Alertmanager. Clears its active claim.
// The resolved buffer is NOT overwritten by Set, so the entry survives the next poll.
func (s *AlertStore) MarkResolvedForCluster(fingerprint, clusterName string) {
	s.MarkResolvedForClusterAt(fingerprint, clusterName, s.currentTime())
}

func (s *AlertStore) MarkResolvedForClusterAt(fingerprint, clusterName string, resolvedAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	resolvedAt = resolvedAt.UTC()
	for i, a := range s.alerts {
		if a.Fingerprint == fingerprint && a.ClusterName == clusterName {
			resolved := a
			resolved.Status.State = "resolved"
			resolved.ActiveClaim = nil
			resolved.EndsAt = resolvedAt
			resolved.UpdatedAt = resolvedAt
			if s.resolvedBuffer == nil {
				s.resolvedBuffer = make(map[string]resolvedEntry)
			}
			s.resolvedBuffer[alertSnapshotKey(fingerprint, clusterName)] = resolvedEntry{
				alert: resolved, expiresAt: resolvedAt.Add(ResolvedBufferTTL),
			}
			s.alerts = append(s.alerts[:i], s.alerts[i+1:]...)
			s.bumpVersionLocked()
			return
		}
	}
}

// MarkResolved keeps backward compatibility for tests and legacy single-cluster callers.
func (s *AlertStore) MarkResolved(fingerprint string) {
	s.markResolvedAt(fingerprint, s.currentTime())
}

func (s *AlertStore) markResolvedAt(fingerprint string, resolvedAt time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	resolvedAt = resolvedAt.UTC()
	for i, a := range s.alerts {
		if a.Fingerprint == fingerprint {
			resolved := a
			resolved.Status.State = "resolved"
			resolved.ActiveClaim = nil
			resolved.EndsAt = resolvedAt
			resolved.UpdatedAt = resolvedAt
			if s.resolvedBuffer == nil {
				s.resolvedBuffer = make(map[string]resolvedEntry)
			}
			s.resolvedBuffer[alertSnapshotKey(a.Fingerprint, a.ClusterName)] = resolvedEntry{
				alert: resolved, expiresAt: resolvedAt.Add(ResolvedBufferTTL),
			}
			s.alerts = append(s.alerts[:i], s.alerts[i+1:]...)
			s.bumpVersionLocked()
			return
		}
	}
}

// SeedResolved pre-populates the resolved buffer from persistent storage (e.g. on
// startup). Entries already present are not overwritten. No removal timer is
// scheduled — seeded alerts stay visible until they reappear as active (Set clears them).
func (s *AlertStore) SeedResolved(alerts []models.EnrichedAlert) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.currentTime()
	for _, a := range alerts {
		s.seedResolvedLocked(cloneEnrichedAlert(a), now)
	}
}

// seedResolvedLocked expects a already owned by the store (cloned by the
// caller if it came from outside) — it stores a as-is, no further copy.
func (s *AlertStore) seedResolvedLocked(a models.EnrichedAlert, now time.Time) {
	if a.Status.State != "resolved" || a.EndsAt.IsZero() {
		return
	}
	key := alertSnapshotKey(a.Fingerprint, a.ClusterName)
	for _, active := range s.alerts {
		if alertSnapshotKey(active.Fingerprint, active.ClusterName) == key {
			return
		}
	}
	expiresAt := a.EndsAt.UTC().Add(ResolvedBufferTTL)
	if !expiresAt.After(now) {
		return
	}
	if existing, exists := s.resolvedBuffer[key]; exists && !a.EndsAt.After(existing.alert.EndsAt) {
		return
	}
	if s.resolvedBuffer == nil {
		s.resolvedBuffer = make(map[string]resolvedEntry)
	}
	a.EndsAt = a.EndsAt.UTC()
	a.UpdatedAt = a.EndsAt
	s.resolvedBuffer[key] = resolvedEntry{alert: a, expiresAt: expiresAt}
	s.bumpVersionLocked()
}

func (s *AlertStore) ExpireResolved(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for key, entry := range s.resolvedBuffer {
		if !entry.expiresAt.After(now) {
			delete(s.resolvedBuffer, key)
			changed = true
		}
	}
	if changed {
		s.bumpVersionLocked()
	}
	return changed
}

// RemoveResolvedForCluster removes only the resolved-buffer entry for an
// alert, leaving the active list untouched. Used by the recorder's 20-minute
// removal timer: if the alert re-fired in the meantime, Set() already moved
// it back into the active list (and cleared its buffer entry), so by the
// time this timer fires there is normally nothing left to do here — but if
// it re-fired *after* the timer's 20-minute wait already started, deleting
// it by fingerprint+cluster from both places (as an earlier version of this
// method did) would wrongly remove it from the active list too.
func (s *AlertStore) RemoveResolvedForCluster(fingerprint, clusterName string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := alertSnapshotKey(fingerprint, clusterName)
	if _, exists := s.resolvedBuffer[key]; !exists {
		return
	}
	delete(s.resolvedBuffer, key)
	s.bumpVersionLocked()
}

// RemoveByFingerprint keeps backward compatibility for tests and legacy single-cluster callers.
func (s *AlertStore) RemoveByFingerprint(fingerprint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	filtered := s.alerts[:0]
	for _, a := range s.alerts {
		if a.Fingerprint != fingerprint {
			filtered = append(filtered, a)
		} else {
			changed = true
		}
	}
	s.alerts = append([]models.EnrichedAlert(nil), filtered...)
	for key, entry := range s.resolvedBuffer {
		if entry.alert.Fingerprint == fingerprint {
			delete(s.resolvedBuffer, key)
			changed = true
		}
	}
	if changed {
		s.bumpVersionLocked()
	}
}

// cloneEnrichedAlert deep-copies the reference-typed fields of an incoming
// alert (Labels, Annotations, Receivers, SeenOn, Status slices, ActiveClaim)
// so the store never aliases a caller's map/slice — mutating the caller's
// original afterward cannot affect what's stored.
func cloneEnrichedAlert(a models.EnrichedAlert) models.EnrichedAlert {
	if a.Labels != nil {
		labels := make(map[string]string, len(a.Labels))
		maps.Copy(labels, a.Labels)
		a.Labels = labels
	}
	if a.Annotations != nil {
		annotations := make(map[string]string, len(a.Annotations))
		maps.Copy(annotations, a.Annotations)
		a.Annotations = annotations
	}
	if a.Receivers != nil {
		a.Receivers = cloneSlice(a.Receivers)
	}
	if a.SeenOn != nil {
		a.SeenOn = cloneSlice(a.SeenOn)
	}
	if a.Status.InhibitedBy != nil {
		a.Status.InhibitedBy = cloneSlice(a.Status.InhibitedBy)
	}
	if a.Status.SilencedBy != nil {
		a.Status.SilencedBy = cloneSlice(a.Status.SilencedBy)
	}
	a.ActiveClaim = cloneClaim(a.ActiveClaim)
	return a
}

// cloneSlice copies s into a fresh backing array. Unlike
// append([]T(nil), s...), which collapses a non-nil empty s back to nil
// (append returns its destination unchanged when there's nothing to add),
// this preserves non-nil-emptiness — required so a non-nil empty
// Status.SilencedBy/InhibitedBy (guaranteed by cluster.enrichMerged so the
// API always sends JSON [] instead of null) survives Set()'s clone instead of
// silently reverting to null and crashing frontend code that iterates it
// unconditionally.
func cloneSlice[T any](s []T) []T {
	return append([]T{}, s...)
}

// cloneClaim deep-copies a Claim, including its two optional pointer fields,
// so the store never aliases a caller's Claim value.
func cloneClaim(c *models.Claim) *models.Claim {
	if c == nil {
		return nil
	}
	clone := *c
	if c.EventID != nil {
		id := *c.EventID
		clone.EventID = &id
	}
	if c.ReleasedAt != nil {
		t := *c.ReleasedAt
		clone.ReleasedAt = &t
	}
	return &clone
}
