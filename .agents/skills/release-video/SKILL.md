---
name: release-video
description: Record a narrated demo video of a Jarvis release's headline features (16:9 for YouTube, square for LinkedIn) from the e2e fixtures, and draft the YouTube text and the release-notes video block. Only when the user asks for it — the release skill asks upfront (Phase 0), before preflight.
---

# Jarvis — Release Video

Turns the headline features of a release into a short demo video: the real UI
driven by Playwright against the isolated e2e stack, a visible cursor,
hand-drawn marker circles around every effect, eased zooms onto the action,
captions and a local AI voice-over. One recording run yields two files: 16:9
(1920×1080) for YouTube and square (1080×1080) for LinkedIn.

**Never without an explicit request.** The release skill asks once, upfront
(`.agents/skills/release/SKILL.md`, Phase 0), before preflight; a "no" or no
answer means no video.

**Videos never enter the repository.** Frames, audio and renders live in the
gitignored `frontend/e2e/_video/`; finished files go to `VIDEO_OUT` (default
`~/Downloads/jarvis-<project>-video`), which the script refuses to place inside
the repo. The user uploads to their own YouTube channel — never upload or
post anything yourself.

---

## Building blocks (committed)

| File | Role |
|---|---|
| `frontend/e2e/video/recorder.ts` | `VideoRecorder`: device-pixel screencast, cursor, `clickOn`/`moveTo`, `focus`/`focusOn` (zoom keyframes), `highlight` (hand-drawn marker), `scene` (caption + narration sync), `card` (intro/outro title card = cover design), `finish` (timeline, caption and card PNGs) |
| `frontend/e2e/video/backdrops.js` | animated card backdrops, rendered frame by frame (time-deterministic): **Owl mesh** (neural mesh assembling into the Jarvis owl) on the first and last card, **Neural mesh** on every card in between — the standard look of every video; the cover (both formats) reuses the Owl mesh too, frozen at its assembled end state (`__draw(2.6)`) behind the app screenshot — never the plain gradient alone |
| `frontend/e2e/video/fonts.conf` | maps `system-ui`/`sans-serif` to Inter for the recording (the Playwright image falls back to a CJK font) |
| `frontend/e2e/video/build-video.mjs` | timeline → two ffmpeg passes (sub-pixel eased zoom via `perspective`, then caption/card overlays + narration mix). Cards less than 0.3 s apart (back-to-back chapter/showcase slides with no demo between them) hard-cut into each other — no fade on that shared edge, overlay window closed exactly at the boundary — instead of each dipping toward the base screencast independently, which flashed whatever the app happened to show for a beat |
| `frontend/e2e/video/example.storyboard.ts` | complete storyboard of v1.12.0 — the release template |
| `frontend/e2e/video/example.narration.json` | its voice-over script |
| `frontend/e2e/video/intro.storyboard.ts` + `intro.narration.json` | product introduction video ("What is Jarvis?"), project `intro` — refresh it when the UI changed noticeably |

The release cover's standard subtitle is **“When the alert disappears but
the questions remain”**. Keep it in the copied release storyboard unless the
release has a stronger, specifically approved campaign line. The product-intro
cover additionally uses **“An Alertmanager Frontend for Day-to-Day
Infrastructure Operations”** as its headline.
| `frontend/playwright.video.config.ts` | viewport per `VIDEO_FORMAT` (landscape 1600×900, square 1200×1200) |
| `scripts/release-video.sh` | orchestration: `tts` → `record` (via `scripts/e2e-run.sh video none`) → `render` |
| `scripts/release-video/tts/` | voice container: Kokoro-82M (Apache-2.0) via kokoro-onnx, int8 model, checksum-pinned — local, free, no account |

Entry point: `make release-video VERSION=X.Y.Z [STEP=all|tts|record|render] [PROJECT=release]`.
Each video is a *project*: storyboard `frontend/e2e/_video/<project>.video.ts`,
narration `frontend/e2e/_video/<project>.narration.json`, work files in
`frontend/e2e/_video/<project>/`, output in `~/Downloads/jarvis-<project>-video/`.
Release videos use project `release`; the intro video `PROJECT=intro VERSION=intro`.

---

## Workflow

### 1. Pick the story (one chapter per visible feature)

From the release notes' *Added*/*Changed* sections (`.github/release-notes/vX.Y.Z.md`),
give every feature a user **sees** its own chapter — skip internals and
anything without a visible effect; fixes get at most one short showcase
slide at the end, only if substantial. Order chapters as a small journey
(filter → organize → act). Each chapter runs **~15–30 s**, split into 2–4
narrated sub-steps (problem → action shown → effect marked → benefit in one
sentence). Total length scales with the number of shown features — typically
**2–4 min**. Tell the user in the hand-over that X needs either the YouTube
link or a clip ≤ 2:20 (no X Premium) if they want to post it natively there.

### 2. Write the narration (`frontend/e2e/_video/release.narration.json`)

Copy `frontend/e2e/video/example.narration.json`. One segment per scene, `id`
= the storyboard's scene id, plus `intro` and `outro`.

