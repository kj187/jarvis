import { test, expect, waitForActiveAlerts, JARVIS_BASE_URL } from '../../support/fixtures'
import { dismissNoAuthNotice } from '../../support/auth'
import { kubernetesAlerts } from '../../fixtures/alerts'

test('C1 exact matcher is added and reflected in URL', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active')
  await page.getByRole('button', { name: 'Add filter' }).click()

  const label = page.getByLabel('Label name')
  const value = page.getByLabel('Label value')

  await label.fill('severity')
  await label.press('Enter')
  await value.fill('critical')
  await value.press('Enter')

  await expect.poll(() => decodeURIComponent(page.url())).toContain('"name":"severity"')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"operator":"="')
  await expect.poll(() => decodeURIComponent(page.url())).toContain('"value":"critical"')
})

test('C10 matcher state is restored from URL', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  const matchers = encodeURIComponent(JSON.stringify([{ name: 'severity', operator: '=', value: 'critical' }]))
  await page.goto(`/?state=active&matchers=${matchers}`)

  await expect(page.getByText('severity')).toBeVisible()
  await expect(page.getByText('critical')).toBeVisible()
})

test('C11 search via q filters by alertname/labels', async ({ page, am, jarvis }) => {
  await dismissNoAuthNotice(page)
  await am.fire(kubernetesAlerts)
  await waitForActiveAlerts(jarvis, JARVIS_BASE_URL, kubernetesAlerts.length)

  await page.goto('/?state=active&q=kubepod')
  await expect(page.getByText(/KubePodCrashLooping/i)).toBeVisible()

  await page.goto('/?state=active')
  await page.getByLabel('Toggle search').click()
  await page.getByLabel('Search alerts').fill('platform')
  await expect(page.getByText(/platform/i).first()).toBeVisible()
})
