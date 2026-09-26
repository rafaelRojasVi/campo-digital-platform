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

  it('shows a blank row as blank and says the sibling’s AEF does not apply to it', async () => {
    render(
      <RowDetailDrawer row={untracked} onClose={() => {}} sourceFields={['aef', 'pmf']} />,
    )

    expect(screen.getByTestId('drawer-aef')).toHaveTextContent('AEFSin registro en esta fila')
    await waitFor(() =>
      expect(screen.getByTestId('drawer-aef-coverage')).toHaveTextContent(
        '1 de 2 filas de BN001 tienen registro AEF. El registro es por fila: el de otras filas no se aplica a esta.',
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
})
