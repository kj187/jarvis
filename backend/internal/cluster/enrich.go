package cluster

import (
	"strings"

	"github.com/kj187/jarvis/backend/internal/models"
)

// enrichMerged maps deduplicated alerts to EnrichedAlert, injecting the
// cluster metadata, the synthetic "@receiver" label (comma-separated list of
// receiver names) used for filtering, the winning member's link URL, and
// SeenOn. It is a pure function so it can be unit tested and benchmarked
// without an HTTP round-trip.
//
// The receiver names are gathered in a single pass that builds both the
// Receivers slice and the "@receiver" join string, avoiding a second loop and
// a throwaway slice per alert — this matters when enriching large alert sets.
func enrichMerged(merged []mergedAlert, clusterName string, linkURLByMember map[string]string) []models.EnrichedAlert {
	enriched := make([]models.EnrichedAlert, 0, len(merged))
	for i := range merged {
		m := &merged[i]
		a := &m.alert

		receivers := make([]models.Receiver, len(a.Receivers))
		var receiverList strings.Builder
		for j, rcv := range a.Receivers {
			receivers[j] = models.Receiver{Name: rcv.Name}
			if j > 0 {
				receiverList.WriteByte(',')
			}
			receiverList.WriteString(rcv.Name)
		}

		labelCount := len(a.Labels)
		if len(a.Receivers) > 0 {
			labelCount++
		}
		labels := make(map[string]string, labelCount)
		for k, v := range a.Labels {
			labels[k] = v
		}
		// Store all receivers as comma-separated list for filtering.
		// This allows filters to match any receiver that handles this alert.
		if len(a.Receivers) > 0 {
			labels["@receiver"] = receiverList.String()
		}

		enriched = append(enriched, models.EnrichedAlert{
			Fingerprint: a.Fingerprint,
			Status: models.AlertStatus{
				InhibitedBy: a.Status.InhibitedBy,
				SilencedBy:  a.Status.SilencedBy,
				State:       a.Status.State,
			},
			Labels:          labels,
			Annotations:     a.Annotations,
			StartsAt:        a.StartsAt,
			EndsAt:          a.EndsAt,
			UpdatedAt:       a.UpdatedAt,
			GeneratorURL:    a.GeneratorURL,
			Receivers:       receivers,
			ClusterName:     clusterName,
			AlertmanagerURL: linkURLByMember[m.source],
			SeenOn:          m.seenOn,
		})
	}
	return enriched
}