- English, spoken style, one or two short sentences per segment (≤ 25 words).
- Say what the viewer gains, not what the code does. No version numbers as
  digits the voice may misread: "one point twelve", not "1.12.0".
- Spell out what must be pronounced literally (`k j one eight seven`).
- `voice`: `af_heart` default; alternatives `af_bella`, `am_michael`,
  `am_fenrir`, `bf_emma`, `bm_george`. Keep the one the user chose before.

### 3. Write the storyboard (`frontend/e2e/_video/release.video.ts`)

Copy `frontend/e2e/video/example.storyboard.ts` and adapt the scenes. Rules:

- **Fixtures only.** Seed state through the e2e helpers (`fireWithHeatmapHistory`,
  `jarvis.setClaim`, `jarvis.createSilence`, `localStorage` settings) — never
  real data.
- **Title cards**: `rec.card({ eyebrow, title, subtitle, features, cta })`
  in the `intro` and `outro` scenes, `rec.card(null)` to end one. The intro
  card's `title` is the release's promise in ≤ 8 words and `features` the
  3–4 shown features. In the video the first and last card animate the owl
  backdrop; the thumbnail (`-cover.jpg`) is the same card as a still with the
  app screenshot taken by `rec.start()` — have the dashboard in its opening
  state (populated, no popover) when calling it. The last card holds as the
  final frame (no fade-out). **Never put a `card(null)` plus a pause between
  two slides that follow each other** (intro card → first chapter slide,
  showcase → showcase → outro): a gap above 0.3 s makes the renderer fade the
  first slide out and the next one in, and the app flashes through in
  between. Let the next card replace the open one at the same instant instead.
- **Showcase slides** for facts the UI can't show (auth modes, deployment,
  supply chain): `rec.card({ eyebrow, title, tiles: [{ title, text, code? }] })`
  — 2–3 tiles, one narrated scene each, neural-mesh backdrop.
- **Every feature opens with a chapter slide**: pass
  `{ chapter: { title, subtitle } }` as the 4th argument of its first
  `rec.scene(...)` — number, feature title, one-line benefit and a progress
  strip of all features, held ~3.4 s so it can be read. The voice starts on
  the slide, the zoom resets behind it. Every sub-part of a chapter gets its
  own narration segment — a scene without one is silent. Chapter scenes get
  no caption (the slide says it); captions only mark sub-points inside a chapter (like "Alertmanager-style filter URLs").
  Aim for ≥ 10 s per chapter — shorter ones are merged in the YouTube
  chapter list.
- **Every action gets its effect marked.** After each click that changes
  something, `rec.highlight(<where it changed>)` — the new chip, the moved
  row, the badge. Viewers otherwise can't tell where anything happened.
  Pass the **element that changed**, not a wide container around it: the
  marker shrinks a stretched element to its content, draws a rounded
  rectangle around wide/flat targets (rows, chip bars, headers) and an
  enclosing ellipse around compact ones (badges, `+N` chips). Never
  highlight a whole toolbar, card grid or panel.
- **Zoom to the action**: `rec.focusOn(pad, ...locators)` before the
  interaction, `rec.focus(null)` for overviews. Boxes from locators, not
  hard-coded coordinates — the two formats have different layouts.
- **Wrap each narrated part in `rec.scene(id, caption, fn)`** — it waits for
  the voice clip, so don't pad scenes with long sleeps.
- Selectors: prefer `data-testid`, then roles. The functional e2e specs and
  `e2e/screenshots/` show working selectors for most UI.
- Time is frozen by `fireWithHeatmapHistory`; move the clock slightly past
  setup (`page.clock.setFixedTime(now + 45 s)`) so seeded times never read
  "in the future" — see the silence gotcha below before going further ahead.

Known UI gotchas (solved in the example and intro storyboards): data the e2e
stack can't provide (several Alertmanager clusters) is mocked frontend-only with
`page.route('**/api/v1/clusters', …)`; the frozen clock must not run ahead of
real time by more than the time until the first silence is created, or
browser-created silences start in the future (pending, 0 affected alerts);
the user menu opens on hover and closes on mouse-leave — click its *Settings* scoped to `user-menu-panel` with a
short move; the label color picker is portaled outside the Settings dialog; a
card's title is a group header — click the summary to open the detail panel;
chips of single-alert groups render outside `alert-card`, and so does a card's
header with its silence menu — match that button by its own label
(`Silence options for N alerts`), never by filtering `alert-card` for the
alertname; that menu opens on **hover**, a click on the trigger toggles it
shut again; card view has no "Silence group" button at all (that one is list
view only) — the card header's menu is the card view's group action, and it
only appears with a `N alerts` label when the card really holds several
alerts, so seed a second instance of one alertname if the fixtures have none;
the default saved filter is applied only when the URL carries **no**
alert-view parameter at all (`AlertsPage`) — `?state=active` already counts as
one, so demo it with a bare `page.goto('/')`.

**Seed `localStorage` only once.** `page.addInitScript` runs on *every*
navigation: re-seeding silently undoes whatever the demo just changed (a
starred default filter, pinned labels) as soon as the storyboard reloads the
page. Guard it with `if (localStorage.getItem('jarvis-user-settings')) return`.

