import type { Locator, Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Release-video recorder (.agents/skills/release-video/SKILL.md).
 *
 * A storyboard spec (e2e/_video/<project>.video.ts, gitignored) drives the
 * real UI against the e2e stack; this recorder captures it via the Chromium
 * screencast at device-pixel resolution (crisp when zoomed — Playwright's
 * recordVideo is 1 Mbit/s VP8), draws a visible cursor and hand-drawn marker
 * shapes, and writes a timeline (zoom keyframes, captions, title cards,
 * narration cues) that e2e/video/build-video.mjs turns into ffmpeg input.
 * Frames and videos stay under e2e/_video/<project>/ and the user's VIDEO_OUT.
 */

export type VideoFormat = 'landscape' | 'square'

export const VIDEO_FORMATS: Record<VideoFormat, { width: number; height: number; outWidth: number; outHeight: number }> = {
  landscape: { width: 1600, height: 900, outWidth: 1920, outHeight: 1080 },
  square: { width: 1200, height: 1200, outWidth: 1080, outHeight: 1080 },
}

export function currentVideoFormat(): VideoFormat {
  const f = process.env.VIDEO_FORMAT ?? 'landscape'
  if (f !== 'landscape' && f !== 'square') throw new Error(`VIDEO_FORMAT must be landscape|square, got '${f}'`)
  return f
}

/** Video project (release | intro | …): e2e/_video/<project>.video.ts + .narration.json, work dir e2e/_video/<project>/. */
export const VIDEO_PROJECT = process.env.VIDEO_PROJECT || 'release'

/** Work directory shared by TTS, recording and rendering (relative to frontend/). */
export const VIDEO_WORKDIR = path.resolve(process.cwd(), 'e2e/_video', VIDEO_PROJECT)

export interface Box { x: number; y: number; w: number; h: number }

/** Content of a full-frame title card — intro, outro and the cover image share this design. */
export interface CardContent {
  /** Small label above the headline, e.g. "Release 1.12.0". */
  eyebrow?: string
  /** Headline: the release's promise in a few words. */
  title: string
  subtitle?: string
  /** 2–4 short feature names shown as a checklist. */
  features?: string[]
  /** Call to action pill, e.g. "github.com/kj187/jarvis". */
  cta?: string
  /**
   * Showcase slide instead of the cover layout: 2–3 tiles, each a short claim
   * with one supporting line and an optional command (e.g. `helm install …`).
   */
  tiles?: Array<{ title: string; text: string; code?: string }>
}

interface Zoom { ts: number; z: number; cx: number; cy: number }
interface Caption { title: string; sub: string; start: number; end: number }
/** A chapter slide between features: number, title, benefit and a progress strip. */
export interface Chapter { title: string; subtitle?: string }

interface Card { content: CardContent; start: number; end: number; chapter?: number }
interface Cue { id: string; start: number }

const OVERLAY_CSS = `
  #vid-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-3px 0 0 -3px;z-index:2147483647;pointer-events:none;transition:transform .12s}
  #vid-cursor.down{transform:scale(.8)}
  .vid-ripple{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid rgba(96,165,250,.9);z-index:2147483646;pointer-events:none;animation:vr .5s ease-out forwards}
  @keyframes vr{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}
`

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export class VideoRecorder {
  readonly format: VideoFormat
  readonly dims: (typeof VIDEO_FORMATS)[VideoFormat]
  private readonly outDir: string
  private readonly narration: Record<string, number>
  private mouse = { x: 0, y: 0 }
  private marks = 0
  private chapterCount = 0
  private zooms: Zoom[] = []
  private captions: Caption[] = []
  private cards: Card[] = []
  private cues: Cue[] = []
  private frames: Array<{ file: string; ts: number }> = []
  private appShot = ''
  private cdp: Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>> | null = null

  constructor(private readonly page: Page) {
    this.format = currentVideoFormat()
    this.dims = VIDEO_FORMATS[this.format]
    this.outDir = path.join(VIDEO_WORKDIR, this.format)
    const durations = path.join(VIDEO_WORKDIR, 'narration', 'durations.json')
    this.narration = fs.existsSync(durations) ? JSON.parse(fs.readFileSync(durations, 'utf8')) : {}
    this.mouse = { x: this.dims.width * 0.75, y: this.dims.height * 0.85 }
  }

  /** Cursor and click ripple. Call before the first page.goto(). */
  async installOverlays(): Promise<void> {
    await this.page.addInitScript((css) => {
      const boot = () => {
        if (document.getElementById('vid-cursor')) return
        const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style)
        const c = document.createElement('div'); c.id = 'vid-cursor'
        c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
        document.body.appendChild(c)
        addEventListener('mousemove', (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px` }, true)
        addEventListener('mousedown', (e) => {
          c.classList.add('down')
          const r = document.createElement('div'); r.className = 'vid-ripple'
          r.style.left = `${e.clientX}px`; r.style.top = `${e.clientY}px`
          document.body.appendChild(r); setTimeout(() => r.remove(), 600)
        }, true)
        addEventListener('mouseup', () => c.classList.remove('down'), true)
      }
      if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot); else boot()
    }, OVERLAY_CSS)
  }

  /**
   * Shows a full-frame title card (intro/outro) from now until the next
   * `card(null)`. Cards are rendered at the end (with a screenshot of the app
   * taken in start()) and overlaid by the renderer; the intro card doubles as
   * the cover image. The page keeps running underneath — don't act while a
   * card is fully visible.
   */
  card(content: CardContent | null): void {
    const t = now()
    const open = this.cards[this.cards.length - 1]
    if (open && open.end === 0) open.end = t
    if (content) this.cards.push({ content, start: t, end: 0 })
  }

  /**
   * Eased cursor move. Only the drawn cursor glides (animated in the page);
   * the real mouse event fires once at the target. Moving the real mouse
   * along the path would switch hover backgrounds of every card, row and chip
   * it crosses on and off — in the video that reads as flickering colors.
   */
  async moveTo(x: number, y: number, ms = 650): Promise<void> {
    // A CSS transition, not a JS animation: storyboards freeze page.clock, which
    // can stall JS timing, while transitions run on the compositor.
    await this.page.evaluate(({ to, ms }) => {
      const c = document.getElementById('vid-cursor')
      if (!c) return
      c.style.transition = `left ${ms}ms cubic-bezier(.65,0,.35,1), top ${ms}ms cubic-bezier(.65,0,.35,1), transform .12s`
      c.style.left = `${to.x}px`
      c.style.top = `${to.y}px`
    }, { to: { x, y }, ms })
    await this.page.waitForTimeout(ms + 30)
    await this.page.evaluate(() => { const c = document.getElementById('vid-cursor'); if (c) c.style.transition = '' })
    await this.page.mouse.move(x, y)
    this.mouse = { x, y }
  }

  async clickOn(locator: Locator, ms = 650): Promise<void> {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (!box) throw new Error(`clickOn: ${locator} has no bounding box`)
    await this.moveTo(box.x + box.width / 2, box.y + box.height / 2, ms)
    await this.page.waitForTimeout(120)
    await this.page.mouse.down()
    await this.page.waitForTimeout(90)
    await this.page.mouse.up()
  }

  /**
   * Draws a hand-drawn marker around what just changed, holds it, then fades
   * it out — so viewers see *where* an action had its effect. Pass the
   * smallest element(s) that show the change. The marker hugs the rendered
   * content (a stretched full-width container shrinks to its content), picks
   * a rounded rectangle for wide/flat targets and an ellipse that fully
   * encloses compact ones — never a flat ellipse cutting through the target.
   * Rendered in the page, so it zooms with the picture. Resolves once drawn.
   */
  async highlight(target: Locator | Locator[] | Box, opts: { pad?: number; holdMs?: number; color?: string } = {}): Promise<void> {
    const b = 'x' in target ? target : await this.contentBoxOf(Array.isArray(target) ? target : [target])
    const pad = opts.pad ?? 8
    const aspect = b.w / b.h
    const seed = this.marks++
    const d = aspect > 2.2
      ? sketchRoundedRect(b.x - pad - 4, b.y - pad, b.w + 2 * (pad + 4), b.h + 2 * pad, seed)
      // Ellipse through the box corners needs radii ≥ half-size × √2.
      : sketchEllipse(b.x + b.w / 2, b.y + b.h / 2, (b.w / 2) * 1.42 + pad, (b.h / 2) * 1.42 + pad, seed)
    const drawMs = 600
    await this.page.evaluate(({ d, color, drawMs, holdMs }) => {
      const ns = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(ns, 'svg')
      svg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646;pointer-events:none;overflow:visible;transition:opacity .35s')
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', d)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', color)
      path.setAttribute('stroke-width', '4.5')
      path.setAttribute('stroke-linecap', 'round')
      path.setAttribute('stroke-linejoin', 'round')
      path.setAttribute('style', 'filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))')
      svg.appendChild(path)
      document.body.appendChild(svg)
      const len = path.getTotalLength()
      path.style.strokeDasharray = `${len}`
      path.style.strokeDashoffset = `${len}`
      path.getBoundingClientRect()
      path.style.transition = `stroke-dashoffset ${drawMs}ms cubic-bezier(.45,.05,.3,1)`
      path.style.strokeDashoffset = '0'
      setTimeout(() => { svg.style.opacity = '0' }, drawMs + holdMs)
      setTimeout(() => svg.remove(), drawMs + holdMs + 400)
    }, { d, color: opts.color ?? '#facc15', drawMs, holdMs: opts.holdMs ?? 1400 })
    await this.page.waitForTimeout(drawMs)
  }

  /** Union bounding box of the locators plus padding (CSS px). */
  async boxOf(pad: number, ...locators: Locator[]): Promise<Box> {
    const boxes = await Promise.all(locators.map(async (l) => {
      const b = await l.boundingBox()
      if (!b) throw new Error(`boxOf: ${l} has no bounding box`)
      return { x: b.x, y: b.y, w: b.width, h: b.height }
    }))
    return padBox(unionBox(boxes), pad)
  }

  /**
   * Zoom the rendered video onto a region (CSS px); `null` shows the full
   * viewport. The renderer eases between keyframes and keeps the window
   * inside the frame, so a box near an edge is fine.
   */
  focus(box: Box | null, maxZoom = 1.8): void {
    const { width, height } = this.dims
    if (!box) { this.zooms.push({ ts: now(), z: 1, cx: width / 2, cy: height / 2 }); return }
    const z = Math.max(1, Math.min(maxZoom, width / box.w, height / box.h))
    this.zooms.push({ ts: now(), z, cx: box.x + box.w / 2, cy: box.y + box.h / 2 })
  }

  async focusOn(pad: number, ...locators: Locator[]): Promise<void> {
    this.focus(await this.boxOf(pad, ...locators))
  }

  /**
   * One storyboard scene: shows the caption, cues narration `id` (if the TTS
   * step produced it) and — after `run` — waits until that narration has
   * finished, so voice and picture stay in sync without hand-tuned waits.
   *
   * `opts.chapter` opens the scene with a chapter slide (the first scene of
   * each feature): the voice already starts on the slide, the picture resets
   * to the overview behind it, and the demo continues when it fades out — so
   * viewers always see where one feature ends and the next begins. Chapter
   * slides also become the YouTube chapter timestamps (chapters.txt).
   */
  async scene(
    id: string,
    caption: { title: string; sub?: string } | null,
    run: () => Promise<void>,
    opts: { chapter?: Chapter; chapterMs?: number } = {},
  ): Promise<void> {
    const start = now()
    this.closeCaption(start)
    if (this.narration[id] !== undefined) this.cues.push({ id, start: start + NARRATION_LEAD })
    if (opts.chapter) {
      this.card(null)
      this.cards.push({ content: { title: opts.chapter.title, subtitle: opts.chapter.subtitle }, start, end: 0, chapter: this.chapterCount++ })
      // Reset the zoom once the slide covers the picture; the scene zooms in visibly afterwards.
      await this.page.waitForTimeout(400)
      this.focus(null)
      await this.page.waitForTimeout(Math.max(0, (opts.chapterMs ?? 3400) - 400))
      this.card(null)
    }
    if (caption) this.captions.push({ title: caption.title, sub: caption.sub ?? '', start: now(), end: 0 })
    await run()
    const spoken = (this.narration[id] ?? 0) + NARRATION_LEAD + NARRATION_TAIL
    const left = spoken - (now() - start)
    if (left > 0) await this.page.waitForTimeout(left * 1000)
  }

  /** Starts the screencast. The app should show its opening state: it is also the title cards' screenshot. */
  async start(): Promise<void> {
    fs.rmSync(this.outDir, { recursive: true, force: true })
    fs.mkdirSync(this.outDir, { recursive: true })
    await this.page.evaluate(() => { const c = document.getElementById('vid-cursor'); if (c) c.style.visibility = 'hidden' })
    this.appShot = (await this.page.screenshot({ type: 'jpeg', quality: 88 })).toString('base64')
    await this.page.evaluate(() => { const c = document.getElementById('vid-cursor'); if (c) c.style.visibility = '' })
    await this.page.mouse.move(this.mouse.x, this.mouse.y)

    const dpr = await this.page.evaluate(() => window.devicePixelRatio)
    this.cdp = await this.page.context().newCDPSession(this.page)
    let n = 0
    this.cdp.on('Page.screencastFrame', async (f) => {
      const file = `f${String(n++).padStart(5, '0')}.jpg`
      fs.writeFileSync(path.join(this.outDir, file), Buffer.from(f.data, 'base64'))
      this.frames.push({ file, ts: f.metadata.timestamp ?? now() })
      try { await this.cdp?.send('Page.screencastFrameAck', { sessionId: f.sessionId }) } catch { /* session closed */ }
    })
    // max* in device pixels: at deviceScaleFactor 2 zoomed shots downscale instead of upscaling.
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg', quality: 90, maxWidth: this.dims.width * dpr, maxHeight: this.dims.height * dpr, everyNthFrame: 1,
    })
    this.focus(null)
  }

  /** Stops the screencast and writes list.txt, caption/card PNGs and timeline.json. */
  async finish(): Promise<void> {
    if (!this.cdp) throw new Error('finish() before start()')
    const end = now()
    this.closeCaption(end)
    this.card(null)
    await this.cdp.send('Page.stopScreencast')
    await this.page.waitForTimeout(300)
    if (this.frames.length === 0) throw new Error('screencast produced no frames')

    // Screencast emits a frame only on repaint: each frame lasts until the next.
    this.frames.sort((a, b) => a.ts - b.ts)
    const t0 = this.frames[0].ts
    const lines: string[] = []
    this.frames.forEach((f, i) => {
      const next = i + 1 < this.frames.length ? this.frames[i + 1].ts : end
      lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`)
    })
    lines.push(`file '${this.frames[this.frames.length - 1].file}'`)
    fs.writeFileSync(path.join(this.outDir, 'list.txt'), `${lines.join('\n')}\n`)
    const frameWidth = jpegWidth(fs.readFileSync(path.join(this.outDir, this.frames[0].file)))

    // Captions and cards are rendered by the browser and overlaid after
    // zooming, so they stay sharp and never zoom out of frame.
    for (let i = 0; i < this.captions.length; i++) {
      const c = this.captions[i]
      await this.page.setContent(`<body style="margin:0;background:transparent"><div id="c" style="display:inline-block;margin:24px;background:rgba(10,14,24,.92);border:1.5px solid rgba(96,165,250,.5);color:#f3f4f6;border-radius:18px;padding:16px 34px;font:700 40px/1.2 Inter,system-ui,sans-serif;letter-spacing:-.01em;text-align:center;white-space:nowrap;box-shadow:0 12px 40px rgba(0,0,0,.45)">${escapeHtml(c.title)}${c.sub ? `<div style="font-weight:400;font-size:25px;color:#9ca3af;margin-top:6px;letter-spacing:0">${escapeHtml(c.sub)}</div>` : ''}</div></body>`)
      await this.page.locator('#c').screenshot({ path: path.join(this.outDir, `cap${i}.png`), omitBackground: true })
    }
    const logoB64 = (await (await this.page.request.get('/logo.png')).body()).toString('base64')
    const chapterTitles = this.cards.filter((c) => c.chapter !== undefined).map((c) => c.content.title)
    const cardFrames: number[] = []
    if (this.cards.length > 0) {
      // Leave the app's origin first: setContent keeps the current document's
      // Content-Security-Policy, and Jarvis's strict CSP blocks the backdrop's inline script —
      // the cover needs the backdrop too, so this must happen before it, not just before the loop.
      const { outWidth, outHeight, width } = this.dims
      await this.page.goto('about:blank')
      await this.page.setViewportSize({ width: outWidth, height: outHeight })

      // Cover image (thumbnail, both formats): the opening card as a still, with the
      // app screenshot in front of the Owl mesh frozen at its assembled end state
      // (ASSEMBLE=2.1s + max per-node delay 0.5s in backdrops.js — t=2.6 is fully settled),
      // same look as the video's own first/last card, not the plain static gradient alone.
      await this.page.setContent(cardHtml(this.cards[0].content, this.format, logoB64, this.appShot, 'owl', true))
      await this.page.evaluate((z) => { document.documentElement.style.zoom = String(z) }, outWidth / width)
      await this.page.evaluate(() => document.fonts.ready)
      await this.page.waitForFunction(() => (window as unknown as { __draw?: unknown }).__draw !== undefined)
      await this.page.evaluate((t) => (window as unknown as { __draw: (t: number) => void }).__draw(t), 2.6)
      await this.page.screenshot({ path: path.join(this.outDir, 'cover.png') })

      // In the video every card is an animated frame sequence at output size:
      // the first and last card assemble the owl, all others drift the neural mesh.
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i]
        const edge = i === 0 || i === this.cards.length - 1
        const html = c.chapter !== undefined
          ? chapterHtml(c.content, c.chapter, chapterTitles, this.format, logoB64)
          : c.content.tiles?.length
            ? showcaseHtml(c.content, this.format, logoB64)
            : cardHtml(c.content, this.format, logoB64, this.appShot, edge ? 'owl' : 'mesh')
        await this.page.setContent(html)
        await this.page.evaluate((z) => { document.documentElement.style.zoom = String(z) }, outWidth / width)
        await this.page.evaluate(() => document.fonts.ready)
        await this.page.waitForFunction(() => (window as unknown as { __draw?: unknown }).__draw !== undefined)
        const dir = path.join(this.outDir, `card${i}`)
        fs.mkdirSync(dir, { recursive: true })
        const frames = Math.max(1, Math.round((c.end - c.start) * CARD_FPS)) + 1
        for (let f = 0; f < frames; f++) {
          await this.page.evaluate((t) => (window as unknown as { __draw: (t: number) => void }).__draw(t), f / CARD_FPS)
          await this.page.screenshot({ path: path.join(dir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92, scale: 'css' })
        }
        cardFrames.push(frames)
      }
    }

    fs.writeFileSync(path.join(this.outDir, 'chapters.txt'), youtubeChapters(
      this.cards.filter((c) => c.chapter !== undefined).map((c) => ({ at: Math.max(0, c.start - t0), title: c.content.title })),
      end - t0,
    ))

    fs.writeFileSync(path.join(this.outDir, 'timeline.json'), JSON.stringify({
      format: this.format,
      ...this.dims,
      frameScale: frameWidth / this.dims.width,
      duration: end - t0,
      zooms: this.zooms.map((z) => ({ t: Math.max(0, z.ts - t0), z: z.z, cx: z.cx, cy: z.cy })),
      captions: this.captions.map((c, i) => ({ file: `cap${i}.png`, title: c.title, start: c.start - t0, end: c.end - t0 })),
      cards: this.cards.map((c, i) => ({ dir: `card${i}`, frames: cardFrames[i], title: c.content.title, chapter: c.chapter ?? null, start: Math.max(0, c.start - t0), end: c.end - t0 })),
      narration: this.cues.map((c) => ({ id: c.id, start: Math.max(0, c.start - t0) })),
    }, null, 2))
  }

  /** Box of the rendered content — a stretched (flex-1, full-width) element shrinks to what it shows. */
  private async contentBoxOf(locators: Locator[]): Promise<Box> {
    const boxes = await Promise.all(locators.map((l) => l.evaluate((el) => {
      const e = el.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(el)
      const c = range.getBoundingClientRect()
      const stretched = c.width > 0 && c.height > 0 && e.width > c.width * 1.6
      const r = stretched ? c : e
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    })))
    return unionBox(boxes)
  }

  private closeCaption(at: number): void {
    const open = this.captions[this.captions.length - 1]
    if (open && open.end === 0) open.end = at
  }
}

// ── Title card design (intro, outro, cover) ──────────────────────────────────

function cardHtml(c: CardContent, format: VideoFormat, logoB64: string, shotB64: string, backdrop: 'owl' | 'mesh' | null, showScreenshot = backdrop === null): string {
  if (c.tiles?.length) return showcaseHtml(c, format, logoB64)
  const { width, height } = VIDEO_FORMATS[format]
  const square = format === 'square'
  const features = (c.features ?? []).map((f) => `<li><span class="tick"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>${escapeHtml(f)}</li>`).join('')
  return `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${width}px;height:${height}px;overflow:hidden;background:#060912}
  body{font-family:Inter,system-ui,sans-serif;color:#f8fafc;-webkit-font-smoothing:antialiased;position:relative}
  .bg{position:absolute;inset:0;background:
      radial-gradient(${square ? '900px 700px at 20% 5%' : '1000px 700px at 12% 0%'},rgba(37,99,235,.38),transparent 62%),
      radial-gradient(${square ? '900px 800px at 100% 100%' : '900px 800px at 100% 100%'},rgba(124,58,237,.30),transparent 60%),
      radial-gradient(600px 400px at 50% 50%,rgba(14,165,233,.07),transparent 70%),#060912}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.07) 1px,transparent 1px);
      background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse ${square ? '80% 55% at 50% 30%' : '60% 80% at 25% 45%'},#000 20%,transparent 75%)}
  .copy{position:absolute;${square ? 'left:84px;right:84px;top:84px' : 'left:96px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center'}}
  .brand{display:flex;align-items:center;gap:18px;font-size:42px;font-weight:700;letter-spacing:-.02em}
  .brand img{width:88px;height:88px}
  .eyebrow{display:inline-block;margin-top:${square ? 30 : 44}px;padding:7px 16px;border-radius:999px;font-size:17px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
      color:#bfdbfe;background:rgba(37,99,235,.18);border:1px solid rgba(96,165,250,.35)}
  h1{margin-top:22px;font-size:${square ? 64 : 62}px;line-height:1.06;font-weight:800;letter-spacing:-.035em;text-wrap:balance;
      background:linear-gradient(180deg,#fff 30%,#c7d2fe);-webkit-background-clip:text;color:transparent}
  p{margin-top:18px;font-size:${square ? 26 : 24}px;line-height:1.4;color:#94a3b8}
  ul{list-style:none;margin-top:30px;display:${square ? 'flex' : 'grid'};${square ? 'flex-wrap:wrap;gap:12px 26px' : 'gap:14px'}}
  li{display:flex;align-items:center;gap:12px;font-size:${square ? 22 : 23}px;font-weight:500;color:#e2e8f0}
  .tick{display:inline-flex;width:28px;height:28px;border-radius:50%;align-items:center;justify-content:center;color:#60a5fa;background:rgba(59,130,246,.16);border:1px solid rgba(96,165,250,.4)}
  .tick svg{width:15px;height:15px}
  .cta{display:inline-block;margin-top:34px;padding:12px 24px;border-radius:14px;font-size:24px;font-weight:600;color:#fff;
      background:linear-gradient(135deg,rgba(37,99,235,.9),rgba(124,58,237,.9));box-shadow:0 10px 30px rgba(59,130,246,.35)}
  .stage{position:absolute;${square ? 'left:110px;right:-150px;top:660px' : 'left:800px;top:150px;width:1100px'}}
  .window{border-radius:16px;overflow:hidden;background:#0b1020;border:1px solid rgba(148,163,184,.22);
      box-shadow:0 50px 120px rgba(0,0,0,.65),0 0 0 1px rgba(0,0,0,.4),0 0 90px rgba(59,130,246,.28)}
  .bar{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;background:#111827;border-bottom:1px solid rgba(148,163,184,.14)}
  .bar i{width:11px;height:11px;border-radius:50%;background:#334155}
  .bar i:nth-child(1){background:#ef4444aa}.bar i:nth-child(2){background:#f59e0baa}.bar i:nth-child(3){background:#22c55eaa}
  .window img{display:block;width:100%}
  .fade{position:absolute;inset:auto 0 0 0;height:${square ? 260 : 180}px;background:linear-gradient(transparent,#060912)}
  </style></head><body>
  <div class="bg"></div>
  ${backdrop ? backdropHtml(backdrop, format, logoB64) : ''}
  ${showScreenshot ? `<div class="grid"></div><div class="stage"><div class="window"><div class="bar"><i></i><i></i><i></i></div><img src="data:image/jpeg;base64,${shotB64}" alt=""></div></div><div class="fade"></div>` : ''}
  <div class="copy">
    <div class="brand"><img src="data:image/png;base64,${logoB64}" alt="">Jarvis</div>
    ${c.eyebrow ? `<div><span class="eyebrow">${escapeHtml(c.eyebrow)}</span></div>` : ''}
    <h1>${escapeHtml(c.title).replace(/-/g, '‑')}</h1>
    ${c.subtitle ? `<p>${escapeHtml(c.subtitle)}</p>` : ''}
    ${features ? `<ul>${features}</ul>` : ''}
    ${c.cta ? `<div><span class="cta">${escapeHtml(c.cta)}</span></div>` : ''}
  </div>
  </body></html>`
}

function showcaseHtml(c: CardContent, format: VideoFormat, logoB64: string): string {
  const { width, height } = VIDEO_FORMATS[format]
  const square = format === 'square'
  const tiles = (c.tiles ?? []).map((t) => `<section><h2>${escapeHtml(t.title)}</h2><p>${escapeHtml(t.text)}</p>${t.code ? `<code>${escapeHtml(t.code)}</code>` : ''}</section>`).join('')
  return `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${width}px;height:${height}px;overflow:hidden;background:#060912}
  body{font-family:Inter,system-ui,sans-serif;color:#f8fafc;-webkit-font-smoothing:antialiased;position:relative}
  .bg{position:absolute;inset:0;background:radial-gradient(1000px 700px at 12% 0%,rgba(37,99,235,.34),transparent 62%),radial-gradient(900px 800px at 100% 100%,rgba(124,58,237,.28),transparent 60%),#060912}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.06) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 30% 30%,#000 20%,transparent 75%)}
  .wrap{position:absolute;left:${square ? 84 : 96}px;right:${square ? 84 : 96}px;top:${square ? 76 : 60}px;bottom:${square ? 84 : 72}px;display:flex;flex-direction:column}
  .body{flex:1;display:flex;flex-direction:column;justify-content:center;padding-bottom:${square ? 20 : 40}px}
  .brand{display:flex;align-items:center;gap:16px;font-size:34px;font-weight:700;color:#cbd5e1}
  .brand img{width:68px;height:68px}
  .eyebrow{align-self:flex-start;padding:7px 16px;border-radius:999px;font-size:17px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#bfdbfe;background:rgba(37,99,235,.18);border:1px solid rgba(96,165,250,.35)}
  h1{margin-top:20px;font-size:${square ? 64 : 70}px;line-height:1.04;font-weight:800;letter-spacing:-.035em;text-wrap:balance;background:linear-gradient(180deg,#fff 30%,#c7d2fe);-webkit-background-clip:text;color:transparent}
  .tiles{margin-top:${square ? 40 : 56}px;display:grid;grid-template-columns:${square ? '1fr' : `repeat(${(c.tiles ?? []).length},1fr)`};gap:${square ? 18 : 24}px}
  section{padding:${square ? '22px 26px' : '30px 30px 28px'};border-radius:18px;background:linear-gradient(180deg,rgba(15,23,42,.78),rgba(15,23,42,.55));border:1px solid rgba(148,163,184,.18);box-shadow:0 20px 60px rgba(0,0,0,.35)}
  section h2{font-size:${square ? 28 : 30}px;font-weight:700;letter-spacing:-.02em;color:#fff}
  section p{margin-top:10px;font-size:${square ? 20 : 21}px;line-height:1.45;color:#94a3b8;text-wrap:pretty}
  section code{display:block;margin-top:${square ? 12 : 18}px;padding:10px 14px;border-radius:10px;font:500 ${square ? 15 : 16}px/1.4 'JetBrains Mono',ui-monospace,monospace;color:#bfdbfe;background:rgba(2,6,23,.7);border:1px solid rgba(96,165,250,.25);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style></head><body>
  <div class="bg"></div>${backdropHtml('mesh', format, logoB64)}
  <div class="wrap">
    <div class="brand"><img src="data:image/png;base64,${logoB64}" alt="">Jarvis</div>
    <div class="body">
      ${c.eyebrow ? `<span class="eyebrow">${escapeHtml(c.eyebrow)}</span>` : ''}
      <h1>${escapeHtml(c.title).replace(/-/g, '\u2011')}</h1>
      <div class="tiles">${tiles}</div>
    </div>
  </div>
  </body></html>`
}

/**
 * YouTube description chapters from the chapter slides. YouTube only shows
 * chapters when the list starts at 0:00, has at least three entries and every
 * entry lasts ≥ 10 s — so the intro folds into the first chapter, the outro
 * into the last, and a chapter that is still too short merges with its
 * neighbour ("A & B").
 */
function youtubeChapters(chapters: Array<{ at: number; title: string }>, duration: number): string {
  const MIN = 10
  const marks = chapters.map((c) => ({ ...c }))
  if (marks.length === 0) return '# No chapter slides — no YouTube chapters.\n'
  marks[0].at = 0
  const length = (i: number) => (marks[i + 1]?.at ?? duration) - marks[i].at
  for (let i = 0; i < marks.length;) {
    if (length(i) >= MIN || marks.length === 1) { i++; continue }
    const withNext = i + 1 < marks.length
    const a = withNext ? i : i - 1
    marks.splice(a, 2, { at: marks[a].at, title: `${marks[a].title} & ${marks[a + 1].title}` })
    i = Math.max(0, a)
  }
  const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const list = marks.map((m) => `${stamp(m.at)} ${m.title}`).join('\n')
  return marks.length >= 3 ? `${list}\n` : `${list}\n# Fewer than 3 chapters of ≥ 10 s — YouTube will not show chapters for this video.\n`
}

function chapterHtml(c: CardContent, index: number, titles: string[], format: VideoFormat, logoB64: string): string {
  const { width, height } = VIDEO_FORMATS[format]
  const square = format === 'square'
  // More than four chapters: a denser progress strip so titles still fit.
  const many = titles.length > 4
  const steps = titles.map((t, i) => `<li class="${i === index ? 'on' : i < index ? 'done' : ''}"><b>${String(i + 1).padStart(2, '0')}</b><span>${escapeHtml(t)}</span></li>`).join('')
  return `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${width}px;height:${height}px;overflow:hidden;background:#060912}
  body{font-family:Inter,system-ui,sans-serif;color:#f8fafc;-webkit-font-smoothing:antialiased;position:relative}
  .bg{position:absolute;inset:0;background:
      radial-gradient(900px 650px at ${square ? '15% 20%' : '10% 30%'},rgba(37,99,235,.34),transparent 62%),
      radial-gradient(900px 800px at 100% 100%,rgba(124,58,237,.26),transparent 60%),#060912}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(148,163,184,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.07) 1px,transparent 1px);
      background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 70% at 30% 45%,#000 20%,transparent 75%)}
  .brand{position:absolute;left:${square ? 84 : 96}px;top:${square ? 76 : 60}px;display:flex;align-items:center;gap:16px;font-size:34px;font-weight:700;color:#cbd5e1}
  .brand img{width:68px;height:68px}
  .copy{position:absolute;left:${square ? 84 : 96}px;right:${square ? 84 : 96}px;top:0;bottom:${square ? 260 : 150}px;display:flex;flex-direction:column;justify-content:center}
  .num{font-size:${square ? 150 : 140}px;font-weight:800;line-height:1;letter-spacing:-.05em;color:transparent;-webkit-text-stroke:2px rgba(147,197,253,.55);
      background:linear-gradient(180deg,rgba(96,165,250,.35),rgba(124,58,237,.05));-webkit-background-clip:text}
  h1{margin-top:18px;font-size:${square ? 92 : 96}px;line-height:1.02;font-weight:800;letter-spacing:-.04em;text-wrap:balance;
      background:linear-gradient(180deg,#fff 35%,#c7d2fe);-webkit-background-clip:text;color:transparent}
  p{margin-top:22px;font-size:${square ? 34 : 34}px;line-height:1.35;color:#94a3b8;max-width:1100px;text-wrap:balance}
  ol{position:absolute;left:${square ? 84 : 96}px;right:${square ? 84 : 96}px;bottom:${square ? 84 : 72}px;list-style:none;display:${square ? 'grid' : 'flex'};${square ? 'grid-template-columns:1fr 1fr;gap:14px' : `gap:${many ? 10 : 14}px`}}
  li{flex:1;min-width:0;display:flex;align-items:center;gap:${many ? 9 : 12}px;padding:${many ? '12px 14px' : '14px 18px'};border-radius:14px;font-size:${many && !square ? 17 : 21}px;font-weight:600;color:#64748b;
      background:rgba(15,23,42,.6);border:1px solid rgba(148,163,184,.14);white-space:nowrap;overflow:hidden}
  li span{overflow:hidden;text-overflow:ellipsis}
  li b{font-size:15px;font-weight:700;color:#475569}
  li.done{color:#94a3b8}li.done b{color:#60a5fa}
  li.on{color:#fff;background:linear-gradient(135deg,rgba(37,99,235,.55),rgba(124,58,237,.45));border-color:rgba(147,197,253,.55);box-shadow:0 10px 30px rgba(59,130,246,.3)}
  li.on b{color:#bfdbfe}
  </style></head><body>
  <div class="bg"></div>${backdropHtml('mesh', format, logoB64)}
  <div class="brand"><img src="data:image/png;base64,${logoB64}" alt="">Jarvis</div>
  <div class="copy">
    <div class="num">${String(index + 1).padStart(2, '0')}</div>
    <h1>${escapeHtml(c.title).replace(/-/g, '‑')}</h1>
    ${c.subtitle ? `<p>${escapeHtml(c.subtitle)}</p>` : ''}
  </div>
  <ol>${steps}</ol>
  </body></html>`
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const r = Math.max(...boxes.map((b) => b.x + b.w))
  const btm = Math.max(...boxes.map((b) => b.y + b.h))
  return { x, y, w: r - x, h: btm - y }
}

const padBox = (b: Box, pad: number): Box => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad })

