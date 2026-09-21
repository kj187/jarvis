# Jarvis Lessons — Release video and media

Video rendering, slides, storyboard, demo assets. Part of the lessons reference — start at `.agents/lessons.md` (index). Newest first; entry format: symptom → cause → rule.

---

## Release video: blurry zooms, flicker, CJK font, ffmpeg OOM, overlong ending

**Symptom**: Zoomed video shots looked pixelated; app text and title cards
rendered in an odd font; the 16:9 render died with exit 137/139; videos ran
seconds past the outro card; backgrounds flickered during zooms and while the
cursor moved.
**Cause**: (1) `Page.startScreencast` delivers CSS-pixel frames — emulated
`deviceScaleFactor` alone doesn't change that, and `devices['Desktop Chrome']`
spread after a top-level `deviceScaleFactor` resets it to 1. (2) The
Playwright image resolves `system-ui`/`sans-serif` to "WenQuanYi Zen Hei".
(3) ffmpeg 7 decodes every `-i` input ahead in its own queue: looped RGBA
overlays exhaust a 2 GB podman machine — with `-itsoffset` even worse, since
a late card's frames pile up until their time. (4) The concat demuxer
stretches the last still frame. (5) `zoompan` rounds its window to whole
pixels, so every zoom move jitters ±1 px per frame; moving the real mouse
along the cursor path toggles the hover background of every element it
crosses. (6) ffmpeg's `clip(x,min,max)` returns NaN when max < min — an eased
zoom ending at 0.9999999 made `perspective` fail with EINVAL.
**Rule**: `playwright.video.config.ts` sets `deviceScaleFactor: 2` inside the
project *and* launches with `--force-device-scale-factor=2` (layout stays at
the CSS viewport); `scripts/e2e-run.sh video` installs Inter and
`e2e/video/fonts.conf`; rendering runs in two passes (zoomed base video, then
overlays + audio), overlays are pulled on demand from `movie=` sources inside
the graph and cards are pre-scaled to output size; the base graph trims to the
timeline duration and zooms with `perspective` (sub-pixel) on a zoom clamped to
≥ 1; `VideoRecorder.moveTo` animates only the drawn cursor and fires one real
mouse move at the target. `frontend/e2e/_video` is excluded in
`.containerignore`/`.dockerignore`: `Containerfile.e2e` copies `frontend/`,
and without the entry every e2e image build dragged gigabytes of frames into
its context until the podman machine ran out of disk. Animated cards are
rendered on `about:blank`: `page.setContent` keeps the current document's
origin and Content-Security-Policy, and Jarvis's strict CSP silently blocks
the backdrop's inline script (the frame loop then waits forever). The same font and scale-factor issues affect the doc
screenshots (`playwright.screenshots.e2e.config.ts`) — not changed there yet.

---

## One frame of the app flashed between two back-to-back video slides

**Symptom**: In a rendered demo video, the cut from one full-frame slide to
the next showed the Jarvis UI for a single frame — visible as a flicker, but
gone before you could pause on it. Two slides that were adjacent in the
timeline (gap 0.000 s), with the hard-cut logic in `build-video.mjs` doing
exactly what it should: no fade on the shared edge.
**Cause**: Two independent bugs that look identical on screen. (1) A
`rec.card(null)` plus a pause between two slides opens a real gap; anything
above `NO_DEMO_GAP` (0.3 s) is treated as a deliberate return to the demo, so
both slides fade independently and the base video shows through. (2) Even
with a zero gap, the card overlay's `eof_action=pass` let the base video
through for the frame or two between the card's last rendered frame and the
end of its `enable` window — the image sequence runs out a hair before the
boundary.
**Rule**: Slides that follow each other directly never get a `card(null)` +
pause in between — the next `rec.card(...)` closes the previous one at the
same instant. Card overlays render with `eof_action=repeat`; `enable` already
bounds visibility, so holding the last frame costs nothing and closes the
rounding hole. Verify at frame level, not from the contact sheet: the sheet
samples one frame per 2.5 s and cannot show a one-frame artifact
(`ffmpeg -ss <t> -t 0.5 -vf tile=5x3`).

---

## A reload during a storyboard undid what the demo had just changed

**Symptom**: The release video's "star a filter as your default" scene broke:
after `page.goto(...)` the star was unset again, no default was applied, and
the follow-up click on *Unset … as default* timed out.
**Cause**: `page.addInitScript` runs on **every** navigation, not once. The
storyboard's seed script rewrote `localStorage['jarvis-user-settings']` with
the pristine fixture on reload, discarding the starred filter. On top of
that, `AlertsPage` applies the default saved filter only when the URL carries
no alert-view parameter at all — and `?state=active` is already one, so even
a preserved star would not have shown.
**Rule**: Seed once (`if (localStorage.getItem('jarvis-user-settings'))
return`) whenever a storyboard or spec navigates more than once, and use a
bare `/` when the point is "what Jarvis does without any parameters".
