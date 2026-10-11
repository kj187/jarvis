import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

test('every Mermaid source has light and dark documentation assets', () => {
  for (const file of fs.readdirSync(path.join(ROOT, 'docs/diagrams')).filter((name) => name.endsWith('.mmd'))) {
    const name = path.basename(file, '.mmd')
    assert.ok(fs.existsSync(path.join(ROOT, `docs/assets/${name}-light.svg`)), `${name} light asset`)
    assert.ok(fs.existsSync(path.join(ROOT, `docs/assets/${name}-dark.svg`)), `${name} dark asset`)
  }
})

test('YouTube videos use linked covers instead of failure-prone iframes', () => {
  for (const file of ['docs/demo.md', 'docs/videos.md']) {
    const markup = read(file)

    assert.match(markup, /youtube\.com\/watch\?v=/, file)
    assert.match(markup, /img\.youtube\.com\/vi\//, file)
    assert.doesNotMatch(markup, /<iframe/, file)
  }
})

test('the homepage teaser is a self-hosted, user-started video that still links the full intro', () => {
  const video = read('website/.vitepress/theme/components/HomeVideo.vue')
  const sync = read('website/scripts/sync-content.mjs')

  for (const asset of ['jarvis-teaser.mp4', 'jarvis-teaser-poster.jpg']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'docs/assets', asset)), asset)
    assert.ok(video.includes(`content/assets/${asset}`), `${asset} import`)
  }
  assert.match(video, /<video[\s\S]*\bcontrols\b[\s\S]*<\/video>/)
  assert.match(video, /:poster=/)
  assert.match(video, /aria-label=/)
  assert.doesNotMatch(video, /\bautoplay\b/)
  // The whole poster is one real play button: clickable, focusable, and back again when playback stops.
  assert.match(video, /<button[\s\S]*class="video-play"[\s\S]*aria-label="Play the Jarvis teaser"/)
  assert.match(video, /\.play\(\)/)
  assert.match(video, /@pause=/)
  assert.match(video, /@ended=/)
  assert.doesNotMatch(video, /<iframe/)
  assert.match(video, /youtube\.com\/watch\?v=/)
  assert.match(sync, /VIDEO_EXT = new Set\(\['\.mp4'\]\)/)
})

test('homepage product scenes auto-rotate, remain controllable, and precede the explainer', () => {
  const layout = read('website/.vitepress/theme/Layout.vue')
  const screenshot = read('website/.vitepress/theme/components/HomeScreenshot.vue')

  // The teaser leads, directly under the hero; the product scenes follow the feature grid.
  assert.match(layout, /#home-hero-after>\s*<HomeVideo\s*\/>/)
  assert.match(layout, /#home-features-after>\s*<HomeScreenshot\s*\/>/)
  assert.match(screenshot, /setInterval/)
  assert.match(screenshot, /prefers-reduced-motion/)
  assert.match(screenshot, /'Pause product tour'/)
  assert.match(screenshot, /home-scene-tab-fill/)
  assert.equal((screenshot.match(/darkSrc:/g) ?? []).length, 5)
  assert.equal((screenshot.match(/lightSrc:/g) ?? []).length, 5)
  assert.doesNotMatch(screenshot, /Dark and light/)
  assert.ok(screenshot.indexOf('home-scene-stage') < screenshot.indexOf('home-hero-explainer'))
})

test('the custom layout mounts the delegated image lightbox', () => {
  const layout = read('website/.vitepress/theme/Layout.vue')
  const lightbox = read('website/.vitepress/theme/components/ImageLightbox.vue')

  assert.match(layout, /<ImageLightbox\s*\/>/)
  assert.match(lightbox, /target\.closest\('main'\)/)
  assert.match(lightbox, /target\.closest\('a'\)/)
})

test('published app and chart versions stay aligned across release examples', () => {
  const chart = read('charts/jarvis/Chart.yaml')
  const appVersion = chart.match(/^appVersion: "([^"]+)"$/m)?.[1]
  const chartVersion = chart.match(/^version: (\S+)$/m)?.[1]
  assert.ok(appVersion)
  assert.ok(chartVersion)

  for (const file of ['README.md', 'docs/deploy-compose.md', 'docs/upgrade.md', 'compose.demo.yml', 'website/index.md']) {
    assert.match(read(file), new RegExp(`ghcr\\.io/kj187/jarvis:${appVersion.replaceAll('.', '\\.')}\\b`), file)
  }
  for (const file of ['docs/deploy-kubernetes.md', 'docs/upgrade.md']) {
    assert.ok(read(file).includes(chartVersion), `${file} must mention chart ${chartVersion}`)
  }
})
