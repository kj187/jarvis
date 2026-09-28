/**
 * Chart slides for the release videos (.agents/skills/release-video/SKILL.md): a full-frame card with
 * before/after bars or line charts, drawn as plain HTML/SVG so the frames stay sharp and are a pure
 * function of time (`window.__chart(t)`, called by recorder.ts once per card frame next to the
 * backdrop's `__draw`). Import-free on purpose: the recorder hands in the colours, so the same code
 * renders in a preview script without the Playwright loader.
 *
 * Rules the charts follow (dataviz): one shared axis per comparison, bars to scale from zero, thin
 * marks, direct labels instead of a legend, "before" and "after" keep the same colour on every slide.
 */

export interface ChartLook {
  base: string
  text: string
  muted: string
  blue: string
  coral: string
  /** Faint grid and track colour. */
  grid: string
  panel: string
  panelEdge: string
  glowBlue: string
  glowCoral: string
}

/** One metric of a comparison: two values on the same scale, the "before" one is the full bar. */
export interface BarRow {
  label: string
  before: number
  after: number
  beforeText: string
  afterText: string
  /** Reduction shown as a pill, e.g. "~1,000× less". */
  factor: string
}

export interface BarGroup {
  heading: string
  note: string
  rows: BarRow[]
  /** Small closing line under the rows. */
  footnote?: string
}

/** A time series on the shared 0…yMax axis; `points` are `[x 0…1, value]` pairs in drawing order. */
export interface LineSeries {
  tone: 'before' | 'after'
  label: string
  /** Right-aligned fact in the panel header, e.g. "peaks near 576 MiB". */
  callout: string
  points: Array<[number, number]>
  xTicks: Array<{ at: number; label: string }>
}

