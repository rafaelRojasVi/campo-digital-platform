import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DraftFeature, PlanningFields, ReportDraft } from '../lib/reportDraft.ts'
import { PlanificacionPanel } from './PlanificacionPanel.tsx'

function feature(key: string, rodal: string, planning: Partial<PlanningFields> = {}, inReport = true): DraftFeature {
  return {
    key,
    source_feature_ordinal: Number(key.replace(/\D/g, '')) || 1,
    in_report: inReport,
    geometry_changed: false,
    attributes: { n_rodal: rodal, cod_predial: 'P1' },
    edits: {},
    coordinates: [],
    sector: planning.sector ?? null,
    reforest_species: planning.reforest_species ?? null,
    reforest_density: planning.reforest_density ?? null,
  }
}

function setup(features: DraftFeature[], selected: string[], editable = true) {
  const draft: ReportDraft = { features, nextKey: features.length + 1 }
  const onChange = vi.fn()
  render(
    <PlanificacionPanel draft={draft} selectedKeys={new Set(selected)} editable={editable} onChangePlanning={onChange} />,
  )
  return onChange
}

describe('PlanificacionPanel', () => {
  it('is absent until a managed rodal is selected', () => {
    setup([feature('f1', '10', {}, false)], ['f1'])
    expect(screen.queryByRole('region', { name: 'Planificación' })).not.toBeInTheDocument()
  })

  it('names the rodal and saves the sector typed for it', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10')], ['f1'])
    expect(screen.getByRole('heading', { name: 'Planificación · 10' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Sector'), 'Laguna{Enter}')

    expect(onChange).toHaveBeenCalledWith(new Set(['f1']), { sector: 'Laguna' })
  })

  it('never overwrites differing values when a field is only focused and left', async () => {
    const user = userEvent.setup()
    const onChange = setup(
      [
        feature('f1', '10', { sector: 'Norte', reforest_density: 1111 }),
        feature('f2', '11', { sector: 'Sur', reforest_density: 1600 }),
      ],
      ['f1', 'f2'],
    )
    expect(screen.getByRole('heading', { name: 'Planificación · 2 rodales' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sector')).toHaveAttribute('placeholder', 'Varios valores')

    await user.click(screen.getByLabelText('Sector'))
    await user.click(screen.getByLabelText('Densidad reforestación (pl/ha)'))
    await user.tab()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies a typed value to every selected managed rodal, and only to them', async () => {
    const user = userEvent.setup()
    const onChange = setup(
      [feature('f1', '10'), feature('f2', '11'), feature('f3', '12', {}, false)],
      ['f1', 'f2', 'f3'],
    )

    await user.type(screen.getByLabelText('Densidad reforestación (pl/ha)'), '1250{Enter}')

    expect(onChange).toHaveBeenCalledWith(new Set(['f1', 'f2']), { reforest_density: 1250 })
  })

  it('adds and removes species, ignoring a repeat in other case', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10', { reforest_species: ['pino oregón'] })], ['f1'])

    await user.type(screen.getByLabelText('Especie(s) a reforestar'), 'Ulmo{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(new Set(['f1']), { reforest_species: ['pino oregón', 'Ulmo'] })

    onChange.mockClear()
    await user.type(screen.getByLabelText('Especie(s) a reforestar'), 'PINO OREGÓN{Enter}')
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Quitar pino oregón' }))
    expect(onChange).toHaveBeenLastCalledWith(new Set(['f1']), { reforest_species: null })
  })

  it('refuses a density outside 1–20.000 with a message', async () => {
    const user = userEvent.setup()
    const onChange = setup([feature('f1', '10')], ['f1'])

    await user.type(screen.getByLabelText('Densidad reforestación (pl/ha)'), '0{Enter}')

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('entre 1 y 20.000')
  })

  it('only shows the values when the report cannot be edited', () => {
    setup(
      [feature('f1', '10', { sector: 'Norte', reforest_species: ['coigüe', 'canelo'], reforest_density: 1600 })],
      ['f1'],
      false,
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('coigüe + canelo')).toBeInTheDocument()
    expect(screen.getByText('1.600 pl/ha')).toBeInTheDocument()
  })
})
