/**
 * The report's table: one row per rodal in the management area, filled like a
 * spreadsheet (Javier, 2026-10-19: «Simple»). Sector, species to reforest
 * (one or more) and one total density in pl/ha. The first row, «Todos los
 * rodales», writes a value into every row at once.
 *
 * A cell is written only when its text changed: focusing a cell and leaving
 * it never overwrites what the rodal holds.
 */
import { useState } from 'react'
import { Hint } from '../Hint.tsx'
import { SpeciesPicker } from './SpeciesPicker.tsx'
import { Icon } from './Icon.tsx'
import { featureCode, type DraftFeature, type PlanningFields } from '../../lib/reportDraft.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const plants = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 })

type OnChange = (keys: Set<string>, fields: Partial<PlanningFields>) => void

function parseDensity(raw: string): number | null | 'invalid' {
  const clean = raw.trim().replace(/\./g, '')
  if (clean === '') return null
  const value = Number(clean)
  return Number.isInteger(value) && value >= 1 && value <= 20000 ? value : 'invalid'
}

const DENSITY_ERROR = 'Entre 1 y 20.000 pl/ha.'

export function PlanificacionTable({
  features,
  editable,
  onChange,
  activeKey = null,
  onRodal,
  onHover,
  onRemove,
}: {
  features: DraftFeature[]
  editable: boolean
  onChange: OnChange
  /** The rodal shown on the map (its card is open, or the row is hovered). */
  activeKey?: string | null
  /** The rodal cell was clicked: show that rodal on the map. */
  onRodal?: (key: string) => void
  /** The pointer entered (key) or left (null) a row: highlight it on the map. */
  onHover?: (key: string | null) => void
  /** «Sacar del informe» from the row's ×. */
  onRemove?: (key: string) => void
}) {
  const managed = features.filter((feature) => feature.in_report)
  const sectors = [...new Set(features.flatMap((f) => (f.sector ? [f.sector] : [])))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
  const used = features.flatMap((f) => f.reforest_species ?? [])

  if (managed.length === 0) {
    return (
      <div className="step-empty">
        <p><strong>Todavía no hay rodales en el informe.</strong></p>
        <p>Haga clic en un rodal del mapa: entra al informe. Si se equivoca, «Deshacer».</p>
      </div>
    )
  }

  return (
    <div className="plan-table__scroll">
      <datalist id="plan-sectors">
        {sectors.map((sector) => (
          <option key={sector} value={sector} />
        ))}
      </datalist>
      <table className="plan-table">
        <thead>
          <tr>
            <th scope="col">Rodal</th>
            <th scope="col">
              Sector <Hint text="Nombre del sector donde está el rodal (por ejemplo «La Reina»). No está en la base: lo escribe quien conoce el predio." />
            </th>
            <th scope="col">
              Especie(s) a reforestar <Hint text="Una o más especies que se plantarán después de la cosecha. Elija de la lista o escriba otra y presione Enter." />
            </th>
            <th scope="col">
              Densidad <Hint text="Plantas por hectárea en total para el rodal, sumando todas sus especies." />
            </th>
            {editable && onRemove ? (
              <th scope="col">
                <span className="sr-only">Sacar</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {editable && managed.length > 1 ? (
            <AllRow count={managed.length} used={used} withRemove={Boolean(onRemove)} onApply={(fields) => onChange(new Set(managed.map((f) => f.key)), fields)} />
          ) : null}
          {managed.map((feature) => (
            <PlanRow
              // Re-mount when the stored values change (undo, «Todos»).
              key={`${feature.key}:${feature.sector ?? ''}:${(feature.reforest_species ?? []).join('|')}:${feature.reforest_density ?? ''}`}
              feature={feature}
              editable={editable}
              active={activeKey === feature.key}
              used={used}
              onRemove={editable ? onRemove : undefined}
              onRodal={onRodal}
              onHover={onHover}
              onChange={(fields) => onChange(new Set([feature.key]), fields)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanRow({
  feature,
  editable,
  active,
  used,
  onRodal,
  onHover,
  onRemove,
  onChange,
}: {
  feature: DraftFeature
  editable: boolean
  active: boolean
  used: string[]
  onRemove?: (key: string) => void
  onRodal?: (key: string) => void
  onHover?: (key: string | null) => void
  onChange: (fields: Partial<PlanningFields>) => void
}) {
  const code = featureCode(feature) ?? 'Sin número'
  const area = `${ha.format(Number(feature.attributes.sup_ha ?? 0))} ha`
  const initialSector = feature.sector ?? ''
  const initialDensity = feature.reforest_density === null ? '' : String(feature.reforest_density)
  const [sector, setSector] = useState(initialSector)
  const [density, setDensity] = useState(initialDensity)
  const [error, setError] = useState<string | null>(null)
  const species = feature.reforest_species ?? []
  const rowProps = {
    className: active ? 'plan-table__row plan-table__row--active' : 'plan-table__row',
    onMouseEnter: onHover ? () => onHover(feature.key) : undefined,
    onMouseLeave: onHover ? () => onHover(null) : undefined,
  }
  const rodalCell = (
    <th scope="row">
      {onRodal ? (
        <button
          type="button"
          className="plan-table__rodal-button"
          aria-label={`Ver el rodal ${code} en el mapa`}
          onClick={() => onRodal(feature.key)}
        >
          <span className="plan-table__rodal">{code}</span>
          <span className="plan-table__ha">{area}</span>
        </button>
      ) : (
        <>
          <span className="plan-table__rodal">{code}</span>
          <span className="plan-table__ha">{area}</span>
        </>
      )}
    </th>
  )

  if (!editable) {
    return (
      <tr {...rowProps}>
        {rodalCell}
        <td data-label="Sector">{feature.sector ?? '—'}</td>
        <td data-label="Especie(s) a reforestar">{species.length > 0 ? species.join(' + ') : '—'}</td>
        <td data-label="Densidad">{feature.reforest_density === null ? '—' : `${plants.format(feature.reforest_density)} pl/ha`}</td>
      </tr>
    )
  }

  const commitSector = () => {
    const clean = sector.trim()
    if (clean !== initialSector) onChange({ sector: clean === '' ? null : clean })
  }
  const commitDensity = () => {
    if (density.trim() === initialDensity) {
      setError(null)
      return
    }
    const value = parseDensity(density)
    if (value === 'invalid') {
      setError(DENSITY_ERROR)
      return
    }
    setError(null)
    onChange({ reforest_density: value })
  }

  return (
    <tr {...rowProps}>
      {rodalCell}
      <td data-label="Sector">
        <input
          className="plan-table__input"
          aria-label={`Sector del rodal ${code}`}
          list="plan-sectors"
          maxLength={60}
          value={sector}
          onChange={(event) => setSector(event.target.value)}
          onBlur={commitSector}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitSector()
          }}
        />
      </td>
      <td data-label="Especie(s) a reforestar">
        <SpeciesPicker
          label={`Especies a reforestar del rodal ${code}`}
          used={used}
          species={species}
          onChange={(next) => onChange({ reforest_species: next.length > 0 ? next : null })}
        />
      </td>
      <td data-label="Densidad">
        <span className="plan-table__density">
          <input
            className="plan-table__input plan-table__input--number"
            aria-label={`Densidad del rodal ${code} en plantas por hectárea`}
            inputMode="numeric"
            value={density}
            aria-invalid={error !== null}
            onChange={(event) => setDensity(event.target.value)}
            onBlur={commitDensity}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDensity()
            }}
          />
          <span className="plan-table__unit">pl/ha</span>
        </span>
        {error ? (
          <span className="plan-table__error" role="alert">
            {error}
          </span>
        ) : null}
      </td>
      {onRemove ? (
        <td className="plan-table__remove">
          <button
            type="button"
            className="icon-button icon-button--danger"
            aria-label={`Sacar el rodal ${code} del informe`}
            title="Sacar del informe"
            onClick={() => onRemove(feature.key)}
          >
            <Icon name="trash" size={16} />
          </button>
        </td>
      ) : null}
    </tr>
  )
}

/**
 * «Todos los rodales»: fill any of the three cells and «Aplicar a todos»
 * writes those values (only the ones filled) into every row.
 */
function AllRow({
  count,
  used,
  withRemove,
  onApply,
}: {
  count: number
  used: string[]
  withRemove: boolean
  onApply: (fields: Partial<PlanningFields>) => void
}) {
  const [sector, setSector] = useState('')
  const [species, setSpecies] = useState<string[]>([])
  const [density, setDensity] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState('')

  const empty = sector.trim() === '' && species.length === 0 && density.trim() === ''

  const apply = () => {
    const fields: Partial<PlanningFields> = {}
    if (sector.trim() !== '') fields.sector = sector.trim()
    if (species.length > 0) fields.reforest_species = species
    const value = parseDensity(density)
    if (value === 'invalid') {
      setError(DENSITY_ERROR)
      return
    }
    if (value !== null) fields.reforest_density = value
    if (Object.keys(fields).length === 0) return
    setError(null)
    onApply(fields)
    setSector('')
    setSpecies([])
    setDensity('')
    setApplied(`Aplicado a los ${count} rodales.`)
  }

  const onEnter = (event: { key: string }) => {
    if (event.key === 'Enter') apply()
  }

  return (
    <tr className="plan-table__all">
      <th scope="row">
        <span className="plan-table__rodal">
          {'Todos '}
          <Hint text="Escriba en esta fila y presione «Aplicar a todos»: el valor queda igual en todos los rodales. Después puede cambiar uno por uno." />
        </span>
        <button type="button" className="button button--small plan-table__apply-all" onClick={apply} disabled={empty}>
          Aplicar a todos
        </button>
        <span className="sr-only" role="status">
          {applied}
        </span>
      </th>
      <td data-label="Sector">
        <input
          className="plan-table__input"
          aria-label="Sector para todos los rodales"
          list="plan-sectors"
          maxLength={60}
          value={sector}
          onChange={(event) => setSector(event.target.value)}
          onKeyDown={onEnter}
        />
      </td>
      <td data-label="Especie(s) a reforestar">
        <SpeciesPicker label="Especies a reforestar para todos los rodales" used={used} species={species} onChange={setSpecies} />
      </td>
      <td data-label="Densidad">
        <span className="plan-table__density">
          <input
            className="plan-table__input plan-table__input--number"
            aria-label="Densidad para todos los rodales en plantas por hectárea"
            inputMode="numeric"
            value={density}
            aria-invalid={error !== null}
            onChange={(event) => setDensity(event.target.value)}
            onKeyDown={onEnter}
          />
          <span className="plan-table__unit">pl/ha</span>
        </span>
        {error ? (
          <span className="plan-table__error" role="alert">
            {error}
          </span>
        ) : null}
      </td>
      {withRemove ? <td className="plan-table__spacer" /> : null}
    </tr>
  )
}
