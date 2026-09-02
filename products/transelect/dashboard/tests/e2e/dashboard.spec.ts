/**
 * Acceptance tests for `/transelec`.
 *
 * Traceability: TR-FUNC-001-023, 026-030, 032-039, 041-043, 046.
 * Filter consistency (TR-FUNC-017) has its own dedicated test, as the design
 * doc requires; print and responsive live in their own spec files.
 */
import { expect, test } from '@playwright/test'
import { makeApiRow, stubPlatform } from './stubs'

test.beforeEach(async ({ page }) => {
  await stubPlatform(page)
})

async function openDashboard(page: import('@playwright/test').Page) {
  await page.goto('/transelec')
  await expect(page.getByTestId('kpi-row')).toBeVisible()
}

test('TR-FUNC-041/046: header shows both brand marks and the active version’s publish stamp', async ({
  page,
}) => {
  await openDashboard(page)

  await expect(page.getByText('Campo Digital').first()).toBeVisible()
  await expect(page.getByText('Transmisora del Pacífico – Transelec')).toBeVisible()
  await expect(page.getByText('Versión activa #7')).toBeVisible()
  await expect(page.getByText(/Publicada 02-09-2026/)).toBeVisible()
  // TR-OPEN-06: no logo payload is reused, so the header carries no image.
  await expect(page.locator('.topbar img')).toHaveCount(0)
})

test('TR-FUNC-042: the Consulta documental banner is present with its source wording', async ({
  page,
}) => {
  await openDashboard(page)
  const banner = page.getByTestId('notice-banner')
  await expect(banner).toContainText('Consulta documental:')
  await expect(banner).toContainText('N.º de ingreso está asociado directamente a cada PMF')
})

test('TR-FUNC-001-008: the eight KPI cards render the API’s values', async ({ page }) => {
  await openDashboard(page)

  await expect(page.getByTestId('kpi-pmf')).toHaveText('12')
  await expect(page.getByTestId('kpi-predios')).toHaveText('20')
  await expect(page.getByTestId('kpi-roles')).toHaveText('15')
  await expect(page.getByTestId('kpi-superficie')).toHaveText('48,75 ha')
  await expect(page.getByTestId('kpi-aprobados')).toHaveText('6')
  await expect(page.getByTestId('kpi-en-tramite')).toHaveText('3')
  await expect(page.getByTestId('kpi-pendientes')).toHaveText('5')
  await expect(page.getByTestId('kpi-servidumbre')).toHaveText('4')
})

test('TR-FUNC-009/010: both donuts render, each against its own grain', async ({ page }) => {
  await openDashboard(page)
  await expect(page.getByTestId('donut-predios-total')).toHaveText('10 de 20 predios aprobados')
  await expect(page.getByTestId('donut-pmf-total')).toHaveText('6 de 12 PMF aprobados')
  await expect(page.getByTestId('donut-predios-pct')).toHaveText('50%')
})

test('TR-FUNC-011: the status hero shows predio-grain counts and says so', async ({ page }) => {
  await openDashboard(page)
  await expect(page.getByTestId('hero-aprobado')).toHaveText('10')
  await expect(page.getByTestId('hero-en-tramite')).toHaveText('5')
  await expect(page.getByTestId('hero-pendiente')).toHaveText('3')
  await expect(page.getByTestId('hero-tachado')).toHaveText('2')
  await expect(page.getByText(/Predios únicos del alcance seleccionado \(20 predios\)/)).toBeVisible()
})

test('TR-FUNC-012: reforestación chips list ten values plus an overflow chip', async ({ page }) => {
  await openDashboard(page)
  await expect(page.getByTestId('reforestation-count')).toHaveText('13')
  await expect(page.getByTestId('reforestation-overflow')).toContainText('Muchos · 13 en total')
  await expect(page.locator('.refchip:not(.refmany)')).toHaveCount(10)
})

test('TR-FUNC-013: the owner-status table pivots the API rows and shows its basis', async ({
  page,
}) => {
  await openDashboard(page)
  const table = page.getByTestId('owner-status')
  await expect(table.locator('.basis-tag').first()).toHaveText('owner_stage_legacy')
  await expect(table).toContainText('Servidumbre firmada')
  await expect(page.getByTestId('owner-status-total')).toHaveText('20')
  await expect(table).toContainText('puede clasificar un predio de forma distinta al resto del panel')
})

test('TR-FUNC-014/015/016: the quality panel shows both counts and the static literal', async ({
  page,
}) => {
  await openDashboard(page)
  await expect(page.getByTestId('quality-sin-id')).toHaveText('2')
  await expect(page.getByTestId('quality-sin-ingreso')).toHaveText('3')
  await expect(page.getByTestId('quality-resolucion')).toHaveText('No disponible')
})

