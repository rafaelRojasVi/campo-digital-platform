import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConafSolicitud } from '../api'
import { ConafCard } from './ConafCard'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, getConafSolicitud: vi.fn(), refreshConafSolicitud: vi.fn() }
})
const api = vi.mocked(await import('../api'))

const found: ConafSolicitud = {
  numero: '090663', lookup_status: 'found', tipo: 'PLAN DE MANEJO', estado: 'EN EVALUACION',
  superficie_ha: 3.5, fecha_ingreso: '2026-09-01', fecha_resolucion: null, returned_solicitud: null,
  checked_at: new Date().toISOString(), found_at: new Date().toISOString(), estado_changed_at: null,
  stale: false, recently_changed: false,
  conaf_url: 'https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663',
}

beforeEach(() => vi.clearAllMocks())

describe('ConafCard', () => {
  it('shows the CONAF status, dates and a link, without repeating the label', async () => {
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: found })
    render(<ConafCard numero="90663" />)
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
    expect(screen.queryByText('EN EVALUACION')).not.toBeInTheDocument()
    expect(screen.getByText('PLAN DE MANEJO')).toBeInTheDocument()
    expect(screen.getByText('3,50 ha')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver en CONAF/ })).toHaveAttribute('href', found.conaf_url)
    expect(api.getConafSolicitud).toHaveBeenCalledWith('090663')
  })

  it('explains an approved plan that CONAF shows denied instead of calling it rejected', async () => {
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: { ...found, estado: 'DENEGADA:' } })
    render(<ConafCard numero="90663" estadoResumido="Aprobado" />)
    expect(await screen.findByText('Revisar')).toBeInTheDocument()
    expect(screen.queryByText('Rechazada')).not.toBeInTheDocument()
    expect(screen.getByText(/recurso de reposición/)).toBeInTheDocument()
  })

  it('disables refresh while busy and announces the result', async () => {
    const user = userEvent.setup()
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: found })
    let resolve: (value: { ok: true; data: ConafSolicitud }) => void = () => {}
    api.refreshConafSolicitud.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<ConafCard numero="090663" />)
    await user.click(await screen.findByRole('button', { name: 'Actualizar desde CONAF' }))
    expect(screen.getByRole('button', { name: 'Consultando…' })).toBeDisabled()
    resolve({ ok: true, data: { ...found, estado: 'APROBADA', checked_at: new Date(Date.now() + 1000).toISOString() } })
    expect(await screen.findByRole('status')).toHaveTextContent('Estado actualizado desde CONAF.')
    expect(screen.getByText('Aprobada')).toBeInTheDocument()
  })

  it('keeps the last data when the refresh fails', async () => {
    const user = userEvent.setup()
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: found })
    api.refreshConafSolicitud.mockResolvedValue({
      ok: true,
      data: { ...found, lookup_status: 'unavailable', stale: true },
    })
    render(<ConafCard numero="090663" />)
    await user.click(await screen.findByRole('button', { name: 'Actualizar desde CONAF' }))
    expect(await screen.findByText('No se pudo actualizar; se muestra el último dato.')).toBeInTheDocument()
    expect(screen.getByText('En evaluación')).toBeInTheDocument()
    expect(screen.getByText('PLAN DE MANEJO')).toBeInTheDocument()
  })

  it('never asks CONAF for a mistyped planilla number', () => {
    render(<ConafCard numero="16/345-10-25" />)
    expect(screen.getByText(/no se puede consultar en CONAF/)).toBeInTheDocument()
    expect(api.getConafSolicitud).not.toHaveBeenCalled()
  })

  it('says so when the refresh repeats the answer from a moment ago', async () => {
    const user = userEvent.setup()
    api.getConafSolicitud.mockResolvedValue({ ok: true, data: found })
    api.refreshConafSolicitud.mockResolvedValue({ ok: true, data: found })
    render(<ConafCard numero="090663" />)
    await user.click(await screen.findByRole('button', { name: 'Actualizar desde CONAF' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'CONAF se consultó hace un momento; se muestra ese resultado.',
    )
  })

  it('offers a retry when the first read fails', async () => {
    const user = userEvent.setup()
    api.getConafSolicitud
      .mockResolvedValueOnce({ ok: false, status: 503, error: 'CONAF está ocupado; intente de nuevo en un momento.' })
      .mockResolvedValueOnce({ ok: true, data: found })
    render(<ConafCard numero="090663" />)
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
  })
})
