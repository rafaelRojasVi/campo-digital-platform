import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DraftFeature, PlanningFields } from '../../lib/reportDraft.ts'
import { PlanificacionTable } from './PlanificacionTable.tsx'

function feature(key: string, rodal: string, planning: Partial<PlanningFields> = {}, inReport = true): DraftFeature {
  return {
    key,
    source_feature_ordinal: Number(key.slice(1)),
    in_report: inReport,
    geometry_changed: false,
    attributes: { n_rodal: rodal, sup_ha: 2 },
    edits: {},
    coordinates: [],
    sector: planning.sector ?? null,
    reforest_species: planning.reforest_species ?? null,
    reforest_density: planning.reforest_density ?? null,
  }
}

function setup(features: DraftFeature[], editable = true) {
  const onChange = vi.fn()
  render(<PlanificacionTable features={features} editable={editable} onChange={onChange} />)
  return onChange
}

describe('PlanificacionTable', () => {
  it('lists only the rodales in the management area', () => {
    setup([feature('f1', '10'), feature('f2', '11', {}, false)])
    expect(screen.getByLabelText('Sector del rodal 10')).toBeInTheDocument()
    expect(screen.queryByLabelText('Sector del rodal 11')).not.toBeInTheDocument()
  })

  it('points back to step 1 when nothing is managed yet', () => {
    setup([feature('f1', '10', {}, false)])
    expect(screen.getByText(/Todavía no hay rodales en el área de manejo/)).toBeInTheDocument()
  })

  it('never writes a cell that was only focused and left', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10', { sector: 'Norte', reforest_density: 1111 })])
    await user.click(screen.getByLabelText('Sector del rodal 10'))
    await user.click(screen.getByLabelText('Densidad del rodal 10 en plantas por hectárea'))
    await user.tab()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears a cell when its text is deleted', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10', { sector: 'Norte' })])
    await user.clear(screen.getByLabelText('Sector del rodal 10'))
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(new Set(['f1']), { sector: null })
  })

  it('adds species as chips, ignores a repeat, and removes one', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10', { reforest_species: ['pino oregón'] })])
    await user.type(screen.getByLabelText('Especies a reforestar del rodal 10'), 'Ulmo{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(new Set(['f1']), { reforest_species: ['pino oregón', 'Ulmo'] })
    onChange.mockClear()
    await user.type(screen.getByLabelText('Especies a reforestar del rodal 10'), 'PINO OREGÓN{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Quitar pino oregón' }))
    expect(onChange).toHaveBeenLastCalledWith(new Set(['f1']), { reforest_species: null })
  })

  it('refuses a density outside 1–20.000 with a message by the cell', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10')])
    await user.type(screen.getByLabelText('Densidad del rodal 10 en plantas por hectárea'), '0{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Entre 1 y 20.000 pl/ha.')
  })

  it('«Aplicar a todos» writes only the filled values into every managed rodal', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10'), feature('f2', '11'), feature('f3', '12', {}, false)])
    const apply = screen.getByRole('button', { name: 'Aplicar a todos' })
    expect(apply).toBeDisabled()
    await user.type(screen.getByLabelText('Sector para todos los rodales'), 'La Reina')
    await user.type(screen.getByLabelText('Densidad para todos los rodales en plantas por hectárea'), '1.600')
    await user.click(apply)
    expect(onChange).toHaveBeenCalledWith(new Set(['f1', 'f2']), { sector: 'La Reina', reforest_density: 1600 })
    expect(screen.getByRole('status')).toHaveTextContent('Aplicado a los 2 rodales.')
  })

  it('is plain text when the report cannot be edited', () => {
    setup([feature('f1', '10', { sector: 'Norte', reforest_species: ['coigüe', 'canelo'], reforest_density: 1600 })], false)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('coigüe + canelo')).toBeInTheDocument()
    expect(screen.getByText('1.600 pl/ha')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aplicar a todos' })).not.toBeInTheDocument()
  })
})