export interface ChartSpec {
  eyebrow?: string
  title: string
  bars?: BarGroup[]
  lines?: LineSeries[]
  yMax?: number
  yTicks?: number[]
  yUnit?: string
  /** Small print under the charts, e.g. the data source. */
  footnote?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const num = (n: number) => String(Math.round(n * 10) / 10)

export function chartHtml(
  c: ChartSpec,
  size: { width: number; height: number; square: boolean },
  k: ChartLook,
  logoB64: string,
  backdrop: string,
): string {
  const { width, height, square } = size
  const sideGap = square ? 72 : 96
  const bars = (c.bars ?? []).map((g, gi) => barGroupHtml(g, gi)).join('')
  const lines = (c.lines ?? []).map((s, si) => lineHtml(s, si, c, size, k)).join('')
  const dark = 'rgba(0,0,0,.35)'
  return `<!doctype html><html><head><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${width}px;height:${height}px;overflow:hidden;background:${k.base}}
  body{font-family:Inter,system-ui,sans-serif;color:${k.text};-webkit-font-smoothing:antialiased;position:relative;font-variant-numeric:tabular-nums}
  .bg{position:absolute;inset:0;background:radial-gradient(1000px 700px at 12% 0%,${k.glowBlue},transparent 62%),radial-gradient(900px 800px at 100% 100%,${k.glowCoral},transparent 60%),${k.base}}
  .wrap{position:absolute;left:${sideGap}px;right:${sideGap}px;top:${square ? 60 : 46}px;bottom:${square ? 64 : 52}px;display:flex;flex-direction:column}
  .top{display:flex;align-items:center;gap:18px}
  .brand{display:flex;align-items:center;gap:12px;font-size:28px;font-weight:700}
  .brand img{width:52px;height:52px}
  .eyebrow{padding:6px 14px;border-radius:999px;font-size:15px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${k.blue};background:${k.blue}24;border:1px solid ${k.blue}66}
  h1{margin-top:${square ? 22 : 16}px;font-size:${square ? 52 : 48}px;line-height:1.06;font-weight:800;letter-spacing:-.035em;text-wrap:balance}
  .content{flex:1;min-height:0;margin-top:${square ? 28 : 22}px;display:flex;flex-direction:${c.lines || square ? 'column' : 'row'};gap:${square ? 18 : 22}px}
  .panel{flex:1;min-width:0;${c.lines ? '' : square ? 'flex:0 0 auto;' : 'align-self:flex-start;flex:1 1 0;'}padding:${square ? '20px 24px' : '22px 28px'};border-radius:18px;background:${k.panel};border:1px solid ${k.panelEdge};box-shadow:0 20px 60px ${dark};display:flex;flex-direction:column}
  .panel h2{font-size:${square ? 26 : 27}px;font-weight:700;letter-spacing:-.02em}
  .panel .note{margin-top:3px;font-size:${square ? 16 : 17}px;color:${k.muted}}
  .rows{margin-top:${square ? 18 : 30}px;display:flex;flex-direction:column;gap:${square ? 20 : 44}px}
  .row .cap{display:flex;align-items:center;justify-content:space-between;font-size:${square ? 16 : 19}px;color:${k.muted};font-weight:500}
  .pill{padding:3px 12px;border-radius:999px;font-size:${square ? 15 : 16}px;font-weight:700;color:${k.text};background:${k.blue}26;border:1px solid ${k.blue}66;opacity:0}
  .bar{display:flex;align-items:center;gap:12px;margin-top:${square ? 6 : 10}px}
  .bar .tag{width:${square ? 56 : 60}px;font-size:${square ? 14 : 15}px;color:${k.muted};font-weight:600;letter-spacing:.04em;text-transform:uppercase}
  .track{flex:1;height:${square ? 18 : 26}px;border-radius:4px;background:${k.grid}}
  .fill{height:100%;border-radius:4px;transform-origin:left center;transform:scaleX(0)}
  .fill.before{background:${k.coral}}.fill.after{background:${k.blue}}
  .val{width:${square ? 118 : 138}px;white-space:nowrap;text-align:right;font-size:${square ? 18 : 22}px;font-weight:700;opacity:0}
  .foot{margin-top:${square ? 18 : 30}px;font-size:${square ? 15 : 16}px;color:${k.muted}}
  .phead{display:flex;align-items:baseline;gap:14px}
  .swatch{width:14px;height:14px;border-radius:4px;align-self:center}
  .swatch.before{background:${k.coral}}.swatch.after{background:${k.blue}}
  .callout{margin-left:auto;font-size:${square ? 18 : 20}px;font-weight:700;opacity:0}
  .plot{flex:1;min-height:0;margin-top:6px}
  .plot svg{width:100%;height:100%;display:block}
  .small{position:absolute;left:${sideGap}px;bottom:${square ? 30 : 20}px;font-size:14px;color:${k.muted}}
  </style></head><body>
  <div class="bg"></div>${backdrop}
  <div class="wrap">
    <div class="top"><div class="brand"><img src="data:image/png;base64,${logoB64}" alt="">Jarvis</div>${c.eyebrow ? `<span class="eyebrow">${esc(c.eyebrow)}</span>` : ''}</div>
    <h1>${esc(c.title).replace(/-/g, '‑')}</h1>
    <div class="content">${bars}${lines}</div>
  </div>
  ${c.footnote ? `<div class="small">${esc(c.footnote)}</div>` : ''}
  <script>
  const clamp = (x) => Math.min(1, Math.max(0, x))
  const ease = (x) => 1 - Math.pow(1 - clamp(x), 3)
  // A pure function of t (seconds since the card opened): bars grow, values fade in, lines draw left to right.
  window.__chart = (t) => {
    document.querySelectorAll('[data-bar]').forEach((el) => {
      const [g, r, side] = el.dataset.bar.split(':'), target = parseFloat(el.dataset.to)
      const start = 0.5 + Number(g) * 0.3 + Number(r) * 0.55 + (side === 'after' ? 0.45 : 0)
      const p = ease((t - start) / 0.9)
      el.style.transform = 'scaleX(' + (target * p) + ')'
      const v = el.closest('.bar').querySelector('.val'); if (v) v.style.opacity = clamp((t - start - 0.35) / 0.4)
    })
    document.querySelectorAll('[data-pill]').forEach((el) => {
      const [g, r] = el.dataset.pill.split(':')
      el.style.opacity = clamp((t - (0.5 + Number(g) * 0.3 + Number(r) * 0.55 + 1.2)) / 0.4)
    })
    document.querySelectorAll('[data-clip]').forEach((el) => {
      const i = Number(el.dataset.clip), w = Number(el.dataset.w)
      const start = 0.5 + i * 2.2
      el.setAttribute('width', String(w * ease((t - start) / 2.6)))
      const co = document.querySelector('[data-callout="' + i + '"]'); if (co) co.style.opacity = clamp((t - start - 2.0) / 0.5)
    })
  }
  window.__chart(0)
  </script>
  </body></html>`
}

function barGroupHtml(g: BarGroup, gi: number): string {
  const rows = g.rows.map((r, ri) => {
    // Bars are to scale from zero; a value below 0.6 % of the "before" bar stays a hairline so it remains visible.
    const afterShare = Math.max(r.after / r.before, 0.006)
    return `<div class="row">
      <div class="cap"><span>${esc(r.label)}</span><span class="pill" data-pill="${gi}:${ri}">${esc(r.factor)}</span></div>
      <div class="bar"><span class="tag">Before</span><div class="track"><div class="fill before" data-bar="${gi}:${ri}:before" data-to="1"></div></div><span class="val">${esc(r.beforeText)}</span></div>
      <div class="bar"><span class="tag">After</span><div class="track"><div class="fill after" data-bar="${gi}:${ri}:after" data-to="${afterShare.toFixed(4)}"></div></div><span class="val">${esc(r.afterText)}</span></div>
    </div>`
  }).join('')
  return `<section class="panel"><h2>${esc(g.heading)}</h2><div class="note">${esc(g.note)}</div><div class="rows">${rows}</div>${g.footnote ? `<div class="foot">${esc(g.footnote)}</div>` : ''}</section>`
}

function lineHtml(s: LineSeries, i: number, c: ChartSpec, size: { width: number; height: number; square: boolean }, k: ChartLook): string {
  const yMax = c.yMax ?? 640
  const ticks = c.yTicks ?? [0, 128, 256, 384, 512, 640]
  const W = size.square ? 1000 : 1300
  const H = size.square ? 190 : 215
  const ml = 94, mr = 10, mt = 10, mb = 26
  const pw = W - ml - mr, ph = H - mt - mb
  const X = (x: number) => ml + x * pw
  const Y = (v: number) => mt + ph - (v / yMax) * ph
  const line = s.points.map(([x, v], n) => `${n === 0 ? 'M' : 'L'}${num(X(x))} ${num(Y(v))}`).join('')
  const area = `${line}L${num(X(s.points[s.points.length - 1][0]))} ${num(Y(0))}L${num(X(s.points[0][0]))} ${num(Y(0))}Z`
  const grid = ticks.map((v) => `<line x1="${ml}" x2="${W - mr}" y1="${num(Y(v))}" y2="${num(Y(v))}" stroke="${k.grid}" stroke-width="1"/><text x="${ml - 10}" y="${num(Y(v) + 5)}" text-anchor="end" font-size="14" fill="${k.muted}">${v}${v === ticks[ticks.length - 1] && c.yUnit ? ` ${c.yUnit}` : ''}</text>`).join('')
  const xt = s.xTicks.map((t) => `<text x="${num(X(t.at))}" y="${H - 6}" text-anchor="middle" font-size="14" fill="${k.muted}">${esc(t.label)}</text>`).join('')
  const color = s.tone === 'before' ? k.coral : k.blue
  return `<section class="panel">
    <div class="phead"><span class="swatch ${s.tone}"></span><h2>${esc(s.label)}</h2><span class="callout" data-callout="${i}">${esc(s.callout)}</span></div>
    <div class="plot"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs><clipPath id="clip${i}"><rect data-clip="${i}" data-w="${W}" x="0" y="0" width="0" height="${H}"/></clipPath></defs>
      ${grid}${xt}
      <g clip-path="url(#clip${i})"><path d="${area}" fill="${color}" fill-opacity=".14"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></g>
    </svg></div>
  </section>`
}
