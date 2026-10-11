---
name: teaser-video
description: Change or rebuild the 45-second homepage teaser video (office opening, real UI beats, voice-over, end plate) and its embedding on the docs homepage. Only when the user asks for it — generating clips or voice costs the user's Higgsfield credits.
---

# Jarvis — Homepage Teaser Video

The docs homepage plays a self-hosted teaser, `docs/assets/jarvis-teaser.mp4`
(1920×1080, ~45 s, voice-over plus music, ~6 MB), with the poster
`docs/assets/jarvis-teaser-poster.jpg`. This file is what an agent needs to
change it in a later session. It is a different thing from the narrated
release and intro videos (`.agents/skills/release-video/SKILL.md`), which go to
YouTube and never enter the repository.

**Never without an explicit request, and never spend credits unasked.** Every
generated image, clip or voice line costs the user's Higgsfield credits. Run a
cost preflight (`get_cost: true`), name the price, and wait for a go-ahead.
Prefer the free path: everything except the office footage and the final voice
is rendered locally.

## What is in the film

| Time | Picture | Source |
|---|---|---|
| 0–4.4 s | Title plate over the dimmed office: wordmark, headline, tagline, URL, owl on its animated neural mesh | local |
| 4.4–7.6 s | Office; the wall TV shows the empty Jarvis board, then `KubePodCrashLooping` fires; the neon owl's red eye glows | AI clip + local composite |
| 7.6–9 s | Camera flies into the TV until the UI fills the frame | local |
| 9–33 s | Five UI beats: detail panel · claim and note · silence with "1 affected alert" and preview · alert turns Resolved · History tab | recorded UI |
| 33–45 s | Camera flies back out; the same title plate as the opening, frame for frame | local |

Voice-over (independent of the picture — it pitches the product, it does not
narrate the clicks), five blocks:

1. "Alertmanager tells you that something is wrong. But when the alert disappears, the questions remain."
2. "Jarvis answers them. It is the frontend for your Alertmanager that keeps the full story of every alert: who was on it, what was done, and how often it happened before."
3. "Every cluster in one live view. Claim alerts, leave notes, and silence with confidence."
4. "One container. Open source. Ready for your infrastructure."
5. "Jarvis. An Alertmanager frontend for day-to-day infrastructure operations."

## Decisions the maintainer made — do not undo silently

- **Short, not a tour.** A ~145 s narrated walkthrough exists as a by-product
  ("tour"); the homepage gets the ~45 s cut only.
- **No caption cards** in the teaser; the voice carries the message.
- **Opening and end plate are identical** (docs-hero look, no buttons, with the
  URL). No copyright line.
- **The office must look photographed**, not illustrated: a mid-sized
  open-plan room, dark oak slat wall, large wall TV, band of windows with a
  Pacific coast view, plants, dark carpet, people in varied (not all dark)
  clothing, a whiteboard sketch of the Jarvis architecture, the owl as a neon
  sign. No stickers on any screen.
- **Screens in the office stay frozen** in the animated clip. Only people,
  waves, clouds and plants move.
- **The UI on the wall TV is the real UI**, composited locally, and fills the
  screen edge to edge (the TV is redrawn as an exact 16:9 panel).
- **One alert is never silenced and then called "gone".** The silence beat uses
  a second alert (`KubeNodeNotReady`); `KubePodCrashLooping` is claimed and
  later resolves on its own, stays on the Active board as a Resolved card
  (`showRecentlyResolved`), and its History shows "Alert resolved".
- **Transitions carry meaning and take their time**: a slow, distinct move
  (≈1.6 s) into a new feature, a soft dissolve (≈1.1 s) inside one feature, the
  camera flight only between office and UI. A beat runs past its last action
  by the length of the following transition, so nothing is cut mid-click.
- **Voice**: Higgsfield preset "Vesper" (model `seed_audio`). Draft with the
  free local Kokoro voice (`scripts/release-video/tts/`, `af_heart`) first.
