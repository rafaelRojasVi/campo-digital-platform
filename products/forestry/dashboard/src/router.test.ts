import { afterEach, describe, expect, it, vi } from 'vitest'
import { navigate, setLeaveGuard } from './router.ts'

afterEach(() => {
  setLeaveGuard(null)
  window.history.replaceState(null, '', '/rodales/')
})

describe('leave guard', () => {
  it('keeps the page when the guard says no', () => {
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=1')
    setLeaveGuard(() => false)
    navigate('/rodales/informes')
    expect(window.location.pathname).toBe('/rodales/informes/editar')
  })

  it('navigates when the guard allows it', () => {
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=1')
    const guard = vi.fn(() => true)
    setLeaveGuard(guard)
    navigate('/rodales/informes')
    expect(guard).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/rodales/informes')
  })
})
