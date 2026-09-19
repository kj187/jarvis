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
  for (const file of ['docs/demo.md', 'docs/videos.md', 'website/.vitepress/theme/components/HomeVideo.vue']) {
    const markup = read(file)

    assert.match(markup, /youtube\.com\/watch\?v=/, file)
    assert.match(markup, /img\.youtube\.com\/vi\//, file)
    assert.doesNotMatch(markup, /<iframe/, file)
  }
})

test('homepage product scenes auto-rotate, remain controllable, and precede the explainer', () => {
  const layout = read('website/.vitepress/theme/Layout.vue')
  const screenshot = read('website/.vitepress/theme/components/HomeScreenshot.vue')

  assert.match(layout, /#home-hero-after[\s\S]*<HomeScreenshot\s*\/>/)
  assert.match(layout, /#home-features-after[\s\S]*<HomeVideo\s*\/>/)
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
