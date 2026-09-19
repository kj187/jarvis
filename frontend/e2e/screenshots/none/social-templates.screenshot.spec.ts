import { test } from '../../support/fixtures'
import { palette } from '../../video/generated-theme'
import { rgba } from '../../video/theme'

const DIR = process.env.SCREENSHOTS_DIR ?? '../docs/assets'

/**
 * Social / Open Graph images: one template per format, built from the design tokens
 * (generated-theme.ts), the bundled Inter face and the logo — never hand-drawn. The Open Graph
 * image is what the docs site shares (website/.vitepress/config.mts).
 * Regenerate: make e2e-screenshot NAME=social
 */
const TAGLINE = 'The working surface for the lifecycle of an alert.'

interface Format {
  name: string
  width: number
  height: number
  /** Layout: logo beside the text, or stacked and centred. */
  layout: 'row' | 'stack'
  logo: number
  title: number
  tagline: number
}

const FORMATS: Format[] = [
  { name: 'social-og', width: 1200, height: 630, layout: 'row', logo: 330, title: 104, tagline: 34 },
  { name: 'social-square', width: 1080, height: 1080, layout: 'stack', logo: 440, title: 132, tagline: 40 },
  { name: 'social-slide', width: 1920, height: 1080, layout: 'row', logo: 560, title: 168, tagline: 52 },
]

for (const f of FORMATS) {
  test(f.name, async ({ page }) => {
    await page.setViewportSize({ width: f.width, height: f.height })
    await page.goto('/')
    await page.evaluate(
      ({ f, tagline, colors }) => {
        const row = f.layout === 'row'
        document.head.innerHTML = `<style>
          @font-face{font-family:Inter;font-weight:100 900;src:url('/fonts/inter-variable-latin.woff2') format('woff2')}
          html,body{margin:0;width:${f.width}px;height:${f.height}px;overflow:hidden}
          body{position:relative;background:${colors.background};font-family:Inter,sans-serif;color:${colors.foreground};-webkit-font-smoothing:antialiased}
          .glow{position:absolute;inset:0;background:
            radial-gradient(${f.width * 0.7}px ${f.height * 0.9}px at 85% 0%,${colors.blueGlow},transparent 65%),
            radial-gradient(${f.width * 0.6}px ${f.height * 0.8}px at 0% 100%,${colors.coralGlow},transparent 62%)}
          .frame{position:absolute;inset:${Math.round(Math.min(f.width, f.height) * 0.09)}px;display:flex;
            flex-direction:${row ? 'row' : 'column'};align-items:center;justify-content:${row ? 'flex-start' : 'center'};
            gap:${Math.round(f.logo * (row ? 0.12 : 0.06))}px;text-align:${row ? 'left' : 'center'}}
          img{width:${f.logo}px;height:${f.logo}px;flex:none}
          h1{margin:0;font-size:${f.title}px;line-height:1;font-weight:800;letter-spacing:-.035em}
          .bar{width:${Math.round(f.title * 0.85)}px;height:${Math.max(6, Math.round(f.title * 0.06))}px;border-radius:99px;background:${colors.coral};margin:${Math.round(f.title * 0.2)}px ${row ? '0' : 'auto'} ${Math.round(f.title * 0.2)}px}
          p{margin:0;font-size:${f.tagline}px;line-height:1.3;color:${colors.muted};max-width:${row ? f.width * 0.5 : f.width * 0.7}px}
        </style>`
        document.body.innerHTML = `<div class="glow"></div><div class="frame"><img src="/logo.png" alt=""><div><h1>Jarvis</h1><div class="bar"></div><p>${tagline}</p></div></div>`
      },
      {
        f,
        tagline: TAGLINE,
        colors: {
          background: palette.background,
          foreground: palette.foreground,
          muted: palette.mutedForeground,
          coral: palette.coral,
          blueGlow: rgba(palette.blue, 0.26),
          coralGlow: rgba(palette.coral, 0.16),
        },
      },
    )
    await page.evaluate(() => document.fonts.load('800 100px Inter'))
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => (document.querySelector('img') as HTMLImageElement).complete)
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${DIR}/${f.name}.png`, scale: 'css' })
  })
}
