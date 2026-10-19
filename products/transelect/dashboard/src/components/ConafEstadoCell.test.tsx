import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConafSolicitud } from '../api'
import { ConafEstadoCell } from './ConafEstadoCell'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, request: vi.fn() }
})

const base: ConafSolicitud = {
  numero: '090663', lookup_status: 'found', tipo: 'PLAN DE MANEJO', estado: 'APROBADA',
  superficie_ha: 3, fecha_ingreso: '2026-09-01', fecha_resolucion: '2026-10-10',
  returned_solicitud: null, checked_at: new Date().toISOString(), found_at: new Date().toISOString(),
  estado_changed_at: null, stale: false, recently_changed: false,
  conaf_url: 'https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663',
}

describe('ConafEstadoCell', () => {
  it('shows a text label and keeps the raw CONAF text in the title', () => {
    render(<ConafEstadoCell numero="90663" record={base} />)
    const pill = screen.getByText('Aprobada')
    expect(pill).toHaveClass('pill', 'pill-aprobado')
    expect(pill.closest('[title]')).toHaveAttribute('title', 'APROBADA · Consultado hace un momento')
  })

  it('marks a recent change and stale data', () => {
    render(<ConafEstadoCell numero="90663" record={{ ...base, recently_changed: true, stale: true }} />)
    expect(screen.getByText('Cambió')).toBeInTheDocument()
    expect(screen.getByText('Sin actualizar')).toBeInTheDocument()
  })

  it('skips numbers CONAF cannot answer', () => {
    render(<ConafEstadoCell numero="16/345-10-25" record={undefined} />)
    expect(screen.getByText('Sin N.º consultable')).toBeInTheDocument()
  })

  it('says when a number has not been read yet', () => {
    render(<ConafEstadoCell numero="090663" record={undefined} />)
    expect(screen.getByText('Sin consultar')).toBeInTheDocument()
  })

  it('does not blame the number when CONAF did not answer', () => {
    render(
      <ConafEstadoCell
        numero="090663"
        record={{ ...base, lookup_status: 'unavailable', found_at: null, estado: null, stale: true }}
      />,
    )
    expect(screen.getByText('CONAF no respondió')).toBeInTheDocument()
  })
})
