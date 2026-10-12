package history

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"
)

// seedResolvedPlanFixture bulk-inserts episodes with several events each, so
// a "latest event per episode" read has real work to do: two out of three
// episodes end resolved, the third re-fired and must not be returned.
func seedResolvedPlanFixture(t *testing.T, store *Store, episodes, eventsPerEpisode int) {
	t.Helper()
	ctx := context.Background()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin fixture: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	const batch = 100
	base := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	labels := `{"alertname":"PlanAlert","pad":"` + strings.Repeat("x", 600) + `"}`
	insert := func(prefix, row string, args []interface{}, rows int) {
		if rows == 0 {
			return
		}
		query := prefix + strings.TrimSuffix(strings.Repeat(row+",", rows), ",")
		if _, err := store.execOn(tx, ctx, query, args...); err != nil {
			t.Fatalf("insert fixture rows: %v", err)
		}
	}

	args := make([]interface{}, 0, batch*4)
	for i := 0; i < episodes; i++ {
		args = append(args, planFingerprint(i), labels, base, base)
		if (i+1)%batch == 0 || i == episodes-1 {
			insert(`INSERT INTO alert_fingerprints
				(fingerprint, alertname, cluster_name, labels, first_seen_at, last_seen_at, occurrence_count) VALUES `,
				`(?, 'PlanAlert', 'cluster-a', ?, ?, ?, 1)`, args, len(args)/4)
			args = args[:0]
		}
	}
	for round := 0; round < eventsPerEpisode; round++ {
		for i := 0; i < episodes; i++ {
			// Alternate so the newest round is resolved, except for every
			// third episode, which ends firing.
			status := "firing"
			if (eventsPerEpisode-1-round)%2 == 0 && (i%3 != 0 || round != eventsPerEpisode-1) {
				status = "resolved"
			}
			recordedAt := base.Add(time.Duration(round*episodes+i) * time.Second)
			args = append(args, planFingerprint(i), status, recordedAt, recordedAt)
			if len(args) == batch*4 || i == episodes-1 {
				insert(`INSERT INTO alert_events
					(fingerprint, cluster_name, alertmanager_url, status, starts_at, annotations, recorded_at) VALUES `,
					`(?, 'cluster-a', 'http://am', ?, ?, '{"summary":"plan"}', ?)`, args, len(args)/4)
				args = args[:0]
			}
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit fixture: %v", err)
	}
}

func planFingerprint(i int) string {
	return fmt.Sprintf("%016x", i+1)
}

// postgresTempBlocks runs query under a work_mem far below the fixture size
// and returns how many temp-file blocks the executor wrote, plus the plan.
func postgresTempBlocks(t *testing.T, store *Store, query string, args ...interface{}) (int64, string) {
	t.Helper()
	ctx := context.Background()
	tx, err := store.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `SET LOCAL work_mem = '64kB'`); err != nil {
		t.Fatalf("set work_mem: %v", err)
	}
	var raw string
	explain := rebind(store.dialect, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) `+query)
	if err := tx.QueryRowContext(ctx, explain, args...).Scan(&raw); err != nil {
		t.Fatalf("explain: %v", err)
	}
	var plans []struct {
		Plan struct {
			TempWritten int64 `json:"Temp Written Blocks"`
		} `json:"Plan"`
	}
	if err := json.Unmarshal([]byte(raw), &plans); err != nil || len(plans) != 1 {
		t.Fatalf("decode plan (%v): %s", err, raw)
	}
	return plans[0].Plan.TempWritten, raw
}

// The Resolved page is polled by every open tab. On a small PostgreSQL
// instance a read that spills to temp files turns each poll into disk I/O,
// so these reads must stay in memory however low work_mem is and whether or
// not the table was vacuumed: a page, its total, one cluster's page and
// total, and the startup seed of the resolved buffer.
func TestResolvedReads_PostgresWriteNoTempFiles(t *testing.T) {
	store := newTestPostgresStores(t, 1)[0]
	seedResolvedPlanFixture(t, store, 3000, 3)
	if _, err := store.db.ExecContext(context.Background(), `ANALYZE alert_events`); err != nil {
		t.Fatalf("analyze: %v", err)
	}

	type read struct {
		name  string
		query string
		args  []interface{}
	}
	var reads []read
	for _, pageQuery := range []ResolvedPageQuery{{}, {Cluster: "cluster-a"}} {
		name := "all clusters"
		if pageQuery.Cluster != "" {
			name = "one cluster"
		}
		rowsSQL, rowsArgs := resolvedRowsSQL(pageQuery)
		reads = append(reads, read{name + ": page", rowsSQL + " LIMIT ? OFFSET ?", append(rowsArgs, 25, 0)})
		countSQL, countArgs := resolvedCountSQL(pageQuery)
		reads = append(reads, read{name + ": total", countSQL, countArgs})
	}
	// The seed read has no LIMIT and sorts what its window returns, so only
	// a window with a handful of episodes fits this work_mem. What matters
	// is that the rest of the table costs it nothing.
	newest := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC).Add(9000 * time.Second)
	visitSQL, visitArgs := resolvedVisitSQL(ResolvedReadQuery{After: newest.Add(-20 * time.Second), Through: newest})
	reads = append(reads, read{"buffer seed window", visitSQL, visitArgs})

	for _, r := range reads {
		if blocks, plan := postgresTempBlocks(t, store, r.query, r.args...); blocks != 0 {
			t.Errorf("%s wrote %d temp blocks, want 0; plan:\n%s", r.name, blocks, plan)
		}
	}
}

func sqliteQueryPlan(t *testing.T, store *Store, query string, args ...interface{}) string {
	t.Helper()
	rows, err := store.query(context.Background(), `EXPLAIN QUERY PLAN `+query, args...)
	if err != nil {
		t.Fatalf("explain query plan: %v", err)
	}
	defer func() { _ = rows.Close() }()
	var plan strings.Builder
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatalf("scan plan: %v", err)
		}
		plan.WriteString(detail + "\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("plan rows: %v", err)
	}
	return plan.String()
}

func TestResolvedPage_SQLiteReadsThroughEpisodeIndexes(t *testing.T) {
	rec, _ := newTestRecorder(t)
	seedResolvedPlanFixture(t, rec.store, 200, 3)
	if _, err := rec.store.exec(context.Background(), `ANALYZE`); err != nil {
		t.Fatalf("analyze: %v", err)
	}

	rowsSQL, rowsArgs := resolvedRowsSQL(ResolvedPageQuery{})
	plan := sqliteQueryPlan(t, rec.store, rowsSQL+" LIMIT ? OFFSET ?", append(rowsArgs, 25, 0)...)
	for _, index := range []string{"idx_alert_events_resolved_recorded", "idx_alert_events_episode"} {
		if !strings.Contains(plan, index) {
			t.Errorf("page plan does not use %s:\n%s", index, plan)
		}
	}
	if strings.Contains(plan, "TEMP B-TREE") {
		t.Errorf("page plan sorts or groups in a temp b-tree:\n%s", plan)
	}

	countSQL, countArgs := resolvedCountSQL(ResolvedPageQuery{})
	plan = sqliteQueryPlan(t, rec.store, countSQL, countArgs...)
	if !strings.Contains(plan, "idx_alert_events_episode") || strings.Contains(plan, "TEMP B-TREE") {
		t.Errorf("count plan does not probe idx_alert_events_episode:\n%s", plan)
	}
}

// seedResolvedMixedEpisodes covers every way an episode can end, including
// one fingerprint whose two clusters end differently.
func seedResolvedMixedEpisodes(t *testing.T, store *Store) {
	t.Helper()
	base := time.Date(2026, 9, 17, 10, 0, 0, 0, time.UTC)
	step := 0
	for _, episode := range []struct {
		fingerprint, cluster string
		statuses             []string
	}{
		{"resolved-once", "cluster-a", []string{"firing", "resolved"}},
		{"refired", "cluster-a", []string{"firing", "resolved", "firing"}},
		{"resolved-twice", "cluster-a", []string{"firing", "resolved", "firing", "resolved"}},
		{"only-firing", "cluster-a", []string{"firing"}},
		{"suppressed-last", "cluster-b", []string{"firing", "resolved", "suppressed"}},
		{"two-clusters", "cluster-a", []string{"firing", "resolved"}},
		{"two-clusters", "cluster-b", []string{"firing", "resolved", "firing"}},
		{"both-resolved", "cluster-a", []string{"firing", "resolved"}},
		{"both-resolved", "cluster-b", []string{"firing", "resolved"}},
	} {
		for _, status := range episode.statuses {
			step++
			insertResolvedTestEvent(t, store, episode.fingerprint, episode.cluster, status, base.Add(time.Duration(step)*time.Minute))
		}
	}
}

// The page rows and the page total are two queries. They must describe the
// same set for every filter, on data where episodes re-fired.
func assertResolvedPageMatchesTotal(t *testing.T, store *Store) {
	t.Helper()
	for _, tc := range []struct {
		name  string
		query ResolvedPageQuery
		want  []string
		total int64
	}{
		{"no filter", ResolvedPageQuery{}, []string{
			"both-resolved/cluster-a", "both-resolved/cluster-b", "resolved-once/cluster-a",
			"resolved-twice/cluster-a", "two-clusters/cluster-a",
		}, 5},
		{"cluster a", ResolvedPageQuery{Cluster: "cluster-a"}, []string{
			"both-resolved/cluster-a", "resolved-once/cluster-a", "resolved-twice/cluster-a", "two-clusters/cluster-a",
		}, 4},
		{"cluster b", ResolvedPageQuery{Cluster: "cluster-b"}, []string{"both-resolved/cluster-b"}, 1},
		{"fingerprint in two clusters, one resolved", ResolvedPageQuery{Fingerprint: "two-clusters"},
			[]string{"two-clusters/cluster-a"}, 1},
		{"fingerprint and cluster, re-fired", ResolvedPageQuery{Fingerprint: "two-clusters", Cluster: "cluster-b"}, nil, 0},
		{"fingerprint resolved in two clusters", ResolvedPageQuery{Fingerprint: "both-resolved"},
			[]string{"both-resolved/cluster-a", "both-resolved/cluster-b"}, 1}, // detail total is capped at 1
		{"re-fired fingerprint", ResolvedPageQuery{Fingerprint: "refired"}, nil, 0},
	} {
		tc.query.Limit = 100
		page, err := store.GetResolvedPage(context.Background(), tc.query)
		if err != nil {
			t.Fatalf("%s: GetResolvedPage: %v", tc.name, err)
		}
		got := make([]string, 0, len(page.Alerts))
		for _, alert := range page.Alerts {
			got = append(got, alert.Fingerprint+"/"+alert.ClusterName)
		}
		sort.Strings(got)
		if strings.Join(got, ",") != strings.Join(tc.want, ",") || page.Total != tc.total {
			t.Errorf("%s: rows %v total %d, want rows %v total %d", tc.name, got, page.Total, tc.want, tc.total)
		}
	}
}

func TestGetResolvedPage_RowsMatchTotalOnMixedEpisodes(t *testing.T) {
	rec, _ := newTestRecorder(t)
	seedResolvedMixedEpisodes(t, rec.store)
	assertResolvedPageMatchesTotal(t, rec.store)
}

func TestGetResolvedPage_RowsMatchTotalOnMixedEpisodes_Postgres(t *testing.T) {
	store := newTestPostgresStores(t, 1)[0]
	seedResolvedMixedEpisodes(t, store)
	assertResolvedPageMatchesTotal(t, store)
}
