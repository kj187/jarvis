#!/usr/bin/env node
// Release-video renderer input (.agents/skills/release-video/SKILL.md).
//
// Usage: node e2e/video/build-video.mjs <workdir> <format>
//
// Reads <workdir>/<format>/timeline.json (written by e2e/video/recorder.ts)
// and writes, next to it, two ffmpeg passes: base-{filter,inputs}.txt (zoomed
// base video) and {filter,inputs}.txt (overlays + audio; inputs one argument
// per line). scripts/release-video.sh runs both. Kept free of dependencies so
// it runs in any Node.
//
// Graph: screencast frames (variable frame timing via the concat demuxer) →
// constant 30 fps → sub-pixel zoom (perspective) following the eased keyframes (frames are
// recorded at device-pixel resolution, so zooming downscales) → caption PNGs
// and full-frame title cards faded in/out → narration WAVs delayed to their
// scene cues, mixed and loudness-normalized.

import fs from 'node:fs'
import path from 'node:path'

const [workdir, format] = process.argv.slice(2)
if (!workdir || !format) {
  console.error('usage: build-video.mjs <workdir> <format>')
  process.exit(1)
}

const dir = path.join(workdir, format)
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'))

const EASE_SECONDS = 0.9
const FADE = 0.35
const FPS = 30

const frameScale = tl.frameScale ?? 1
const srcW = Math.round(tl.width * frameScale)
const srcH = Math.round(tl.height * frameScale)

// Smoothstep between keyframes: v0 + Σ Δv_i · smooth(clip((t - t_i) / D)).
// Summed instead of nested ifs so the expression stays linear in keyframes.
const T = `(in/${FPS})`
const smooth = (t) => {
  const s = `clip((${T}-${t.toFixed(3)})/${EASE_SECONDS},0,1)`
  return `(${s})*(${s})*(3-2*(${s}))`
}
const keyframeExpr = (key, factor) => {
  const k = tl.zooms
  let e = (k[0][key] * factor).toFixed(4)
  for (let i = 1; i < k.length; i++) {
    const d = (k[i][key] - k[i - 1][key]) * factor
    if (Math.abs(d) > 1e-6) e += `+(${d.toFixed(4)})*${smooth(k[i].t)}`
  }
  return e
}
const z = keyframeExpr('z', 1)
const cx = keyframeExpr('cx', srcW / tl.width)
const cy = keyframeExpr('cy', srcH / tl.height)

// Two passes keep peak memory low: (1) frames → zoomed base video
// (base.mkv, near-lossless), (2) base + overlays + narration → final video.
// In one graph the 3200 px decode plus every overlay's decode queue exhausts a
// 2 GB podman machine.
const baseInputs = ['-f', 'concat', '-safe', '0', '-i', `${format}/list.txt`]
const baseGraph = []
// The zoom window [x0,x1]×[y0,y1] in source pixels, kept inside the frame.
// `perspective` samples it with sub-pixel precision; zoompan rounds the
// window to whole pixels, which makes every zoom move jitter ±1 px per frame —
// visible as flickering edges and backgrounds.
// max(1,…) and max(0,…): eased sums land on 0.9999999 instead of 1, and
// ffmpeg's clip() returns NaN when max < min — perspective then fails with EINVAL.
const winW = `(${srcW}/max(1,${z}))`
const winH = `(${srcH}/max(1,${z}))`
const x0 = `clip(${cx}-${winW}/2,0,max(0,${srcW}-${winW}))`
const y0 = `clip(${cy}-${winH}/2,0,max(0,${srcH}-${winH}))`
const x1 = `(${x0}+${winW})`
const y1 = `(${y0}+${winH})`
baseGraph.push(
  // trim: the concat demuxer stretches the last still frame past the recording's end.
  `[0:v]fps=${FPS},trim=duration=${tl.duration.toFixed(3)},setpts=N/${FPS}/TB,format=yuv444p,`
  + `perspective=x0='${x0}':y0='${y0}':x1='${x1}':y1='${y0}':x2='${x0}':y2='${y1}':x3='${x1}':y3='${y1}'`
  + `:interpolation=cubic:sense=source:eval=frame,`
  + `scale=${tl.outWidth}:${tl.outHeight}:flags=lanczos,setsar=1,format=yuv420p[vout]`,
)

const inputs = ['-i', `${format}/base.mkv`]
const graph = []
let video = '0:v'
let input = 1

/**
 * Overlays a still PNG between start and end with alpha fades. The PNG comes
 * from a `movie=` source inside the graph, which is pulled on demand — a
 * looped `-i` input (with or without -itsoffset) is decoded ahead and its
 * frames queue up until their time, which runs out of memory with several
 * full-frame cards.
 */
