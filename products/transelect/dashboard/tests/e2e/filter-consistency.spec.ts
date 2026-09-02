/**
 * TR-FUNC-017's own acceptance criterion, called out by the design doc as a
 * mandatory test: one filter change must move the KPI row, both donuts, the
 * status hero and the main table's row count together, from one filter state.
 *
 * This is the automated equivalent of the cross-check the forensic audit had
 * to perform by hand across two separate HTML files. It fails if any section
 * keeps a stale value, reads a different filter state, or is served from a
 * response the others did not see.
 */
import { expect, test } from '@playwright/test'
import { isFiltered, stubPlatform } from './stubs'

test('one filter change updates KPIs, both donuts, the hero and the table together', async ({
  page,
}) => {
  // Record the filter state every read endpoint is called with, so the test
  // can prove they all saw the same one — not merely that they all changed.
  const seen: Record<string, string[]> = {}
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/transelec/')) return
    const endpoint = url.pathname.replace('/api/transelec/', '')
    seen[endpoint] = seen[endpoint] ?? []
    seen[endpoint].push(url.searchParams.getAll('q').join(','))
  })

  await stubPlatform(page)
  await page.goto('/transelec')
  await expect(page.getByTestId('kpi-row')).toBeVisible()

  // Unfiltered baseline, hand-computed in stubs.ts.
  await expect(page.getByTestId('kpi-pmf')).toHaveText('12')
  await expect(page.getByTestId('kpi-predios')).toHaveText('20')
  await expect(page.getByTestId('donut-pmf-total')).toHaveText('6 de 12 PMF aprobados')
  await expect(page.getByTestId('donut-predios-total')).toHaveText('10 de 20 predios aprobados')
  await expect(page.getByTestId('hero-aprobado')).toHaveText('10')
  await expect(page.getByTestId('rows-total')).toContainText('(60 áreas de corta)')

  // ONE filter change.
  await page.getByLabel('Búsqueda general').fill('rechaz')

  // Every section moves, and moves to the narrowed response's values.
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')
  await expect(page.getByTestId('kpi-predios')).toHaveText('5')
  await expect(page.getByTestId('kpi-roles')).toHaveText('4')
  await expect(page.getByTestId('kpi-superficie')).toHaveText('12,25 ha')
  await expect(page.getByTestId('donut-pmf-total')).toHaveText('3 de 4 PMF aprobados')
  await expect(page.getByTestId('donut-pmf-pct')).toHaveText('75%')
  await expect(page.getByTestId('donut-predios-total')).toHaveText('3 de 5 predios aprobados')
  await expect(page.getByTestId('hero-aprobado')).toHaveText('3')
  await expect(page.getByTestId('hero-en-tramite')).toHaveText('1')
  await expect(page.getByTestId('rows-total')).toContainText('(8 áreas de corta)')
  await expect(page.getByTestId('rows-body').locator('tr')).toHaveCount(8)

  // The donut segments still sum to their own grain's KPI: 4 PMF, 5 predios.
  const heroTotal = await page.evaluate(() =>
    [...document.querySelectorAll('.statusheroitem b')].reduce(
      (sum, node) => sum + Number(node.textContent),
      0,
    ),
  )
  expect(heroTotal).toBe(5)

  // And every endpoint was asked for the same filter state.
  for (const endpoint of ['summary', 'pending', 'owner-status', 'report', 'pmfs']) {
    const states = seen[endpoint] ?? []
    expect(states.length, `${endpoint} was never called`).toBeGreaterThan(0)
    expect(states[states.length - 1], `${endpoint} saw a different filter state`).toBe('rechaz')
  }
})

test('clearing the filter returns every section to the unfiltered view together', async ({
  page,
}) => {
  await stubPlatform(page)
  await page.goto('/transelec')
  await expect(page.getByTestId('kpi-row')).toBeVisible()

  await page.getByLabel('Búsqueda general').fill('rechaz')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')

  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()

  await expect(page.getByTestId('kpi-pmf')).toHaveText('12')
  await expect(page.getByTestId('donut-pmf-total')).toHaveText('6 de 12 PMF aprobados')
  await expect(page.getByTestId('hero-aprobado')).toHaveText('10')
  await expect(page.getByTestId('rows-total')).toContainText('(60 áreas de corta)')
})

test('the stub itself distinguishes filtered from unfiltered states', () => {
  // Guard against a vacuous consistency test: if this helper ever returned a
  // constant, both assertions above would pass without proving anything.
  expect(isFiltered(new URL('http://x/api/transelec/summary'))).toBe(false)
  expect(isFiltered(new URL('http://x/api/transelec/summary?q=rechaz'))).toBe(true)
  expect(isFiltered(new URL('http://x/api/transelec/summary?sector=Norte'))).toBe(true)
})
