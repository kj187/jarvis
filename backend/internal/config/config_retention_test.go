package config

import (
	"testing"
	"time"
)

func clearRetentionEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"JARVIS_RETENTION_DAYS",
		"JARVIS_RETENTION_EVENTS_DAYS",
		"JARVIS_RETENTION_CLAIMS_DAYS",
		"JARVIS_RETENTION_SILENCE_EVENTS_DAYS",
		"JARVIS_RETENTION_COMMENTS_DAYS",
		"JARVIS_RETENTION_SWEEP_INTERVAL",
	} {
		t.Setenv(key, "")
	}
}

func TestLoad_Retention_Defaults(t *testing.T) {
	clearRetentionEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Retention.Days != 0 {
		t.Errorf("Retention.Days = %d, want 0", cfg.Retention.Days)
	}
	if cfg.Retention.EventsDays != 0 {
		t.Errorf("Retention.EventsDays = %d, want 0", cfg.Retention.EventsDays)
	}
	if cfg.Retention.ClaimsDays != 0 {
		t.Errorf("Retention.ClaimsDays = %d, want 0", cfg.Retention.ClaimsDays)
	}
	if cfg.Retention.SilenceEventsDays != 0 {
		t.Errorf("Retention.SilenceEventsDays = %d, want 0", cfg.Retention.SilenceEventsDays)
	}
	if cfg.Retention.CommentsDays != 0 {
		t.Errorf("Retention.CommentsDays = %d, want 0", cfg.Retention.CommentsDays)
	}
	if cfg.Retention.SweepInterval != 12*time.Hour {
		t.Errorf("Retention.SweepInterval = %v, want 12h", cfg.Retention.SweepInterval)
	}

	// Default config must disable everything, including comments.
	if cfg.Retention.EffectiveEventsDays() != 0 {
		t.Errorf("EffectiveEventsDays() = %d, want 0", cfg.Retention.EffectiveEventsDays())
	}
	if cfg.Retention.EffectiveClaimsDays() != 0 {
		t.Errorf("EffectiveClaimsDays() = %d, want 0", cfg.Retention.EffectiveClaimsDays())
	}
	if cfg.Retention.EffectiveSilenceEventsDays() != 0 {
		t.Errorf("EffectiveSilenceEventsDays() = %d, want 0", cfg.Retention.EffectiveSilenceEventsDays())
	}
	if cfg.Retention.EffectiveCommentsDays() != 0 {
		t.Errorf("EffectiveCommentsDays() = %d, want 0", cfg.Retention.EffectiveCommentsDays())
	}
	if cfg.Retention.Enabled() {
		t.Error("Enabled() = true, want false (fully disabled by default)")
	}
}

func TestLoad_Retention_GlobalInheritance(t *testing.T) {
	clearRetentionEnv(t)
	t.Setenv("JARVIS_RETENTION_DAYS", "30")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// Events/claims/silence-events inherit the global value.
	if got := cfg.Retention.EffectiveEventsDays(); got != 30 {
		t.Errorf("EffectiveEventsDays() = %d, want 30", got)
	}
	if got := cfg.Retention.EffectiveClaimsDays(); got != 30 {
		t.Errorf("EffectiveClaimsDays() = %d, want 30", got)
	}
	if got := cfg.Retention.EffectiveSilenceEventsDays(); got != 30 {
		t.Errorf("EffectiveSilenceEventsDays() = %d, want 30", got)
	}
	// Comments NEVER inherit the global value.
	if got := cfg.Retention.EffectiveCommentsDays(); got != 0 {
		t.Errorf("EffectiveCommentsDays() = %d, want 0 (comments never inherit global)", got)
	}
	if !cfg.Retention.Enabled() {
		t.Error("Enabled() = false, want true")
	}
}

func TestLoad_Retention_PerDomainOverride(t *testing.T) {
	clearRetentionEnv(t)
	t.Setenv("JARVIS_RETENTION_DAYS", "0")
	t.Setenv("JARVIS_RETENTION_EVENTS_DAYS", "90")
	t.Setenv("JARVIS_RETENTION_CLAIMS_DAYS", "7")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	// An override > 0 applies even when the global is 0 (selective retention).
	if got := cfg.Retention.EffectiveEventsDays(); got != 90 {
		t.Errorf("EffectiveEventsDays() = %d, want 90", got)
	}
	if got := cfg.Retention.EffectiveClaimsDays(); got != 7 {
		t.Errorf("EffectiveClaimsDays() = %d, want 7", got)
	}
	// Silence events has no override and global is 0 → stays disabled.
	if got := cfg.Retention.EffectiveSilenceEventsDays(); got != 0 {
		t.Errorf("EffectiveSilenceEventsDays() = %d, want 0", got)
	}
	if !cfg.Retention.Enabled() {
		t.Error("Enabled() = false, want true (events override active)")
	}
}

func TestLoad_Retention_CommentsExplicitOptIn(t *testing.T) {
	clearRetentionEnv(t)
	t.Setenv("JARVIS_RETENTION_DAYS", "30")
	t.Setenv("JARVIS_RETENTION_COMMENTS_DAYS", "180")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if got := cfg.Retention.EffectiveCommentsDays(); got != 180 {
		t.Errorf("EffectiveCommentsDays() = %d, want 180 (explicit opt-in)", got)
	}
}

func TestLoad_Retention_SweepInterval(t *testing.T) {
	clearRetentionEnv(t)
	t.Setenv("JARVIS_RETENTION_SWEEP_INTERVAL", "1h")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if cfg.Retention.SweepInterval != time.Hour {
		t.Errorf("SweepInterval = %v, want 1h", cfg.Retention.SweepInterval)
	}
}

func TestLoad_Retention_InvalidSweepInterval(t *testing.T) {
	clearRetentionEnv(t)
	t.Setenv("JARVIS_RETENTION_SWEEP_INTERVAL", "not-a-duration")

	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want error for invalid JARVIS_RETENTION_SWEEP_INTERVAL")
	}
}

func TestLoad_Retention_NegativeValues(t *testing.T) {
	cases := []string{
		"JARVIS_RETENTION_DAYS",
		"JARVIS_RETENTION_EVENTS_DAYS",
		"JARVIS_RETENTION_CLAIMS_DAYS",
		"JARVIS_RETENTION_SILENCE_EVENTS_DAYS",
		"JARVIS_RETENTION_COMMENTS_DAYS",
	}
	for _, key := range cases {
		t.Run(key, func(t *testing.T) {
			clearRetentionEnv(t)
			t.Setenv(key, "-1")
			if _, err := Load(); err == nil {
				t.Fatalf("Load() error = nil, want error for negative %s", key)
			}
		})
	}
}

func TestLoad_Retention_NonIntegerValue(t *testing.T) {
	clearRetentionEnv(t)
	t.Setenv("JARVIS_RETENTION_DAYS", "not-a-number")
	if _, err := Load(); err == nil {
		t.Fatal("Load() error = nil, want error for non-integer JARVIS_RETENTION_DAYS")
	}
}
