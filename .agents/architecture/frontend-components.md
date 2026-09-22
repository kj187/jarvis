# Jarvis Architecture — Frontend Component Tree: `components/`

Part of the architecture reference — start at `.agents/architecture.md` (index). Base rules and critical invariants live in the root `AGENTS.md`; when this file contradicts the code, the code wins.

Continues `frontend-tree.md` (shell, stores, hooks, `lib/`); the tree below is the `components/` directory of `frontend/src/`.

---

```
components/
    ├── ui/                    → shadcn/ui: button, card, badge, dialog, sheet, select, input,
    │                            textarea, date-time-picker, tooltip, truncatable-chip, avatar, plus two
    │                            overlay primitives with a fixed role each: `popover` (non-modal, opens on
    │                            hover AND Enter/Space, Escape closes and restores focus, focus-out closes,
    │                            `aria-expanded`/`aria-controls`; used by the four Header popovers) and
    │                            `info-hint` (an "(i)" button + `Tooltip`, focusable, `aria-describedby`,
    │                            Escape closes the hint without closing a surrounding Sheet). Modal content
    │                            → `dialog`/`sheet`; short non-interactive text → `tooltip`. Never build a
    │                            hover-only surface
    ├── common/
    │   ├── EmptyState.tsx     → shared empty view for alerts (AlertListView.tsx, AlertCardGrid.tsx —
    │   │                        default message "No alerts") and silences (SilencesPage.tsx —
    │   │                        `message="No active silences"`): centered OwlMeshBackdrop + a
    │   │                        muted-foreground caption below it
    │   └── OwlMeshBackdrop.tsx → `<canvas>`, rAF loop: samples `/logo.png`'s edge points
    │                            (lib/owlMesh.ts sampleEdgePoints, offscreen canvas → ImageData),
    │                            lays out nodes once (buildMeshNodes/buildMeshEdges), repaints each
    │                            frame from nodePositionAt(node, t) — no re-sampling, no rebuilt
    │                            edges. Colors read from `--color-muted-foreground` (lines) /
    │                            `--color-link` (nodes) via getComputedStyle, re-read on a
    │                            `data-theme` MutationObserver (App.tsx sets that attribute — see
    │                            Settings Store in `frontend-state.md`). Paused on `document.hidden`; a single static
    │                            frame (no rAF loop) under `prefers-reduced-motion: reduce` — the
    │                            shared Playwright `page` fixture (e2e/support/fixtures.ts) forces
    │                            that emulated media so functional/screenshot specs stay
    │                            deterministic. `aria-hidden`, `pointer-events-none`. Purely a UI
    │                            component — no assemble animation (that stays video-only, see
    │                            `e2e/video/backdrops.js`'s `owl()`)
    ├── layout/
    │   ├── Header.tsx         → `WsStatus` (icon + visible "Offline" text when the socket is down, `title` kept), decorative owl mark (`/logo.png`, `data-testid="header-mark"`, `alt=""`), nav tabs, cluster status, WS indicator, polling/refresh,
    │   │                        create-silence, mobile hamburger. Settings + theme toggle +
    │   │                        login/logout/admin all live in one always-present user-menu
    │   │                        button (Grafana-style) — initials avatar when authenticated
    │   │                        (lib/avatarUtils.ts — no Gravatar/third-party lookup),
    │   │                        generic CircleUserRound icon otherwise. The Login entry only
    │   │                        appears when an auth provider is configured
    │   │                        (providerInfo.mode !== 'none') and no session exists; Settings
    │   │                        and the theme toggle are always present regardless of auth state.
    │   │                        Opening Settings sets `settings=open` in the current URL (preserving
    │   │                        other query params); Header initializes the sheet from that param,
    │   │                        removes it on close, and follows browser popstate navigation.
    │   │                        Separate always-present Info button (data-testid="info-menu") next
    │   │                        to the user-menu opens its own popover (`InfoColophon`) with the
    │   │                        brand footer — /logo.png, version (useVersion), copyright — moved
    │   │                        here from SettingsSheet.tsx. Desktop-only: cluster status, refresh,
    │   │                        info and user-menu popovers all open on hover (small close-delay
    │   │                        timers per popover, same pattern as the pre-existing cluster status
    │   │                        popover) and dock flush under the header — no gap, no top border
    │   │                        (`border-t-0`), `bg-header` instead of `bg-card` so the popover reads
    │   │                        as an extension of the header bar, not a separate floating card.
    │   │                        Native `title` tooltips were dropped wherever the popover/visible
    │   │                        label already shows the same text, to avoid a duplicate browser
    │   │                        tooltip stacking on top of the custom popover.
    │   └── MatcherChipsBar.tsx → chip-based label filter (=, !=, =~, !~, and @age-only >, <),
    │                            tag multi-value, suggestions (always includes `@age`/`@claimed-by`
    │                            via PSEUDO_FIELD_SUGGESTIONS — @age never appears from the live
    │                            label snapshot, @claimed-by only when some alert is claimed);
    │                            operator auto-snaps to `>`/`=` when
    │                            the field switches into/out of `@age`; an @age draft with an
    │                            unparseable duration (red border, parseDurationValue) is never
    │                            promoted from draft to a committed filter chip; resolved mode marks
    │                            invalid server-reported matcher indices and shows the RE2 semantics hint
    ├── alerts/
    │   ├── AlertsPage.tsx     → useWebSocket, filter/search, card|list + detail panel, fullscreen, pagination;
    │   │                        resolved mode owns the controlled server page, debounces search,
    │   │                        resets to page 1 atomically on filter/page-size changes, cancels on mode
    │   │                        exit, corrects a shrunken result to its last page at most once, and fetches
    │   │                        selected off-page details by fingerprint+cluster; explicit loading/error/
    │   │                        retry and stale-page states keep navigation deterministic;
    │   │                        its URL-state writer replaces only alert-owned params and preserves
    │   │                        shell-owned params such as `settings=open`; on first mount, if the URL
    │   │                        has none of `state`/`q`/`matchers`/`alert` (hasAlertViewParams), applies
    │   │                        the saved filter marked default (findDefaultSavedFilter), if any
    │   ├── SavedFiltersMenu.tsx → quick-select/manage popover for saved label filters (rendered first
    │   │                        in `alerts-toolbar`, left of MatcherChipsBar). Nothing auto-saves. Status
    │   │                        comes from lib/savedFilters.ts resolveSavedFilterStatus(chips, savedFilters,
    │   │                        uiStore.savedFilterBase): `saved` → button shows the name (filled bookmark);
    │   │                        `modified` → base name in italics + amber dot
    │   │                        (`saved-filters-unsaved-dot`), footer "Save changes to <base>" plus "save as
    │   │                        new"; `unsaved` → icon-only square button (h-7 w-7, no label/chevron) + dot,
    │   │                        footer "save as new", each row a two-click overwrite ("Overwrite?");
    │   │                        `empty` → icon-only button, hint only. The menu keeps
    │   │                        savedFilterBase in step: any `saved` match becomes the base; apply/save/
    │   │                        save-as-new/overwrite set it, rename follows it, delete clears it; an empty
    │   │                        chip list deliberately keeps it (remove-then-add is an edit). Rows show name
    │   │                        + matcher summary, star (default), rename (inline, live duplicate check,
    │   │                        Enter/Esc — Esc is preventDefault'ed so the popover stays open), delete
    │   │                        (timed second-click, same pattern as "Reset all settings"). Live
    │   │                        name validation disables Save/confirm; list scrolls inside a viewport-capped
    │   │                        popover with a count (n/`MAX_SAVED_FILTERS`); transient popover state resets on open. Shows
    │   │                        the settings sync error (origin 'server' + syncState 'error') inline
    │   ├── AlertCardGrid.tsx  → grouped by settings `groupByLabel` (default severity), per-group
    │   │                        pagination, drag-and-drop section reordering (persisted:
    │   │                        'jarvis-card-section-order:<label>'). Within a section, groups sort
    │   │                        by freshness (most recently fired first, `latestStartsAt`) — not
    │   │                        alphabetically — same convention as the backend's flat alert list
    │   │                        (AlertStore.Get(), startsAt desc). Cards lay out via CSS multi-column
    │   │                        (`columnCount` inline style, `useColumns()` for the responsive
    │   │                        1/2/3/4 breakpoint, `break-inside-avoid` per card) instead of a
    │   │                        hand-rolled height-estimate bin-packer — the browser balances by real
    │   │                        rendered height (collapsed state, claim notes, pagination, all of it)
    │   │                        with no estimate to keep in sync. `useColumns()` returns
    │   │                        `settings.cardColumns` directly when it's a fixed number (1-6),
    │   │                        overriding the responsive breakpoint on every screen size — only
    │   │                        'auto' (the default) uses the breakpoint. Either way `columnCount` is
    │   │                        then capped to `min(that value, group count)` — same for the ungrouped
    │   │                        flat grid's own column count — so a section with fewer groups than
    │   │                        columns doesn't squeeze its cards into a fraction width with empty space next
    │   │                        to them; a lone group gets the full row.
    │   ├── GroupingControl.tsx → toolbar "Grouped" control (AlertsPage.tsx, hidden in resolved mode):
    │   │                        a popover combining the on/off toggle (local `cardGroupingEnabled`,
    │   │                        passed through as `groupingEnabled` to AlertCardGrid/AlertListView)
    │   │                        with a radio picker for `settings.groupByLabel` itself — the label
    │   │                        section grouping ("CRITICAL (15)") is driven from here now instead
    │   │                        of only via Settings (the "Group alerts by label" Settings row was
    │   │                        removed as redundant once this shipped). Options = 'severity' pinned
    │   │                        first + every label present on the currently visible (non-resolved)
    │   │                        alerts, each annotated with its distinct-value count.
    │   ├── AlertCard.tsx      → card + claim info + count badge + silence/detail actions + Fast-Silence (hover);
    │   │                        an entry is a plain container, never role="button" (it holds real
    │   │                        buttons); the whole surface stays mouse-clickable, the keyboard/AT
    │   │                        path is the named "Open details" button in the action rail;
    │   │                        common labels (shared by the whole group) render as a quiet
    │   │                        LabelChip strip above the entries; multi-alert groups: each entry
    │   │                        leads with an identity line (position pill `n/total` + its
    │   │                        distinguishing labels, first one `emphasized`); every chip row
    │   │                        (strip and entries) = partitionLabelsForDisplay → pinned-first chips +
    │   │                        trailing "+N" HiddenLabelsToggle; summary clamped to
    │   │                        1 line / description to 2 (full text via title + detail panel);
    │   │                        expired-silence shown as an inline muted line, not a banner;
    │   │                        claim = one blue line above the identity line ("Claimed by:
    │   │                        <shortClaimant> · <relative time>"), padded box only with a note,
    │   │                        + a blue right accent (4 px) on the claimed entry;
    │   │                        FiringSparkline: dezent HeatmapCellsRow under the timestamp row —
    │   │                        fetches 30d, keeps only the most recent 14 buckets (fewer/bigger
    │   │                        cells read better at card width); always rendered, even with zero
    │   │                        fires in the window (a missing sparkline reads as a rendering bug,
    │   │                        not "no data") — no tooltips (would fight the card's own click target)
    │   ├── AlertListView.tsx  → sortable table, cols = Name [· State] · Actions (no Claim column —
    │   │                        claim/release lives only in the detail panel); expandable groups,
    │   │                        section reordering (persisted: 'jarvis-list-section-order:<label>');
    │   │                        resolved mode renders the server-supplied order without client slicing,
    │   │                        using controlled right-aligned grouped top/footer pagers that stack
    │   │                        responsively, plus the persisted per-page selector to their left;
    │   │                        group-header common labels = quiet LabelChip strip (PartitionedLabelChips:
    │   │                        pinned-first + "+N" chip, one partition per group); group silence
    │   │                        action is a labelled button ("Silence group" / "Extend/Recreate/Expire
    │   │                        group silence"). colSpans: `showStateColumn ? 3 : 2`
    │   ├── AlertListRow.tsx   → single row; when `indented` (inside a group) it drops the repeated
    │   │                        alertname and leads with its own labels (first `emphasized`); chips =
    │   │                        partitionLabelsForDisplay over getFilterableLabels minus `excludeLabels`
    │   │                        (key+value match), so `@cluster` follows pin/hide like any label, + trailing
    │   │                        "+N" chip; claim
    │   │                        shown read-only as a blue "Claimed by: <shortClaimant>
    │   │                        · <time>" line above the chips; row actions = one AckButton (icon
    │   │                        variant, menu = Silence form + Fast-Silence durations) + contextual
    │   │                        expire/extend icon; the row is `tabIndex=0` and opens on Enter, but
    │   │                        only when the row itself is the event target — Enter bubbling up from a
    │   │                        button inside it must not also open the detail panel (`e.target ===
    │   │                        e.currentTarget`; the group row in AlertListView.tsx follows the same
    │   │                        rule for its "Silence group" buttons)
    │   ├── AlertDetailPanel.tsx → slide-over: labels/annotations + link buttons, stats & timeline,
    │   │                          claim (useClaimController) is one click for the common case —
    │   │                          claims immediately with whatever name is already known (logged-in
    │   │                          user, or a name remembered in localStorage from a prior claim in
    │   │                          auth mode "none"); the name-only prompt (`claim-name-form`, no note
    │   │                          field) only appears the very first time in auth mode "none" before
    │   │                          any name is remembered. Adding a note is a separate, post-claim step
    │   │                          via the pencil icon on the claim badge (`claim-edit-note-button` →
    │   │                          `claim-edit-note-form`), not part of the claim action itself.
    │   │                          comments (CommentsPanel), silence
    │   │                          controls + Fast-Silence, AI-prompt section;
    │   │                          when the alert was opened from a multi-alert list/card group,
    │   │                          `uiStore.selectedGroupKeys` holds the sibling selection keys and a
    │   │                          fixed up/down chevron pair renders left of the sheet (position
    │   │                          mirrors the sheet's own width breakpoints) to step through them —
    │   │                          also bound to ArrowUp/ArrowDown globally while the panel is open
    │   │                          (ignored while focus is in an input/textarea/contenteditable);
    │   │                          header (below the stats line, above the action buttons) embeds
    │   │                          AlertHeatmap directly — not a collapsible section, always visible;
    │   │                          close (X) is rendered inline in the header row next to the status
    │   │                          badges as a bordered button (Sheet's own absolute-positioned close
    │   │                          is suppressed via `hideCloseButton`) — was previously floating
    │   │                          top-right, forcing `pr-8` padding on every header row; sheet width
    │   │                          is `sm:max-w-[37.8rem] lg:max-w-[50.4rem]` (10% narrower than
    │   │                          Sheet's default, this panel only), fixed regardless of tab — the
    │   │                          expired-silence banner is collapsible (default collapsed,
    │   │                          ChevronDown/Up toggle), state persisted per-alert in localStorage
    │   │                          (`jarvis:collapsed:expired-silence:<fingerprint>:<cluster>`) — the
    │   │                          active-silence banner stays always expanded (actionable: extend
    │   │                          buttons, expiry warning); below the silence banners (`mt-3` gap), a
    │   │                          **"Details" / "History" / "Comments" / "Related" / "AI Prompt" tab
    │   │                          bar** splits the rest of the panel — active tab = `uiStore.detailTab`
    │   │                          (`DetailTab` union, synced to the `tab` URL param so reload/share
    │   │                          lands on the same tab; reset to `'details'` inside
    │   │                          `setSelectedFingerprint`, NOT in the panel). Tabs
    │   │                          render "folder tab" style:
    │   │                          the active tab sits flush on the content background with no bottom
    │   │                          border (`-mb-px border-b-transparent bg-card`, visually merges into
    │   │                          the content below it), inactive tabs sit on a muted strip
    │   │                          (`bg-muted/30` row, `border-b border-border`) — chosen over a plain
    │   │                          underline and over a segmented-pill control (both tried and rejected
    │   │                          in review) because it reads unambiguously as navigation with hidden
    │   │                          panels behind it. "Details" holds Annotations → Summary → Links →
    │   │                          Labels (no divider under Summary/Links/Labels —
    │   │                          `AlertDetailSection bordered={false}` — only Annotations keeps its
    │   │                          divider, since the tab boundary already separates the group);
    │   │                          "History" holds `AlertDetailHistorySection` (event timeline only —
    │   │                          own tab now, no more collapsible sub-header inside it, the tab label
    │   │                          itself is the heading); "Related" holds `AlertDetailRelatedSection`
    │   │                          (other currently firing/suppressed alerts sharing real labels —
    │   │                          `findRelatedAlerts` in `lib/alertUtils.ts`, smoothed-IDF specificity
    │   │                          weighting × time-proximity boost, see the lib/ entry in `frontend-tree.md` for the
    │   │                          scoring; deliberately NOT alertname/severity/URL-valued labels,
    │   │                          cross-cluster matches allowed). Computed EAGERLY in the panel via
    │   │                          `useMemo([alert, allAlerts])` — the tab label carries a live count
    │   │                          badge like Comments, which requires the result before the tab opens
    │   │                          (an earlier lazy+spinner variant was dropped for exactly that
    │   │                          reason; the computation is O(alerts×labels) over in-memory data,
    │   │                          microseconds); data comes from the already-loaded `['alerts']`
    │   │                          cache via `useAlerts()` — no extra fetch. Rows render compact
    │   │                          two-line (severity badge + alertname + cluster-if-different + start
    │   │                          time / max 3 shared-label chips rarest-first + "+N" title-tooltip
    │   │                          for the rest); top 10 shown, "Show 10 more (N remaining)" button
    │   │                          appends chunks of 10 (`visibleCount` state, reset on alert switch
    │   │                          via the panel's `<cluster>::<fingerprint>` key); row click swaps
    │   │                          the panel to that alert via the same `onSelectAlert` jump used by
    │   │                          `AffectedAlertRow` (which also resets the tab to Details);
    │   │                          "AI Prompt" holds
    │   │                          `AlertDetailAIPromptSection` (copy-to-clipboard prompt text, was
    │   │                          previously a collapsed-by-default subsection at the bottom of
    │   │                          History — split into its own tab since building an AI prompt is a
    │   │                          different task than reading the event timeline); "Comments" holds
    │   │                          `CommentsPanel` alone at full panel width. The Comments tab label
    │   │                          always carries a count badge (shows `0`, not hidden at zero) fed by
    │   │                          a `useAlertComments(fingerprint, cluster, 1)` call that shares its
    │   │                          cache with `CommentsPanel`'s own page-1 query (same key, no extra
    │   │                          network cost) — earlier revisions of this panel tried a side-by-side
    │   │                          two-column layout (comments in their own sticky column, collapsible
    │   │                          to a slim strip) but that was scrapped after user feedback in favor
    │   │                          of tabs: one column, no responsive-breakpoint width math, comments
    │   │                          get the full panel width when active
    │   ├── AlertDetailSection.tsx → collapsible section wrapper used inside the detail panel;
    │   │                        `bordered` prop (default `true`) toggles the bottom divider — `false`
    │   │                        for sections meant to flow into the next one without a visual break
    │   ├── AlertDetailHistorySection.tsx → merged event timeline table + pager (heatmap lives in
    │   │                        AlertDetailPanel's header, not here — see above; AI-prompt is its own
    │   │                        `AlertDetailAIPromptSection` component/tab, not part of this one)
    │   ├── AlertDetailRelatedSection.tsx → own "Related" tab; presentational — receives the
    │   │                        pre-computed `related` list from AlertDetailPanel (eager useMemo
    │   │                        there feeds the tab count badge too), compact two-line rows, chunked
    │   │                        show-more, row click jumps via `onSelectAlert` +
    │   │                        `makeAlertSelectionKeyForAlert` (see tab-bar note above for full
    │   │                        rationale)
    │   ├── AlertDetailAIPromptSection.tsx → copy-to-clipboard AI-analysis prompt text (`promptText`
    │   │                        built + cached in `AlertDetailPanel`'s `getCachedPrompt`); own tab,
    │   │                        always expanded (no collapsible wrapper — the tab itself is the
    │   │                        section boundary)
    │   ├── AlertHeatmap.tsx    → 24h/7d/30d range toggle + box-grid firing-pattern heatmap; used by
    │   │                        AlertDetailPanel's header, self-contained (owns its own
    │   │                        useAlertHeatmap query + range state); 7d renders as 7 day-rows of
    │   │                        24 hourly cells (with day labels), 24h/30d as one row; same
    │   │                        HeatmapCellsRow as the card, so card + detail share one visual
    │   │                        language now (box grid, soft muted-fill empty cells); Info icon next
    │   │                        to the label opens a hover tooltip explaining cell shading + what
    │   │                        each range shows (anchored `right-0` — the range-toggle buttons sit
    │   │                        to the icon's right, unlike the Links-section Info icon which anchors
    │   │                        `left-0`). Caption row is `justify-end` — label, info icon and
    │   │                        range-toggle sit together right-aligned as one unit, deliberately, not
    │   │                        `justify-between` with the label pinned to the left edge. When every
    │   │                        cell in the selected range is empty (`cells.every(c => c.count === 0)`),
    │   │                        the grid is replaced by a right-aligned "No activity in this window"
    │   │                        caption instead of rendering a wall of identical empty boxes, which
    │   │                        reads as broken rather than "nothing happened here".
    │   ├── HeatmapCells.tsx   → HeatmapCellsRow (no chart lib; renders HEATMAP_INTENSITY_CLASSES
    │   │                        cells via heatmapIntensityLevel/heatmapCellTooltip, all three in
    │   │                        lib/heatmapUtils.ts — plain exports, not this .tsx file, so
    │   │                        react-refresh/only-export-components stays clean) — single source
    │   │                        for both the detail-panel heatmap and the card sparkline
    │   ├── AckButton.tsx      → one-click Fast-Silence (short-lived exact-match silence); active-only
    │   │                        (getEffectiveAlertState), auth-gated (useProtectedAction); a
    │   │                        `ui/popover.tsx` popover (role="group" of plain buttons — never
    │   │                        role="menu": no roving focus, and the options sit inside a heading/grid
    │   │                        wrapper) with the `silenceDurations` setting (default 5m…1w) picking the
    │   │                        duration. Opens on hover, tap or Enter/Space — not on focus, so tabbing
    │   │                        through a page of cards does not open a panel per card. The panel is a
    │   │                        child of the trigger's Popover (not portaled), so Tab walks into it and
    │   │                        Escape returns focus; it is `position: fixed` so overflow-hidden cards
    │   │                        cannot clip it. With `onCreateSilence` (card view) a layout effect
    │   │                        measures the panel and shifts it so its own bell lands on the trigger's
    │   │                        (`alert-ack.spec.ts` asserts the alignment to within 2px). The trigger's
    │   │                        anchor span stops click propagation to the host (AlertCard entry).
    │   │                        transient Silenced/Failed feedback; used by AlertCard + AlertDetailPanel
    │   ├── AlertBadge.tsx     → severity badge
    │   ├── AlertFilters.tsx   → label matcher chips + state dropdown
    │   ├── AlertsOverviewModal.tsx → Karma-style "where is the fire?" overview, opened from a
    │   │                        ChartPie icon button in AlertsPage's sub-header (next to
    │   │                        ViewToggle — Alerts-specific, doesn't belong in the global Header
    │   │                        chrome that's also visible on the Silences page);
    │   │                        computeLabelBreakdown over the current state tab's alerts
    │   │                        (ignores the label-matcher filter bar — the point is discovering
    │   │                        what to filter *by*); clicking a value adds an unlocked `=`
    │   │                        matcher via uiStore.addLabelMatcher (no-op if an identical one
    │   │                        already exists) and closes the modal; in resolved mode it receives and
    │   │                        explicitly labels the current page from AlertsPage, with no second query
    │   │                        Uses the shared `ui/Dialog`: the modal has an accessible name,
    │   │                        receives focus on open, traps Tab/Shift+Tab, closes on Escape, and
    │   │                        restores focus to the toolbar trigger on close.
    │   ├── LabelChip.tsx      → one fixed size for every chip (`max-w-[200px]`, `text-[10px]`) so a row
    │   │                        of chips reads as one unit; `emphasized` only adds font weight, unrelated
    │   │                        to color. Neutral (`border-border bg-muted text-foreground`) unless this
    │   │                        label key has a palette color in `labelColors` (useSettingsStore) — there
    │   │                        is no automatic per-key color, so a chip is neutral everywhere,
    │   │                        including the "common labels" shared-context strips, until you set one in
    │   │                        Settings → Labels. Hover dropdown shows the full, untruncated value above
    │   │                        the label-matcher operator buttons.
    │   │                        Also exports HiddenLabelsToggle: trailing dashed "+N" chip for the
    │   │                        `hidden` partition (aria-label "N hidden labels", title lists the keys);
    │   │                        click opens them in a fixed-position portal popover (`hidden-labels-popover`,
    │   │                        same technique as LabelChip's own dropdown) — never inline, so revealing
    │   │                        never changes the card's height (AlertCardGrid's `column-count` grid
    │   │                        reflows and visibly moves an alert to a different column on any height
    │   │                        change). Local `open` state only, never touches settings, so it's a
    │   │                        per-alert view-only peek.
    │   └── ViewToggle.tsx     → ⊞ / ☰ toggle
    ├── comments/
    │   ├── CommentsPanel.tsx  → list (paginated, newest first) + Write/Preview editor; the sole
    │   │                        content of AlertDetailPanel's "Comments" tab (full panel width, no
    │   │                        responsive width classes of its own — the panel's own outer scroll
    │   │                        container handles scrolling); local `page` state resets to 1 on
    │   │                        fingerprint/cluster change;
    │   │                        keeps a second background query on page 1 (`useAlertComments(...,
    │   │                        1)`, deduped by TanStack Query when already on page 1) purely as a
    │   │                        "did a newer comment land" signal — if its `total` exceeds the
    │   │                        currently-viewed page's `total` while `page > 1`, shows a "New
    │   │                        comment — jump to latest" affordance instead of forcing the user
    │   │                        back to page 1 (WS `comment_added` invalidation never touches local
    │   │                        page state, only the query cache); editor is a plain `<textarea>`
    │   │                        (no WYSIWYG) with a Write/Preview tab pair — Preview renders through
    │   │                        the same lazy `CommentMarkdown`; `Ctrl/Cmd+Enter` submits; length
    │   │                        counter appears when close to the server-side comment length cap (`maxCommentBodyLen`)
    │   ├── CommentMarkdown.tsx → `react-markdown` + `remark-gfm`, `skipHtml` (no raw HTML, ever —
    │   │                        this is why react-markdown was chosen over a `dangerouslySetInnerHTML`
    │   │                        approach, invariant/workflow rule 4), `allowedElements` locked to
    │   │                        `p, br, strong, em, del, code, pre, a, ul, ol, li, blockquote` (a
    │   │                        comment is a note, not a document — no images/headings/tables);
    │   │                        links get `target="_blank" rel="noopener noreferrer"`, URL
    │   │                        sanitization is react-markdown's built-in default (`javascript:`
    │   │                        etc. neutralized); code highlighting via `rehype-highlight` +
    │   │                        `highlight.js/lib/core` with a small explicit language set (`bash,
    │   │                        json, yaml, go, javascript, sql, ini`) instead of the ~190-language
    │   │                        default bundle; theme is hand-written in `index.css` (`.hljs*`
    │   │                        rules) against our own `--color-*` CSS variables, not an imported
    │   │                        hljs theme, so it stays legible in dark AND light mode; this whole
    │   │                        module is `React.lazy`-imported from `CommentsPanel` (not eagerly)
    │   │                        so the main bundle doesn't grow for users who never open comments —
    │   │                        it renders as its own chunk (~320 KB) in `pnpm build` output
    │   └── (storage stays raw text in `alert_comments.body` — Markdown is a rendering-only
    │       concern; old plain-text comments render unchanged, a stray `*`/`_` rendering as
    │       emphasis in a legacy comment is accepted)
    ├── silences/
    │   ├── SilencesPage.tsx   → dedicated page: card|list, fullscreen, show/hide expired,
    │   │                        sort (expires/created + asc/desc toggle), creator-filter
    │   │                        dropdown (person-icon, silences only), matcher-chip filter
    │   ├── ExtendSilenceMenu.tsx → one-click "Extend by…" menu for active/pending silences (durations = the `silenceDurations` setting, shared with Fast-Silence; hover/Enter,
    │   │                        `position: fixed` panel so overflow-hidden cards can't clip it; auth-gated via
    │   │                        useProtectedAction); used by AlertCard/AlertListRow/AlertListView group header/
    │   │                        AlertDetailPanel + SilenceCard/SilenceGroupCard/SilenceListView; one logic for
    │   │                        every running silence — `tone="warning"` only tints the ≤15-min case
    │   ├── SilenceCard.tsx    → single silence: status dot + cluster + by/affected line, quiet
    │   │                        matcher chips, comment quote, then SilenceLifetimeBar; expire/
    │   │                        re-create icon button (`data-testid="silence-card"`)
    │   ├── SilenceGroupCard.tsx → grouped identical silences (count + summed affected + cluster chips),
    │   │                        same body + lifetime bar (`data-testid="silence-group-card"`)
    │   ├── SilenceListView.tsx → dense rows: urgency stripe · matchers inline (edge-faded) · one meta
    │   │                        line + comment · remaining-time + expiry date pulled right
    │   ├── SilenceLifetimeBar.tsx → card "time zone": progress bar over the `startsAt`→`endsAt`
    │   │                        window (silenceTiming), created + expiry caps, left-aligned
    │   │                        remaining-time label
    │   ├── SilenceRemaining.tsx → compact colour-coded remaining-time label (list rows)
    │   ├── SilenceMatcherChip.tsx → quiet matcher chip: only the label name tinted, and only when that
    │   │                        key has a palette color (labelColorStyle — no automatic color), op +
    │   │                        value always in neutral ink — calmer than the alert views' TruncatableChip
    │   ├── silenceDisplay.ts  → URGENCY_TEXT/FILL_CLASS maps, matcherOperator, silenceRemainingText
    │   │                        (shared by the three above; kept out of the .tsx files for react-refresh)
    │   ├── SilenceExpireModal.tsx → expire/extend confirmation (silence-ID link → AM); uses the
    │   │                        shared accessible `ui/Dialog`, labelled with the visible action title
    │   ├── SilenceForm.tsx    → 3 steps: form (matchers, clusters, duration, live match count,
    │   │                        overlap/zero-match/unevaluable-regex warnings) → preview → per-cluster results
    │   │                        Regex matchers whose AM value isn't a literal-tag-OR-list
    │   │                        (`isRoundTrippableTagList`) load in raw-text mode (`SilenceMatcher.raw`)
    │   │                        instead of the tag editor, and submit verbatim — editing a real regex
    │   │                        as tags would corrupt it on save
    │   ├── MatcherEditor.tsx  → matcher rows: operators + tag multi-value + suggestions
    │   └── SilenceTemplateTab.tsx → template CRUD + apply-to-form
    ├── settings/
    │   ├── DurationListEditor.tsx → tag input for a duration list (chips + inline input in one field; remove ×, add by typing + Enter
    │   │                        `30d`, Reset to the instance/built-in default); used once in
    │   │                        SettingsSheet for `silenceDurations`
    │   └── SettingsSheet.tsx  → status line under the heading (`origin`/`syncState` from
    │                            useSettingsStore): "Synced to your account", "Could not save —
    │                            changes are local to this browser" (syncState 'error'), "Stored in
    │                            this browser" (mode 'none'), or "Stored in this browser — sign in to
    │                            sync across devices" (provider active, origin 'local'). Display: time
    │                            format, default view, card columns, group-by label,
    │                            claim animation. Silences: default duration (picked from the silence durations) plus the `DurationListEditor`. Saved label
    │                            filters (`savedFilters`) have no Settings section of their own —
    │                            they're managed from `SavedFiltersMenu.tsx` in the alert toolbar
    │                            instead, next to what they filter (replaces the removed
    │                            "Default Filter" section — see AGENTS.md invariant #20).
    │                            `resolvedPageSize` and
    │                            `defaultCreatorName` live in the same useSettingsStore but are NOT
    │                            editable here — resolvedPageSize is set via the "Per page" buttons in
    │                            AlertListView.tsx's resolved view; defaultCreatorName has no writer
    │                            anywhere in the frontend (only ever read as a fallback in
    │                            SilenceForm.tsx / useSilences.ts, always resolves to its default ''
    │                            unless set directly in localStorage) — dead settings-store field, not
    │                            wired to any UI. No brand footer — logo/version/copyright live in the
    │                            header's info popover (layout/Header.tsx) instead. Theme lives in
    │                            useSettingsStore but is only toggled from the header's user menu, not
    │                            from this sheet. Labels column (right side, "Pin & Hide"): one
    │                            intro sentence, a search box, then ONE scrollable list (`label-list`)
    │                            of identical LabelRow rows — key · "N alerts · M values" stats ·
    │                            LabelColorSwatch · Pin toggle · Eye (hide) toggle. Pinned rows
    │                            (labelDisplay.order, `pinned-labels`) come first in pinned order with a
    │                            drag grip (PinnedLabelRows — mouse-tracked bounding-rect reorder, same
    │                            technique as AlertCardGrid's section drag; grip only while
    │                            the search is empty so the rows are the complete order), then a divider,
    │                            then every other label alphabetically (`unpinned-labels`; a hidden row
    │                            is dimmed in place, never re-sorted) under an "Other labels" caption
    │                            with a "Hide all"/"Show all" bulk toggle — scoped to the unpinned rows
    │                            the search currently shows, never touching pinned keys. Every
    │                            non-hidden label renders as a chip. Pin and hide are mutually
    │                            exclusive: pinning removes the key from `hidden`, hiding removes it
    │                            from `order`; writes always build `{ order, hidden }` in that key order
    │                            (computeNextOverrides compares via JSON.stringify). Listed keys = keys on
    │                            loaded alerts ∪ configured keys (order/hidden/labelColors), minus
    │                            HIDDEN_LABEL_KEYS/`__`-prefixed — "No labels seen yet." only when that
    │                            union is empty, so a configuration stays editable with no alert firing.
    │                            LabelColorSwatch opens a fixed-position portal popover with the 8
    │                            palette colors + "no color" (writes the palette name to
    │                            `labelColors[key]`). "Reset labels" restores `labelDisplay` and
    │                            `labelColors` from defaults, guarded by the same
    │                            timed second-click confirmation pattern as "Reset all settings"
    │                            (separate state/timer; each reset remains scoped).
    ├── auth/
    │   ├── LoginModal.tsx     → the login dialog (internal form / SSO popup button); never navigates
    │   ├── LoginPrompt.tsx    → the ONE app-wide LoginModal, mounted in App, driven by authStore
    │   │                        (`loginPromptOpen`; non-dismissable in full_protect after `sessionExpired`);
    │   │                        invalidates all queries after a prompted login. Components never mount
    │   │                        their own LoginModal — they call requestLogin()/guard()/execute()
    │   ├── LoginPage.tsx      → full-page login (full_protect)
    │   ├── NoAuthNotice.tsx   → banner in mode "none" (dismiss persisted)
    │   └── SetupPage.tsx      → first-run admin creation
    └── admin/
        ├── UserManagement.tsx  → user table, add user, change role, delete (confirm), "(you)" badge
        └── GlobalSettings.tsx  → admin-settings foundation (Phase 0 of the RBAC label-scoped-access
                                  plan): lists registered sections via GET /api/v1/admin/settings,
                                  empty state when none are registered yet. No section-specific form.
```

