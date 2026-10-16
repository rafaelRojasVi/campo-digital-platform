import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Root from './Root.tsx'
import { reportParam, reportPath } from './router.ts'

vi.mock('./api.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api.ts')>()
  return { ...original, fetchForestryRole: vi.fn() }
})
vi.mock('./App.tsx', () => ({ default: () => <p>mapa-stub</p> }))
vi.mock('./pages/InformesPage.tsx', () => ({ InformesPage: () => <p>informes-stub</p> }))
vi.mock('./pages/InformeEditorPage.tsx', () => ({
  InformeEditorPage: ({ reportId }: { reportId: number | null }) => <p>editor-stub {reportId}</p>,
}))

const api = vi.mocked(await import('./api.ts'))

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchForestryRole.mockResolvedValue('operator')
})

afterEach(() => {
  window.history.replaceState(null, '', '/rodales/')
})

describe('report routes', () => {
  it('parses and builds the editor link', () => {
    expect(reportParam(new URLSearchParams('informe=12'))).toBe(12)
    expect(reportParam(new URLSearchParams('informe=x'))).toBeNull()
    expect(reportPath(12)).toBe('/rodales/informes/editar?informe=12')
  })

  it('routes /rodales/informes to the list', async () => {
    window.history.replaceState(null, '', '/rodales/informes')
    render(<Root />)
    expect(await screen.findByText('informes-stub')).toBeInTheDocument()
  })

  it('routes the editor with its report id', async () => {
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=5')
    render(<Root />)
    expect(await screen.findByText('editor-stub 5')).toBeInTheDocument()
  })
})
