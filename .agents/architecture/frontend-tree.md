# Jarvis Architecture — Frontend Tree: shell, stores, hooks, lib

Part of the architecture reference — start at `.agents/architecture.md` (index). Base rules and critical invariants live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

---

## Frontend Component Tree (`frontend/src/`)

```
main.tsx              → ReactDOM.createRoot, QueryClient (query defaults set here), authStore.hydrate(), App
App.tsx               → auth-gated shell: SetupPage / LoginPage (full_protect) / RootLayout; applies theme
index.css             → self-hosted Inter (`public/fonts/inter-variable-latin.woff2`, SIL OFL, licence beside it; `--font-sans`/`--font-mono` stacks); colour tokens are GENERATED into `generated/tokens.css` (imported here) from `design/tokens.json` by `scripts/design-tokens.mjs`, which also writes the docs-site and video palettes; Tailwind v4 `@theme` tokens (dark default) + `[data-theme="light"]` overrides — incl. status roles `critical|warning|info|neutral|success|attention|claim` × `-fg|-soft|-edge|-solid` and `selected`, radius roles `rounded-compact|control|surface|overlay|pill`; `dark:` is bound to `data-theme` via `@custom-variant`, global
                        pointer-cursor rule, `prefers-reduced-motion` rule (transitions ≈ 0, ping/pulse/claim-snake
                        off, `animate-spin` kept). Accessibility-relevant tokens: `--color-ring` (focus ring, >= 3:1
                        vs. every surface, 2px via `focus(-visible):ring-2`) and `--color-control` (edge of text
                        fields/selects, `border-control`; also the off-state track of toggles, `bg-control`; >= 3:1). `--color-border` stays the quiet edge for
                        cards/header/tables. Both pairs are guarded by `lib/themeTokens.test.ts`
├── api/client.ts     → All fetch wrappers (alerts, silences, templates, claims, comments, auth, admin, poll, clusters)
├── store/
│   ├── uiStore.ts            → Zustand+persist('jarvis-ui'): nav page, view modes, filters, fullscreen, counts
│   ├── authStore.ts          → user, providerInfo, hydrate() (retries on slow backend), login/logout;
│   │                            `requestLogin()` (promise: true after login, false when dismissed — one
│   │                            shared prompt for concurrent callers) + `loginPromptOpen`, `sessionExpired`,
│   │                            `expireSession()`; registers the 401 handler of api/client.ts
│   └── useSettingsStore.ts   → Zustand+persist('jarvis-user-settings', v3): resolved user preferences
│                                + sparse overrides — local (anon) or server (account) storage,
│                                see "Settings Store" in `frontend-state.md`; types/logic live in lib/settingsUtils.ts
├── types/index.ts    → Alert, Silence, Claim, Comment, AlertEvent, AlertStats, SilenceEvent,
│                        SilenceTemplate, LabelMatcher, AuthUser, ProviderInfo, AdminUser,
│                        SettingsResponse, HeatmapRange, AlertHeatmapResponse, ...
├── hooks/
│   ├── useAlerts.ts           → useAlerts(params, {enabled}) plus bounded useResolvedAlertsPage and
│   │                            useResolvedAlertDetail; both resolved hooks forward TanStack's
│   │                            AbortSignal, use a short `staleTime` + gcTime 0, retry 5xx once and never
│   │                            retry 4xx. Page queries retain previous data only for a pure offset
│   │                            change; their keys include the complete server filter/page input.
│   │                            useAlertGroups, useAlertHistory, useAlertTimeline,
│   │                            useAlertStats, useAlertHeatmap (longer `staleTime`; enabled unconditionally
│   │                            — both AlertDetailPanel and every AlertCard entry query it),
│   │                            useRefreshAlerts
│   ├── useAlertCounts.ts      → active/suppressed counts + silence count for nav badges; deliberately
│   │                            never loads resolved history (there is no resolved badge)
│   ├── useHoverPopover.ts     → useHoverPopover(open, setOpen): the behaviour behind `components/ui/popover.tsx` — wiring for the Header's
│   │                            desktop popovers (cluster status, refresh hint, info, user menu).
│   │                            Hover opens (delayed close), `wrapperProps` add Escape → close +
│   │                            focus back to the `data-popover-trigger`, focus-out → close;
│   │                            `triggerProps` add `aria-expanded` and Enter/Space toggle. Hover
│   │                            is never the only way in — keep that when adding a popover
│   ├── useAlertComments.ts    → useAlertComments(fingerprint, cluster, page), useAddComment,
│   │                            useDeleteComment (all cluster-scoped); page size `COMMENTS_PAGE_SIZE` (exported by the hook);
│   │                            query key `['comments', fingerprint, clusterName, page]`
│   ├── useAlertClaim.ts       → useActiveClaim, useClaimHistory, useSetClaim, useReleaseClaim,
│   │                            useUpdateClaimNote, useClaimController (all cluster-scoped); USERNAME_KEY
│   ├── useSilences.ts         → useSilences, useSilenceEvents, useUpsertSilence, useDeleteSilence,
│   │                            useAckAlert (one-click Fast-Silence → short-lived exact-match silence),
│   │                            useExtendSilences (one-click extend: same-id upsert, endsAt += duration),
│   │                            resolveCreatorName
│   ├── useSilenceTemplates.ts → list + create/update/delete template mutations
│   ├── useWebSocket.ts        → WS connection + cache patching via handleEvent();
│   │                            invalidates ALL queries on every (re)connect (WS has no replay);
│   │                            reconnect delay is jittered (`getReconnectDelay`) so many tabs
│   │                            do not retry in lockstep;
│   │                            wsRef.current === ws guards every socket callback so a stale/
│   │                            superseded socket's late event starts no duplicate timer/refetch
│   ├── useProtectedAction.ts  → wraps a write action: `execute()` = requestLogin() then action (no modal state)
│   ├── useLoginGuard.ts       → `guard(action)` = requestLogin() then action; one hook covers many actions
│   ├── useFormatTime.ts       → relative/absolute timestamp formatter (from settings)
│   ├── useSettingsSync.ts     → mounted once in App.tsx; the only place deciding local vs.
│   │                            server settings storage and the only reader of the instance
│   │                            defaults (`global`) — see "Settings Store" in `frontend-state.md`
│   └── useVersion.ts          → app version (staleTime Infinity)
├── lib/
│   ├── refetch.ts             → FALLBACK_REFETCH_INTERVAL_MS — safety-net refetch cadence;
│   │                            WS push is the primary channel, reads hit in-memory snapshots only
│   ├── alertUtils.ts          → getFilterableLabels (pseudo-labels: `@receiver`/`receiver`,
│   │                            `@cluster`, `@claimed-by` = `activeClaim.claimedBy ?? ''`;
│   │                            `@age` deliberately excluded — it's `now - startsAt`, a moving
│   │                            target, not a static label snapshot), parseDurationValue
│   │                            (single-unit `\d+(s|m|h|d)` → ms, else null), matchesLabelMatchers
│   │                            (filter-bar only, substring regex + pseudo-labels — never for
│   │                            silence matching; `@age` handled as a special case ahead of the
│   │                            label lookup — only `>`/`<` meaningful, via parseDurationValue
│   │                            against `Date.now() - startsAt`; `>`/`<` on any other field is
│   │                            always false — LabelMatcherOperator: `=`,`!=`,`=~`,`!~`,`>`,`<`),
│   │                            safeRegex, anchoredRegex, silenceWouldMatchAlert (Alertmanager-exact:
│   │                            anchored regex, real labels only — SilenceForm preview/overlap),
│   │                            hasUnevaluableRegexMatcher, silenceMatchesAlert,
│   │                            getEffectiveAlertState, getSilenceState (both consider ALL active
│   │                            silences in silencedBy, not just the first), getExpiredSilence,
│   │                            filterSilences (4th arg `createdBy`: exact-match "by" filter,
│   │                            silences page only), silenceCreators (distinct sorted `createdBy`
│   │                            values → the "By:" dropdown), sortSilences + defaultSilenceSortDir
│   │                            ("expires" → `endsAt`/asc default, "created" → `updatedAt`/desc
│   │                            default; explicit sort beats the active→pending→expired order,
│   │                            which is only a timestamp-tie breaker then `id`),
│   │                            silenceTiming (→ { pct 0–100 elapsed of the `startsAt`→`endsAt`
│   │                            window, urgency `pending|ok|soon|expired`, remainingMs } — drives
│   │                            the card lifetime bar + list stripe colour; `soon` = active & ≤15min
│   │                            left; an active silence past `endsAt` from a stale snapshot stays
│   │                            `soon` with negative remainingMs, never silently 100%/frozen),
│   │                            pickIdentifierLabel, formatSilenceDuration,
│   │                            formatTime, severityOrder, formatAckDuration, buildAckSilenceBody,
│   │                            buildExtendSilenceBody,
│   │                            computeGroupLabelValues (only labels present on EVERY alert in the
│   │                            group — a partial label is dropped, never partially OR-matched),
│   │                            buildGroupAckSilenceBody (throws on multi-cluster input),
│   │                            escapeRegexValue, unescapeRegex, isRoundTrippableTagList (detects
│   │                            whether an AM regex matcher is a Jarvis-style escaped-literal-OR-list
│   │                            SilenceForm can safely edit as tags, vs. a real regex needing raw-text
│   │                            editing — see SilenceForm's `raw` matcher mode),
│   │                            HIDDEN_LABEL_KEYS, shortClaimant,
│   │                            labelColorStyle(key, labelColors, theme) → CSSProperties | undefined;
│   │                            labels have no automatic color — undefined (→ caller's neutral
│   │                            `border-border bg-muted text-foreground` classes) unless labelColors[key]
│   │                            is a palette name (LABEL_COLOR_HUES), then a per-theme tuned
│   │                            { backgroundColor, color, borderColor } from that hue. Call sites:
│   │                            LabelChip.tsx, AlertsOverviewModal.tsx, AlertDetailRelatedSection.tsx,
│   │                            AlertDetailPanel.tsx's MatcherChip, SilenceMatcherChip.tsx (text color
│   │                            only). Display-only (invariant #19),
│   │                            partitionLabelsForDisplay(labels, labelDisplay, exclude?) →
│   │                            { visible, hidden }: visible = pinned keys (labelDisplay.order) first
│   │                            in pinned order, rest alphabetical; hidden = labelDisplay.hidden keys
│   │                            alphabetical (feeds the "+N" HiddenLabelsToggle chip);
│   │                            HIDDEN_LABEL_KEYS/`__`-prefixed/excluded keys in neither. Called once
│   │                            per chip row in AlertCard/AlertListRow/AlertListView; display-only,
│   │                            invariant #19 — never feeds filtering/silence matching),
│   │                            computeLabelBreakdown (alerts-overview modal: per-label-name
│   │                            value counts, alertname/severity pinned to the top regardless
│   │                            of coverage, `receiver` alias + rest of HIDDEN_LABEL_KEYS
│   │                            excluded from the generic loop — dedicated UI elsewhere),
│   │                            findRelatedAlerts (detail panel "Related" tab: alerts sharing ≥1
│   │                            real label with equal non-empty value — no hardcoded key list;
│   │                            skipped: alertname/severity/receiver/`@`-pseudo-labels/URL-valued
│   │                            labels (runbook/dashboard links = alertname by another name);
│   │                            self-excluded by fingerprint+cluster, not fingerprint alone — the
│   │                            same fingerprint in another cluster IS related; scored by smoothed
│   │                            IDF per shared pair, log((N+1)/df), so rare shared values outrank
│   │                            snapshot-wide ones and universal labels still count slightly
│   │                            instead of zeroing out, × time-proximity boost 1+exp(-|Δt|/30min)
│   │                            on startsAt (unparseable date → no boost); ties: severityOrder →
│   │                            startsAt desc; sharedKeys sorted rarest-first for chip display;
│   │                            `max` param optional, uncapped by default)
│   │                            ← single source, never duplicate in components
│   │                            100% test coverage enforced (frontend/vitest.config.ts) — a narrow
│   │                            exception to the functional-E2E-only strategy, see .agents/testing.md
│   ├── alertSelection.ts      → makeAlertSelectionKey / parseAlertSelectionKey — selection key
│   │                            format `<cluster>::<fingerprint>` (URL `alert=` param, cluster-safe)
│   ├── alertLink.ts           → buildAlertShareUrl — the "Copy link" URL: origin+path with only `state`
│   │                            (`resolved` for a resolved alert, else `active`) and `alert=` (selection
│   │                            key) — no search/filter/tab, so it stays short and the recipient's own
│   │                            defaults are not overridden
│   ├── clipboard.ts           → copyText — navigator.clipboard, falling back to a hidden textarea +
│   │                            execCommand('copy'), because the Clipboard API needs a secure context and
│   │                            Jarvis is often served over plain http in a cluster
│   ├── linkUtils.tsx          → isUrl, extractLinkButtons (URL-valued labels/annotations + runbook
│   │                            logic), renderTextWithLinks. AlertDetailPanel.tsx appends one more
│   │                            `LinkButton` of its own — label "Alertmanager", built from
│   │                            `alert.alertmanagerUrl` + an alertname filter, not derived from any
│   │                            label/annotation — so it renders as the last chip in the Links section
│   │                            (after every labels/annotations-derived link), instead of its own
│   │                            "Go to Alertmanager" button in the header action row
│   ├── heatmapUtils.ts        → bucketFiringStarts(startsIso, range, now?) — pure hourly/daily
│   │                            bucketing of raw firing timestamps into HeatmapCell[]
│   │                            (browser-local day/hour boundaries; 24h/7d hourly cells via ms
│   │                            arithmetic, 30d daily cells via calendar setDate for DST safety);
│   │                            also HEATMAP_INTENSITY_CLASSES/heatmapIntensityLevel/
│   │                            heatmapCellTooltip (plain exports, not the .tsx renderer, so
│   │                            react-refresh/only-export-components stays clean)
│   ├── avatarUtils.ts         → avatarInitials(name)/avatarColorClass(name) — deterministic
│   │                            initials + palette color for the header avatar, pure
│   │                            functions kept out of the .tsx renderer so the same username
│   │                            always renders the same avatar; no external lookup (no
│   │                            Gravatar/third-party call) — see components/ui/avatar.tsx
│   ├── owlMesh.ts             → pure geometry/animation for the Owl-mesh empty-state backdrop:
│   │                            sampleEdgePoints(pixels, w, h) — gradient-magnitude edge detection
│   │                            (premultiplied luminance + alpha gradient, mirrors
│   │                            `e2e/video/backdrops.js`'s `sampleLogo` weighting) on a bitmap,
│   │                            no DOM access; buildMeshNodes → centers/scales into a layout box,
│   │                            assigns each node a small unique drift phase/speed/amplitude
│   │                            (mulberry32-seeded, deterministic); nodePositionAt(node, t) — pure
│   │                            function of `t`, resting position + bounded elliptical drift, no
│   │                            assemble animation (that stays video-only); buildMeshEdges — static
│   │                            neighbourhood graph computed once from resting positions. 100% unit
│   │                            tested (owlMesh.test.ts, synthetic bitmaps). Consumed by
│   │                            `components/common/OwlMeshBackdrop.tsx`
│   ├── silenceDurations.ts    → Fast-Silence / Extend duration lists: `parseSilenceDuration`
│   │                            (`30m 4h 1d 1w 30d 1y` → minutes, mirrors Go's `ParseSilenceDurations`),
│   │                            `normalizeSilenceDurations`, `isValidSilenceDurationMinutes`,
│   │                            `formatDurationChoice` (button label that parses back), limits
│   │                            MAX_SILENCE_DURATION_MINUTES (365d) / MAX_SILENCE_DURATION_CHOICES (12)
│   ├── settingsUtils.ts       → UserSettings, DEFAULT_SETTINGS + option constants,
│   │                            LabelDisplayConfig ({ order: string[] (pinned); hidden: string[] },
│   │                            default `{ order: ['@cluster'], hidden: [] }` — matches pre-feature
│   │                            behavior), LABEL_COLOR_HUES / LABEL_COLORS / LabelColor (fixed chip
│   │                            palette: blue, cyan, teal, green, amber, orange, pink, purple — no
│   │                            red), LabelColorMap (Record<string, LabelColor>, default {}),
│   │                            SavedFilter ({ name, matchers: SavedFilterMatcher[], isDefault },
│   │                            matcherKey (name/operator/value identity, shared with savedFilters.ts),
│   │                            limits `MAX_SAVED_FILTERS` / `MAX_SAVED_FILTER_NAME_LENGTH` (`lib/settingsUtils.ts`) — the
│   │                            toolbar menu, see components/alerts/SavedFiltersMenu.tsx and
│   │                            lib/savedFilters.ts), resolveSettings, normalizeSettings (drops
│   │                            unknown keys/out-of-range values from an unverified server blob;
│   │                            labelDisplay: both order/hidden
│   │                            must be arrays or the whole key is dropped, entries deduped, a key in
│   │                            both arrays keeps only the hidden one — pin and hide are mutually
│   │                            exclusive; labelColors: entries kept only with a non-empty key and a
│   │                            known palette name — everything else silently dropped, not the whole
│   │                            map; savedFilters: name trimmed+capped at `MAX_SAVED_FILTER_NAME_LENGTH`, duplicate names
│   │                            case-insensitively dropped (first wins), matchers validated/deduped,
│   │                            extra fields like a stray `id`/`locked` stripped, at most one
│   │                            `isDefault: true` survives, result capped at MAX_SAVED_FILTERS),
│   │                            diffFromDefaults (pre-v2 → sparse-overrides migration),
│   │                            migrateLegacyDefaultFilters (the removed `defaultFilters` setting →
│   │                            one saved filter named "Default", marked as default — idempotent,
│   │                            called at the top of normalizeSettings; AGENTS.md invariant #20),
│   │                            migratePersistedSettings (the store's `persist` `migrate` for
│   │                            versions 0/2/3, pulled out here for unit-testability — runs
│   │                            migrateLegacyDefaultFilters before diffFromDefaults in the v0 branch)
│   │                            — re-exported by useSettingsStore.ts
│   ├── filterUrl.ts           → `?filter=` URL serialization of the label-matcher chips in
│   │                            Alertmanager matcher syntax (`{severity="critical",ns=~"prod-.*"}`,
│   │                            ~2.5× shorter than the former JSON — keeps long filters under proxy
│   │                            request-line limits, e.g. ingress-nginx 8 KB → 414): formatMatchers
│   │                            (values always quoted, names only when they contain reserved
│   │                            chars — `@cluster`/`@claimed-by`/`@age` stay bare; `>`/`<` are the
│   │                            Jarvis-only @age extension), parseMatchers (lenient like AM: optional
│   │                            braces, whitespace, unquoted values, trailing comma; unknown escapes
│   │                            kept literally; null on syntax error), readUrlMatchers (`filter` wins,
│   │                            legacy JSON `matchers` links still read with invalid entries dropped,
│   │                            never written). FILTER_PARAM / LEGACY_MATCHERS_PARAM. Serialization
│   │                            only — never evaluates an alert (Invariant #4)
│   ├── savedFilters.ts        → list/comparison helpers for saved filters — deliberately NOT alert
│   │                            filtering logic (Critical Invariant #4 stays with
│   │                            matchesLabelMatchers in alertUtils.ts, and this file stays out of
│   │                            that file's 100% coverage gate): toSavedFilterMatchers (strips the
│   │                            runtime `id`, dedupes), matcherListsEqual (set equality of
│   │                            (name,operator,value), order/duplicate-insensitive — never evaluates
│   │                            an alert), findActiveSavedFilter / findDefaultSavedFilter,
│   │                            validateSavedFilterName ('empty' | 'duplicate' | null, with an
│   │                            `exceptName` for case-only renames), addSavedFilter /
│   │                            renameSavedFilter / replaceSavedFilterMatchers / deleteSavedFilter /
│   │                            toggleDefaultSavedFilter (pure list ops, new arrays only),
│   │                            hasAlertViewParams (true iff the URL query has `state`/`q`/
│   │                            `filter`/legacy `matchers`/`alert` — used by AlertsPage.tsx to decide whether the
│   │                            default saved filter applies), resolveSavedFilterStatus
│   │                            (empty | saved | modified(base) | unsaved — a base name that no longer
│   │                            exists is ignored, never trusted)
│   └── utils.ts               → cn(), formatDuration() + misc helpers
```
