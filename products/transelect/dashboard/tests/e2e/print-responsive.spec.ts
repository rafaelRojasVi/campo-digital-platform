/**
 * TR-FUNC-038 / 044 / 045 — print stylesheet and responsive behaviour.
 *
 * The design doc calls both mandatory rather than optional: printing is a
 * function Javier uses today, and the two breakpoints (1000px, 600px) plus a
 * real 390px phone viewport are confirmed requirements.
 */
import { expect, test } from '@playwright/test'
import { stubPlatform } from './stubs'

test.beforeEach(async ({ page }) => {
  await stubPlatform(page)
})

test('TR-FUNC-038/045: print emulation hides the chrome and un-clips every table', async ({
  page,
}) => {
  await page.goto('/transelec')
  await expect(page.getByTestId('kpi-row')).toBeVisible()

  // Everything is visible on screen first, so the assertions below prove the
  // print stylesheet did the hiding rather than the elements being absent.
  await expect(page.locator('.topbar')).toBeVisible()
  await expect(page.locator('.filters')).toBeVisible()
  await expect(page.locator('.questions')).toBeVisible()
  await expect(page.getByTestId('notice-banner')).toBeVisible()

  await page.emulateMedia({ media: 'print' })

  const state = await page.evaluate(() => {
    const display = (selector: string) => {
      const element = document.querySelector(selector)
      return element ? getComputedStyle(element).display : 'missing'
    }
    const wraps = [...document.querySelectorAll('.tablewrap')].map((node) => {
      const style = getComputedStyle(node)
      return { overflow: style.overflow, maxHeight: style.maxHeight }
    })
    const stickyHeaders = [...document.querySelectorAll('th')].map(
      (node) => getComputedStyle(node).position,
    )
    return {
      topbar: display('.topbar'),
      filters: display('.filters'),
      faq: display('.questions'),
      notice: display('.notice'),
      buttons: display('.btns'),
      pagination: display('.pagination'),
      wraps,
      stickyHeaders: [...new Set(stickyHeaders)],
      grid: display('.grid'),
    }
  })

  expect(state.topbar).toBe('none')
  expect(state.filters).toBe('none')
  expect(state.faq).toBe('none')
  expect(state.notice).toBe('none')
  expect(state.buttons).toBe('none')
  expect(state.pagination).toBe('none')
  // Tables are un-clipped: no scroll container, no max-height cut-off.
  expect(state.wraps.length).toBeGreaterThan(0)
  for (const wrap of state.wraps) {
    expect(wrap.overflow).toBe('visible')
    expect(wrap.maxHeight).toBe('none')
  }
  // A sticky header renders as a floating band on paper.
  expect(state.stickyHeaders).toEqual(['static'])
  // The two-column layout collapses so the table gets the full page width.
  expect(state.grid).toBe('block')

  // The content sections themselves survive printing.
  await expect(page.getByTestId('kpi-row')).toBeVisible()
  await expect(page.getByTestId('rows-body')).toBeVisible()
  await expect(page.getByTestId('report-text')).toBeVisible()
})

for (const [label, width, height] of [
  ['desktop', 1440, 900],
  ['1000px breakpoint', 1000, 900],
  ['600px breakpoint', 600, 900],
  ['390px phone', 390, 844],
] as const) {
  test(`TR-FUNC-044: ${label} renders with no horizontal page scroll and no console errors`, async ({
    page,
  }) => {
    const problems: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(message.text())
    })
    page.on('pageerror', (error) => problems.push(error.message))

    await page.setViewportSize({ width, height })
    await page.goto('/transelec')
    await expect(page.getByTestId('kpi-row')).toBeVisible()

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)

    // Key sections stay usable at every width.
    await expect(page.getByTestId('kpi-row')).toBeVisible()
    await expect(page.getByTestId('status-hero')).toBeVisible()
    await expect(page.getByTestId('pending-zone')).toBeVisible()
    await expect(page.getByLabel('Búsqueda general')).toBeVisible()

    expect(problems).toEqual([])
  })
}

test('TR-FUNC-044: the filter panel is reachable and usable at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/transelec')
  await expect(page.getByTestId('kpi-row')).toBeVisible()

  await page.getByLabel('Búsqueda general').fill('rechaz')
  await expect(page.getByTestId('kpi-pmf')).toHaveText('4')

  await page.getByRole('button', { name: 'Sector', exact: true }).click()
  await expect(page.getByLabel('Norte')).toBeVisible()
})

test('keyboard focus reaches the filter controls and the primary actions in order', async ({
  page,
}) => {
  await page.goto('/transelec')
  await expect(page.getByTestId('kpi-row')).toBeVisible()

  const order: string[] = []
  for (let step = 0; step < 10; step += 1) {
    await page.keyboard.press('Tab')
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement
        if (!element) return 'none'
        const label =
          element.getAttribute('aria-label') ??
          element.getAttribute('placeholder') ??
          element.textContent ??
          ''
        return `${element.tagName}:${label.trim().slice(0, 24)}`
      }),
    )
  }

  expect(order[0]).toContain('Panel')
  expect(order.some((entry) => entry.startsWith('INPUT'))).toBe(true)
  expect(order.filter((entry) => entry.startsWith('BUTTON')).length).toBeGreaterThanOrEqual(5)
  expect(order).toContain('BUTTON:Limpiar')
})
