package cluster

import "github.com/kj187/jarvis/backend/internal/alertmanager"

// mergedAlert is one deduplicated alert produced by mergeAlerts: the freshest
// copy across all members that reported it, plus which members saw it.
type mergedAlert struct {
	alert  alertmanager.GettableAlert
	source string   // member name that provided alert (newest UpdatedAt)
	seenOn []string // member names that reported this fingerprint, config order
}

// mergeAlerts deduplicates alerts fetched from multiple HA members by
// fingerprint. Union semantics: an alert reported by any member is kept —
// there is no intersection/quorum requirement. When a fingerprint is reported
// by more than one member, the copy with the newest UpdatedAt wins (freshest
// state wins, covers gossip lag on silence state). order controls both the
// output ordering (first-seen-by-fingerprint, config order) and SeenOn
// ordering.
func mergeAlerts(byMember map[string][]alertmanager.GettableAlert, order []string) []mergedAlert {
	index := make(map[string]int, 16)
	var result []mergedAlert
	for _, memberName := range order {
		for _, a := range byMember[memberName] {
			if idx, ok := index[a.Fingerprint]; ok {
				result[idx].seenOn = append(result[idx].seenOn, memberName)
				if a.UpdatedAt.After(result[idx].alert.UpdatedAt) {
					result[idx].alert = a
					result[idx].source = memberName
				}
				continue
			}
			index[a.Fingerprint] = len(result)
			result = append(result, mergedAlert{alert: a, source: memberName, seenOn: []string{memberName}})
		}
	}
	return result
}

// mergeSilences deduplicates silences fetched from multiple HA members by ID
// (gossip replicates silences between members, so IDs agree). Union
// semantics, like mergeAlerts; the copy with the newest UpdatedAt wins.
func mergeSilences(byMember map[string][]alertmanager.GettableSilence, order []string) []alertmanager.GettableSilence {
	index := make(map[string]int, 16)
	var result []alertmanager.GettableSilence
	for _, memberName := range order {
		for _, s := range byMember[memberName] {
			if idx, ok := index[s.ID]; ok {
				if s.UpdatedAt.After(result[idx].UpdatedAt) {
					result[idx] = s
				}
				continue
			}
			index[s.ID] = len(result)
			result = append(result, s)
		}
	}
	return result
}