test('TR-FUNC-018-022: a multi-select narrows every section', async ({ page }) => {
  await openDashboard(page)
  await page.getByRole('button', { name: 'Sector', exact: true }).click()
  await page.getByLabel('Norte').check()

  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')
  await expect(page.getByTestId('rows-total')).toContainText('(8 áreas de corta)')
})

test('TR-FUNC-023/024/032: Limpiar and Volver al total run the same reset, and both pending entry points behave alike', async ({
  page,
}) => {
  await openDashboard(page)

  // Entry point 1: the top toolbar's Limpiar.
  await page.getByLabel('Búsqueda general').fill('rechaz')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await expect(page.getByTestId('kpi-pmf')).toHaveText('12')

  // Entry point 2: the pending zone's Volver al total — same reset.
  await page.getByLabel('Búsqueda general').fill('legal')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')
  await page.getByTestId('back-to-total').click()
  await expect(page.getByTestId('kpi-pmf')).toHaveText('12')
  await expect(page.getByLabel('Búsqueda general')).toHaveValue('')

  // TR-FUNC-024 and TR-FUNC-032 are one code path with two entry points:
  // the FAQ card and the pending-zone button produce the identical result.
  await page.getByLabel('Búsqueda general').fill('legal')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')
  await page.getByText('¿Qué falta presentar a CONAF?').click()
  await expect(page.getByTestId('pending-zone')).toHaveClass(/focused/)
  await expect(page.getByLabel('Búsqueda general')).toHaveValue('')
  const viaCard = await page.getByTestId('pending-count').textContent()

  await page.getByRole('button', { name: 'Limpiar', exact: true }).click()
  await expect(page.getByTestId('pending-zone')).not.toHaveClass(/focused/)
  await page.getByLabel('Búsqueda general').fill('legal')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')
  await page.getByTestId('show-pending').click()
  await expect(page.getByTestId('pending-zone')).toHaveClass(/focused/)
  await expect(page.getByLabel('Búsqueda general')).toHaveValue('')
  expect(await page.getByTestId('pending-count').textContent()).toBe(viaCard)
})

test('TR-FUNC-025: the lookup card focuses the search box and swaps its placeholder', async ({
  page,
}) => {
  await openDashboard(page)
  await page.getByText('¿A qué PMF corresponde un N.º de ingreso?').click()

  const search = page.getByLabel('Búsqueda general')
  await expect(search).toHaveAttribute(
    'placeholder',
    'Escriba el N.º de ingreso para ver su PMF, rol y predio',
  )
  await expect(search).toBeFocused()
})

test('TR-FUNC-026: the easement card selects exactly Servidumbre firmada', async ({ page }) => {
  await openDashboard(page)
  const request = page.waitForRequest((req) =>
    req.url().includes('/api/transelec/summary') &&
    req.url().includes('tipo_propietario=Servidumbre+firmada'),
  )
  await page.getByText('¿Cuáles tienen servidumbre?').click()
  await request
  await expect(page.getByRole('button', { name: 'Tipo de propietario' })).toContainText(
    'Servidumbre firmada',
  )
})

test('TR-FUNC-027: the surface card scrolls to the KPI row without changing the filters', async ({
  page,
}) => {
  await openDashboard(page)
  await page.getByLabel('Búsqueda general').fill('')
  await page.getByText('¿Cuál es la superficie de corta?').click()

  await expect(page.getByLabel('Búsqueda general')).toHaveValue('')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('12')
  await expect(page.getByTestId('kpi-row')).toBeInViewport()
})

test('TR-FUNC-028/029: the rejected and legal cards run their literal substring searches', async ({
  page,
}) => {
  await openDashboard(page)

  await page.getByText('¿Qué expedientes tienen rechazo?').click()
  await expect(page.getByLabel('Búsqueda general')).toHaveValue('rechaz')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')

  await page.getByText('¿Dónde está el principal cuello de botella?').click()
  await expect(page.getByLabel('Búsqueda general')).toHaveValue('legal')
})

