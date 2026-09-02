import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QualityPanel } from './QualityPanel'
import { makeSummary } from '../test/factories'

describe('QualityPanel (TR-FUNC-014/015/016)', () => {
  it('shows the blank-ID row count from the API', () => {
    render(<QualityPanel summary={makeSummary({ calidad_filas_sin_id_predial_unico: 4 })} />)
    expect(screen.getByTestId('quality-sin-id')).toHaveTextContent('4')
    expect(screen.getByText(/filas sin ID predial único/)).toBeInTheDocument()
  })

  it('renders a genuine zero rather than hiding the indicator', () => {
    render(<QualityPanel summary={makeSummary({ calidad_filas_sin_id_predial_unico: 0 })} />)
    expect(screen.getByTestId('quality-sin-id')).toHaveTextContent('0')
  })

  it('shows the PMF-deduped count of PMFs with no N.º de ingreso', () => {
    render(<QualityPanel summary={makeSummary({ calidad_pmf_sin_numero_ingreso: 11 })} />)
    expect(screen.getByTestId('quality-sin-ingreso')).toHaveTextContent('11')
  })

  it('renders the permanent "No disponible" literal for the resolution field', () => {
    render(<QualityPanel summary={makeSummary()} />)
    expect(screen.getByTestId('quality-resolucion')).toHaveTextContent('No disponible')
    expect(screen.getByText(/campo N.º de resolución/)).toBeInTheDocument()
  })

  it('names the dedup rule the PMF-level indicator inherits', () => {
    render(<QualityPanel summary={makeSummary()} />)
    expect(screen.getByText('estado_resumido_first_row')).toBeInTheDocument()
  })
})