- **Homepage**: the teaser sits directly under the hero, the screenshot tour
  below the feature grid. The poster is a dimmed office frame (not the title
  plate — the hero above already shows the logo). A real play button covers
  the poster; the video never autoplays.

## How it is built

Nothing of the pipeline is in the repository. On the maintainer's workstation
the working copy lives in `~/Downloads/jarvis-teaser-video/` (`README.md` there
lists every file and the generation job ids). If that folder is gone, rebuild
from this description.

| Step | Tool | Notes |
|---|---|---|
| Office still | Higgsfield `gpt_image_2_5`, 16:9, 2k, high | Build it in **one** edit from a photographic base. A chain of edits repaints the whole image each round and ends up looking like an illustration |
| Office clip | Higgsfield `kling3_0_turbo`, start image = the still with the TV drawn dark, 12 s, 1080p | Prompt: locked-off tripod, every screen frozen, who looks at the TV and when. The model tends to deform small signs and lettering — pin the neon owl, the whiteboard and the TV frame back from the still |
| TV footage | Playwright, e2e stack (`scripts/e2e-run.sh video none`) | Storyboard without cursor: empty board, then one alert |
| UI footage | same, storyboard with cursor | Uses `frontend/e2e/video/recorder.ts`; `build-video.mjs` renders the zoomed base video |
| Title plate | Playwright page with `frontend/e2e/video/backdrops.js` (`owl`), transparent PNG frames | The mesh is tuned for an opaque card; over footage each frame is stamped onto itself twice |
| Composite, camera, cut | ffmpeg (`perspective`, `xfade`) and ImageMagick | Put the UI into the office canvas **before** the camera transform, or screen and room drift apart |
| Voice | Higgsfield `seed_audio` | Check every line: durations, long internal pauses, noise at the tail, a repeated first word |
| Music | a small synthesizer script (four chords, pad and plucks) | No third-party material. Higgsfield offers no standalone music through MCP |
| Web encode | `libx264 -crf 27 -preset veryslow`, AAC 112k, `+faststart` | Keep the file at a few megabytes |

## Recording gotchas

- **The e2e fixture requests reduced motion** and the app then zeroes every CSS
  transition — including the recorder cursor's glide, which then jumps. Call
  `page.emulateMedia({ reducedMotion: 'no-preference' })` in the storyboard.
- **`page.clock.setFixedTime` freezes `Date`**, so cached queries never go
  stale: after an alert resolves, step the clock forward or the History tab is
  served from before the resolution.
- **A resolved card's chip sits outside `alert-card`**; wait for
  `getByTestId('resolved-chip')` on the page, not inside the card.
- **Zoom on what changes**, not on a whole panel or dialog: a full-height panel
  cannot be zoomed and its text stays unreadable.
- **The pinned Playwright build may have no browser installed** on the
  workstation; pass an installed headless shell as `executablePath` rather
  than downloading one.
- `make website` fails inside a git worktree (the container cannot see the
  main `.git`); mount that directory read-only as well.

## Changing it

1. Decide what changes: text only (voice lines, re-mix), picture (re-record a
   beat), or the office (credits).
2. Show the user a free draft first — a still-image animatic, or the local
   voice — and collect feedback scene by scene before any paid generation.
3. Replace `docs/assets/jarvis-teaser.mp4` and, if the opening changed, the
   poster. Update the duration in `HomeVideo.vue` (visible text and
   `aria-label`).
4. `cd website && pnpm test`, build the site, and look at the homepage in a
   browser: the poster, the play button, playback.
5. Every new version adds its full size to the git history for good — commit
   only a version the user has approved.

Site wiring: `website/.vitepress/theme/components/HomeVideo.vue`,
`Layout.vue` (slot order), `.video-play` in `theme/style.css`,
`VIDEO_EXT` in `website/scripts/sync-content.mjs`, guarded by
`website/scripts/media.test.mjs`. Details:
`.agents/skills/website/references/theme-and-seo.md`.