test('TR-FUNC-030: the company card opens the Empresa filter and nothing else', async ({ page }) => {
  await openDashboard(page)
  await page.getByText('¿Cómo avanza cada empresa?').click()

  await expect(page.getByRole('button', { name: 'Empresa', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(page.getByTestId('kpi-pmf')).toHaveText('12')
})

test('TR-FUNC-031: the overdue card lists rows against a computed reference date, never a frozen literal', async ({
  page,
}) => {
  await openDashboard(page)
  await page.getByText('¿Qué ingresos superaron 90 días?').click()

  const panel = page.getByTestId('overdue-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('overdue-count')).not.toContainText('(0 ')
  // The source dashboards froze this comparison at 2026-08-26.
  await expect(panel).not.toContainText('26-08-2026')
  await expect(panel).toContainText('02-09-2026')
  await expect(panel).toContainText('hora observada del servidor')

  await page.getByTestId('overdue-close').click()
  await expect(panel).toBeHidden()
})

test('TR-FUNC-032/033: the pending zone shows count, stages and the detail table', async ({
  page,
}) => {
  await openDashboard(page)

  await expect(page.getByTestId('pending-count')).toHaveText('5 de 12')
  await expect(page.getByTestId('pending-stage-preparacion')).toHaveText('2')
  await expect(page.getByTestId('pending-stage-recurso_rechazo')).toHaveText('2')
  await expect(page.getByTestId('pending-stage-otros')).toHaveText('1')
  await expect(page.getByTestId('pending-zone').locator('tbody tr')).toHaveCount(5)
  await expect(page.getByTestId('pending-zone')).toContainText('pending_priority_legacy')
  await expect(page.getByTestId('pending-zone')).toContainText('pending_stage_legacy')
})

test('TR-FUNC-034/035/036: the report renders as text and both export actions work', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openDashboard(page)

  const report = page.getByTestId('report-text')
  await expect(report).toContainText('REPORTE EJECUTIVO · SEGUIMIENTO CONAF')
  await expect(report).toContainText('Corte de información: 02-09-2026')

  await page.getByTestId('copy-report').click()
  await expect(page.getByText('Reporte copiado al portapapeles.')).toBeVisible()
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toContain('REPORTE EJECUTIVO · SEGUIMIENTO CONAF')

  const download = page.waitForEvent('download')
  await page.getByTestId('download-report').click()
  expect((await download).suggestedFilename()).toBe('reporte_ejecutivo_conaf.txt')
})

test('TR-FUNC-037: Exportar CSV downloads from the backend endpoint under the current filters', async ({
  page,
}) => {
  await openDashboard(page)
  await page.getByLabel('Búsqueda general').fill('rechaz')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')

  const [request, download] = await Promise.all([
    page.waitForRequest((req) => req.url().includes('/api/transelec/export.csv')),
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar CSV' }).click(),
  ])

  expect(request.url()).toContain('q=rechaz')
  expect(download.suggestedFilename()).toBe('transelec_export.csv')
})

test('TR-FUNC-039: the detail table has the full column set and real pagination', async ({
  page,
}) => {
  await openDashboard(page)

  const headers = page.locator('section:has([data-testid="rows-body"]) thead th')
  await expect(headers).toHaveText([
    'PMF',
    'Predio de reforestación',
    'Carpeta (col. E)',
    'Carpeta (col. AC)',
    'Rol',
    'Predio',
    'Área corta',
    'Sup. ha',
    'Estado resumido',
    'N.º ingreso',
    'Empresa',
    'Propietario',
    'Sector',
  ])

  await expect(page.getByTestId('rows-total')).toContainText('(60 áreas de corta)')
  await expect(page.getByTestId('pagination-range')).toHaveText(
    'Mostrando 1–25 de 60 filas',
  )
  await expect(page.getByTestId('rows-body').locator('tr')).toHaveCount(25)

  await page.getByTestId('page-next').click()
  await expect(page.getByTestId('pagination-range')).toHaveText('Mostrando 26–50 de 60 filas')
  await page.getByTestId('page-next').click()
  await expect(page.getByTestId('pagination-range')).toHaveText('Mostrando 51–60 de 60 filas')
  await expect(page.getByTestId('page-next')).toBeDisabled()

  await page.getByTestId('page-prev').click()
  await expect(page.getByTestId('pagination-range')).toHaveText('Mostrando 26–50 de 60 filas')

  await page.getByLabel('Filas por página').selectOption('100')
  await expect(page.getByTestId('pagination-range')).toHaveText('Mostrando 1–60 de 60 filas')
})

test('TR-FUNC-043: the footer cites the active version’s real provenance', async ({ page }) => {
  await openDashboard(page)
  const footer = page.getByTestId('provenance-footer')

  await expect(footer).toContainText('planilla-sintetica.xlsx')
  await expect(footer).toContainText('82ba5eaed0b1')
  await expect(footer).toContainText('transelec-resumen-v1')
  await expect(footer).toContainText('Dev Admin')
  await expect(footer).toContainText('nunca modifica la planilla de origen')
})

test('no workbook-derived value is ever rendered as markup', async ({ page }) => {
  // Registered after the default stubs so this handler wins: Playwright
  // matches the most recently added route first.
  await page.route('**/api/transelec/pmfs?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          {
            ...makeApiRow(1),
            empresa: '<img src=x onerror="window.__xss=1">',
            sector: '<script>window.__xss2=1</script>',
          },
        ],
        next_cursor: null,
        has_more: false,
        total_count: 1,
      }),
    }),
  )

  await openDashboard(page)
  await expect(page.getByTestId('rows-body')).toContainText('<img src=x onerror=')
  expect(await page.locator('[data-testid="rows-body"] img').count()).toBe(0)
  expect(await page.locator('[data-testid="rows-body"] script').count()).toBe(0)
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__xss),
  ).toBeUndefined()
})