/** Deterministic pseudo-random in [0,1) — identical markers on every re-recording. */
const rand = (seed: number, i: number) => {
  const x = Math.sin((seed + 1) * 12.9898 + i * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** SVG path of a sketchy, slightly overshooting ellipse, like a marker circle drawn by hand. */
function sketchEllipse(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const start = -Math.PI * (0.55 + rand(seed, 1) * 0.3)
  const turns = 1.1 + rand(seed, 2) * 0.06
  const tilt = (rand(seed, 3) - 0.5) * 0.08
  const steps = 80
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = start + t * turns * Math.PI * 2
    const grow = 0.97 + t * 0.07
    const wobble = 1 + Math.sin(a * 3 + rand(seed, 4) * 6) * 0.02
    const ex = Math.cos(a) * rx * grow * wobble
    const ey = Math.sin(a) * ry * grow * wobble
    pts.push(`${(cx + ex * Math.cos(tilt) - ey * Math.sin(tilt)).toFixed(1)},${(cy + ex * Math.sin(tilt) + ey * Math.cos(tilt)).toFixed(1)}`)
  }
  return `M${pts.join(' L')}`
}

/** SVG path of a hand-drawn rounded rectangle whose stroke overshoots its start — for wide/flat targets. */
function sketchRoundedRect(x: number, y: number, w: number, h: number, seed: number): string {
  const r = Math.min(14, h / 2)
  const straight = [w - 2 * r, h - 2 * r, w - 2 * r, h - 2 * r]
  const arc = (Math.PI / 2) * r
  const perimeter = straight.reduce((a, b) => a + b, 0) + 4 * arc
  // Walks the outline clockwise from the top-left corner's end.
  const at = (s: number): [number, number] => {
    let d = ((s % perimeter) + perimeter) % perimeter
    const corners: Array<[number, number, number]> = [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]]
    const edgeStart: Array<[number, number, number, number]> = [[x + r, y, 1, 0], [x + w, y + r, 0, 1], [x + w - r, y + h, -1, 0], [x, y + h - r, 0, -1]]
    for (let k = 0; k < 4; k++) {
      if (d <= straight[k]) return [edgeStart[k][0] + edgeStart[k][2] * d, edgeStart[k][1] + edgeStart[k][3] * d]
      d -= straight[k]
      if (d <= arc) { const [cx, cy, a0] = corners[k]; const a = a0 + d / r; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] }
      d -= arc
    }
    return [x + r, y]
  }
  const startAt = perimeter * (0.02 + rand(seed, 1) * 0.05)
  const length = perimeter * (1.07 + rand(seed, 2) * 0.04)
  const steps = 140
  const pts: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const [px, py] = at(startAt + t * length)
    // Drift outward over the stroke (ends don't meet) plus a gentle hand wobble.
    const drift = (t - 0.5) * 5
    const wob = Math.sin(t * 17 + rand(seed, 3) * 6) * 1.3
    const nx = px < x + w / 2 ? -1 : 1
    const ny = py < y + h / 2 ? -1 : 1
    pts.push(`${(px + nx * (drift + wob) * 0.6).toFixed(1)},${(py + ny * (drift + wob)).toFixed(1)}`)
  }
  return `M${pts.join(' L')}`
}