**Let a marker fade before the view behind it changes.** `highlight()`
resolves after the drawing animation, but the SVG lives at fixed viewport
coordinates for `holdMs` + ~400 ms more. Closing a dialog right after leaves
the circle floating over whatever is underneath — wait it out first.

**Zoom follows the element you click, not the section it lives in.** In a long
scrollable list (Settings → Labels) `clickOn` scrolls the row into view, so a
zoom pinned to the section shows a click happening off-screen. Re-`focusOn`
the row before clicking it — and again after any action that **reorders or
moves** things (pinning a label lifts its row to the top of the list, opening
a portaled popover puts the next target outside the current window). The
cursor glides to the new position either way; if the zoom does not follow, the
viewer watches an empty area while something happens outside the frame.

### 4. Record and render

```bash
make release-video VERSION=X.Y.Z             # tts → record (both formats) → render
make release-video VERSION=X.Y.Z STEP=record # after a storyboard change
make release-video VERSION=X.Y.Z STEP=render # after a build-video.mjs change
```

A failing storyboard reports the locator; the page snapshot is in
`frontend/test-results/*/error-context.md`. Iterate with `STEP=record`.
Record one format first (`VIDEO_FORMATS=landscape`) while the storyboard is
still settling — a selector break costs one run instead of two.

A recording runs in real time and `finish()` then screenshots every frame of
every title card, so a 2–3 minute video needs well over five minutes of wall
clock: `playwright.video.config.ts` sets `timeout` accordingly. A "Test
timeout exceeded" inside `finish()` means that budget, not a hung page.

The podman machine needs memory headroom: stop the dev stack (`make down`)
if rendering ends with exit code 137, and wait a few seconds after rewriting
a file before a container reads it (`.agents/lessons.md`).

### 5. Check before handing over

Look at both QA contact sheets (`frontend/e2e/_video/<project>/{landscape,square}/sheet.png`,
one frame per 2.5 s — internal only, never handed to the user) and at both
covers: every scene legible at its zoom, markers around the right element
without cutting through it, captions not covering the action, no error toast,
no empty state, headline on the cover not awkwardly broken, Owl mesh behind
the app screenshot visible but not competing with headline/features text,
cover file size under YouTube's 2 MB thumbnail limit. For detail, extract
single frames with the ffmpeg image (`-ss <s> -frames:v 1`). Fix and re-run
the affected step. You can't hear the audio — say so and ask the user to
watch one video completely before uploading.

### 6. Hand over

Give the user, in the chat, and also written to `VIDEO_OUT/youtube.txt`:

1. **Files** in `VIDEO_OUT`: `jarvis-X.Y.Z-youtube.mp4` + `-youtube-cover.jpg`
   (custom thumbnail, 1920×1080, under YouTube's 2 MB limit) and
   `jarvis-X.Y.Z-linkedin.mp4` + `-linkedin-cover.jpg` (square, uploaded
   natively).
2. **YouTube**: title (`Jarvis X.Y.Z — <headline features>`, ≤ 70 chars) and
   description (2–3 sentences, bullet list of the shown features, links to
   the release and the repository, then the chapter timestamps from
   `jarvis-X.Y.Z-youtube-chapters.txt` verbatim). Upload the 16:9 file as a
   regular video — it is the one linked from the release notes and README; a
   square or vertical upload under 3 minutes would become a Short (no
   chapters, no clickable links, short shelf life).
3. Ask for the **YouTube URL** once uploaded — it goes into the release
   notes and into the social posts drafted by the release skill
   (`.agents/skills/release/SKILL.md` → *Social media posts*).

---

## Video block in the release notes

GitHub release bodies can't embed a player; use the YouTube thumbnail as a
link, directly after the *Breaking Changes* section (breaking changes stay
first):

```markdown
### Watch the highlights

<a href="https://www.youtube.com/watch?v=<VIDEO_ID>"><img src="https://img.youtube.com/vi/<VIDEO_ID>/maxresdefault.jpg" alt="Jarvis X.Y.Z highlights (video)" width="720"></a>

A one-minute tour of <shown features> — also on [LinkedIn](<post URL>).
```

`maxresdefault.jpg` is the uploaded custom thumbnail (or the HD frame). The
YouTube URL is normally already known at this point — the release skill
collects it at its review gate, right after this skill hands the video back.
A LinkedIn mention (`— also on [LinkedIn](<post URL>)`, appended the same
way) is different: the post itself usually goes out only after the release
is public, so its URL is almost never known yet — add it as a follow-up edit
once it exists. Either way, a late arrival follows the same path: check the
release still accepts edits (`gh release view vX.Y.Z --json isImmutable`),
insert the block into the *published* body (it also holds the
workflow-appended artifact sections) with `gh release edit vX.Y.Z
--notes-file`, and sync `.github/release-notes/vX.Y.Z.md` in a follow-up PR.

Drafting the LinkedIn, X and Reddit posts themselves is the release skill's
job, not this one — see `.agents/skills/release/SKILL.md` → *Social media
posts*.