let overlays = 0
const overlay = (source, start, end, { fadeIn, fade = FADE, filters, position, fadeOut }) => {
  const n = overlays++
  const label = `o${n}`
  const next = `v${n}`
  // An overlay that lasts to the end of the video (the outro card) must not
  // fade out and keeps its last frame: players show it when playback stops.
  const holdsToEnd = end >= tl.duration - 0.1
  const until = holdsToEnd ? tl.duration + 1 : end
  // `fadeOut` defaults to "yes, unless this is the outro" — an explicit
  // `false` (adjacent cards, see below) overrides that regardless.
  const doFadeOut = holdsToEnd ? false : (fadeOut ?? true)
  const fades = [
    fadeIn ? `fade=t=in:st=${start.toFixed(3)}:d=${fade}:alpha=1` : null,
    doFadeOut ? `fade=t=out:st=${(end - fade).toFixed(3)}:d=${fade}:alpha=1` : null,
  ].filter(Boolean).join(',')
  graph.push(
    `${source},setpts=N/${FPS}/TB+${start.toFixed(3)}/TB,trim=end=${(until + 0.05).toFixed(3)},`
    + `format=rgba,${filters}${fades ? `,${fades}` : ''}[${label}]`,
    // eof_action=repeat everywhere: `enable` already bounds visibility, while
    // `pass` let the base video show through for the frame or two between a
    // card's last rendered frame and the boundary — a one-frame flash of the
    // app between two back-to-back slides.
    `[${video}][${label}]overlay=${position}:enable='between(t,${start.toFixed(3)},${until.toFixed(3)})':eof_action=repeat[${next}]`,
  )
  video = next
}

// Caption PNGs are rendered at deviceScaleFactor 2 (title 80 px) → ~48 px at 1080p.
const captionScale = (tl.outHeight / 1080) * 0.6
for (const c of tl.captions) {
  const start = c.start + 0.15
  overlay(`movie=${format}/${c.file}:loop=0`, start, Math.max(start + 0.8, c.end), {
    fadeIn: true,
    filters: `scale=iw*${captionScale.toFixed(4)}:-1`,
    position: `x=(W-w)/2:y=H-h-${Math.round(tl.outHeight * 0.05)}`,
  })
}
// Cards are animated frame sequences at output size (recorder.ts renders the
// owl/mesh backdrops frame by frame). A longer fade makes the card ↔ app
// transition smooth.
//
// Consecutive cards with no real demo between them (back-to-back chapter/
// showcase slides) are "adjacent": below this gap, whatever the base video
// shows at that instant is just whatever frame the screencast happened to be
// on, not a deliberate scene — fading the first card out and the second in
// independently both dip toward zero alpha right at the boundary, letting
// that frame flash through for a beat. A hard cut between the two card
// layers (no fade on that shared edge) goes directly from slide to slide.
const NO_DEMO_GAP = 0.3
const cardList = tl.cards ?? []
cardList.forEach((c, i) => {
  const prev = cardList[i - 1]
  const next = cardList[i + 1]
  const adjacentToPrev = !!prev && c.start - prev.end < NO_DEMO_GAP
  const adjacentToNext = !!next && next.start - c.end < NO_DEMO_GAP
  // Close a small (< NO_DEMO_GAP) real gap too, not just a zero one: without
  // this, neither overlay is "enabled" for that sliver and the base video
  // still shows through even with both fades suppressed.
  const end = adjacentToNext ? next.start : c.end
  overlay(`movie=${format}/${c.dir}/%05d.jpg:f=image2`, c.start, Math.max(c.start + 0.8, end), {
    fadeIn: !adjacentToPrev && c.start > 0.05,
    fadeOut: !adjacentToNext,
    fade: 0.6,
    filters: 'null',
    position: 'x=0:y=0',
  })
})
graph.push(`[${video}]scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[vout]`)

const audio = tl.narration.filter((n) => fs.existsSync(path.join(workdir, 'narration', `${n.id}.wav`)))
audio.forEach((n, i) => {
  inputs.push('-i', `narration/${n.id}.wav`)
  const ms = Math.round(n.start * 1000)
  graph.push(`[${input}:a]aresample=48000,adelay=${ms}|${ms}[a${i}]`)
  input++
})
if (audio.length > 0) {
  graph.push(
    `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0,`
    + `apad,atrim=0:${tl.duration.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
  )
}

fs.writeFileSync(path.join(dir, 'base-filter.txt'), `${baseGraph.join(';\n')}\n`)
fs.writeFileSync(path.join(dir, 'base-inputs.txt'), `${baseInputs.join('\n')}\n`)
fs.writeFileSync(path.join(dir, 'filter.txt'), `${graph.join(';\n')}\n`)
fs.writeFileSync(path.join(dir, 'inputs.txt'), `${inputs.join('\n')}\n`)
console.log(`${format}: ${tl.duration.toFixed(1)}s, source ${srcW}x${srcH}, ${tl.zooms.length} zooms, ${tl.captions.length} captions, ${(tl.cards ?? []).length} cards, ${audio.length} narration clips → ${tl.outWidth}x${tl.outHeight}`)
