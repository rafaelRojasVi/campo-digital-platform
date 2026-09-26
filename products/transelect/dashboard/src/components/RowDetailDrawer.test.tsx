import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RowDetailDrawer } from './RowDetailDrawer'
import { makeRow } from '../test/factories'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return { ...actual, getPmfDetail: vi.fn() }
})

const { getPmfDetail } = await import('../api')

const tracked = makeRow({ source_row_number: 2, pmf: 'BN001', aef: 'Presentado' })
const untracked = makeRow({ source_row_number: 3, pmf: 'BN001' })

describe('RowDetailDrawer — AEF section', () => {
  beforeEach(() => {
    vi.mocked(getPmfDetail).mockReset()
    vi.mocked(getPmfDetail).mockResolvedValue({
      ok: true,
      data: {
        pmf: 'BN001',
        row_count: 2,
        basis_estado_resumido: 'estado_resumido_first_row',
        estado_resumido: 'Aprobado',
        rows: [tracked, untracked],
      },
    })
  })

  it('shows a blank row as blank and points to the PMF row that holds the value', async () => {
    render(
      <RowDetailDrawer row={untracked} onClose={() => {}} sourceFields={['aef', 'pmf']} />,
    )

    expect(screen.getByTestId('drawer-aef')).toHaveTextContent('AEFSin registro en esta fila')
    await waitFor(() =>
      expect(screen.getByTestId('drawer-aef-coverage')).toHaveTextContent(
        '1 de 2 filas de BN001 tienen registro AEF. El seguimiento de este PMF está en la fila 2; esta fila no lo repite y se muestra vacía, como en la planilla.',
      ),
    )
  })

  it('says the published workbook has no AEF columns rather than implying blanks', () => {
    render(<RowDetailDrawer row={untracked} onClose={() => {}} sourceFields={['pmf']} />)

    expect(screen.getByTestId('drawer-aef')).toHaveTextContent(
      'La planilla publicada no incluye las columnas de seguimiento AEF',
    )
    expect(screen.queryByText('Sin registro en esta fila')).not.toBeInTheDocument()
  })

  it('shows the raw text of a date cell, and marks unresolved text as not a date', () => {
    const row = makeRow({
      source_row_number: 4,
      pmf: 'BN001',
      fecha_ingreso: '2024-11-13',
      fecha_90_dias: null,
      source_text_dates: {
        fecha_ingreso: {
          raw: '13 de noviembre de 2024',
          resolution: 'parsed_spanish_long',
          parsed: '2024-11-13',
        },
        fecha_90_dias: {
          raw: '28-04-2025 28-09-26',
          resolution: 'multiple_dates',
          parsed: null,
        },
      },
    })
    render(<RowDetailDrawer row={row} onClose={() => {}} sourceFields={['aef', 'pmf']} />)

    expect(
      screen.getByText('Fecha escrita en texto: «13 de noviembre de 2024»'),
    ).toBeInTheDocument()
    expect(screen.getByText('13-11-2024', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('28-04-2025 28-09-26')).toBeInTheDocument()
    expect(screen.getByText('Varias fechas en la celda')).toBeInTheDocument()
  })
})