/** Pixel width from a baseline/progressive JPEG's SOF marker. */
function jpegWidth(buf: Buffer): number {
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    if (marker >= 0xc0 && marker <= 0xc3) return buf.readUInt16BE(i + 7)
    i += 2 + buf.readUInt16BE(i + 2)
  }
  throw new Error('JPEG without SOF marker')
}

const CARD_FPS = 30
const BACKDROP_JS = fs.readFileSync(path.resolve(process.cwd(), 'e2e/video/backdrops.js'), 'utf8')

/** Canvas + script that animate a card backdrop; the frame loop calls window.__draw(t). */
function backdropHtml(kind: 'owl' | 'mesh', format: VideoFormat, logoB64: string): string {
  const { width: w, height: h } = VIDEO_FORMATS[format]
  const layout = format === 'square'
    ? { cx: w * 0.62, cy: h * 0.72, size: h * 0.56 }
    : { cx: w * 0.73, cy: h * 0.52, size: Math.min(h * 0.96, w * 0.6) }
  return `<canvas id="bd" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
  <script>${BACKDROP_JS}</script>
  <script>(async () => {
    const logo = new Image(); logo.src = 'data:image/png;base64,${logoB64}'; await logo.decode()
    window.__draw = window.JarvisBackdrop.mount(document.getElementById('bd'), { kind: '${kind}', w: ${w}, h: ${h}, logo, layout: ${JSON.stringify(layout)} })
    window.__draw(0)
  })()</script>`
}

const NARRATION_LEAD = 0.3
const NARRATION_TAIL = 0.6
const now = () => Date.now() / 1000
