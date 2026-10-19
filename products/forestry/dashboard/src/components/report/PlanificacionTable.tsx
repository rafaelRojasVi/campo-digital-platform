/**
 * «2 Planificación»: one row per rodal in the management area, filled like a
 * spreadsheet (Javier, 2026-10-19: «Simple»). Sector, species to reforest
 * (one or more) and one total density in pl/ha. The first row, «Todos los
 * rodales», writes a value into every row at once.
 *
 * A cell is written only when its text changed: focusing a cell and leaving
 * it never overwrites what the rodal holds.
 */
import { useState } from 'react'
import { Hint } from '../Hint.tsx'
import { featureCode, type DraftFeature, type PlanningFields } from '../../lib/reportDraft.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const plants = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 })

const MAX_SPECIES = 6

// Suggested only: any species can be typed. The base's 14 species
// (lib/species.ts) plus natives Campo Digital plants after harvest.
const REFOREST_SUGGESTIONS = [
  'pino radiata',
  'pino oregón',
  'Eucalyptus nitens',
  'Eucalyptus globulus',
  'Sequoia sempervirens',
  'secuoya',
  'ciprés',
  'aliso',
  'aromo',
  'roble',
  'raulí',
  'coigüe',
  'ulmo',
  'tepa',
  'canelo',
  'arrayán',
  'luma',
  'mañío',
  'lingue',
  'laurel',
]

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
}: {
  features: DraftFeature[]
  editable: boolean
  onChange: OnChange
}) {
  const managed = features.filter((feature) => feature.in_report)
  const sectors = [...new Set(features.flatMap((f) => (f.sector ? [f.sector] : [])))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
  const used = features.flatMap((f) => f.reforest_species ?? [])
  const suggestions = [...new Set([...used, ...REFOREST_SUGGESTIONS])]

  if (managed.length === 0) {
    return (
      <p className="step-empty">
        Todavía no hay rodales en el área de manejo. Agréguelos en el paso <strong>1 Rodales</strong>.
      </p>
    )
  }

  return (
    <div className="plan-table__scroll">
      <datalist id="plan-sectors">
        {sectors.map((sector) => (
          <option key={sector} value={sector} />
        ))}
      </datalist>
      <datalist id="plan-species">
        {suggestions.map((name) => (
          <option key={name} value={name} />
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
          </tr>
        </thead>
        <tbody>
          {editable && managed.length > 1 ? (
            <AllRow count={managed.length} onApply={(fields) => onChange(new Set(managed.map((f) => f.key)), fields)} />
          ) : null}
          {managed.map((feature) => (
            <PlanRow
              // Re-mount when the stored values change (undo, «Todos»).
              key={`${feature.key}:${feature.sector ?? ''}:${(feature.reforest_species ?? []).join('|')}:${feature.reforest_density ?? ''}`}
              feature={feature}
              editable={editable}
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
  onChange,
}: {
  feature: DraftFeature
  editable: boolean
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

  if (!editable) {
    return (
      <tr>
        <th scope="row">
          <span className="plan-table__rodal">{code}</span>
          <span className="plan-table__ha">{area}</span>
        </th>
        <td>{feature.sector ?? '—'}</td>
        <td>{species.length > 0 ? species.join(' + ') : '—'}</td>
        <td>{feature.reforest_density === null ? '—' : `${plants.format(feature.reforest_density)} pl/ha`}</td>
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
    <tr>
      <th scope="row">
        <span className="plan-table__rodal">{code}</span>
        <span className="plan-table__ha">{area}</span>
      </th>
      <td>
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
      <td>
        <SpeciesCell
          label={`Especies a reforestar del rodal ${code}`}
          species={species}
          onChange={(next) => onChange({ reforest_species: next.length > 0 ? next : null })}
        />
      </td>
      <td>
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
    </tr>
  )
}

function SpeciesCell({
  label,
  species,
  onChange,
}: {
  label: string
  species: string[]
  onChange: (next: string[]) => void
}) {
  const [text, setText] = useState('')
  const add = () => {
    const clean = text.trim()
    setText('')
    if (clean === '' || species.length >= MAX_SPECIES) return
    if (species.some((name) => name.toLocaleLowerCase('es') === clean.toLocaleLowerCase('es'))) return
    onChange([...species, clean])
  }
  return (
    <div className="plan-species">
      {species.map((name) => (
        <span key={name} className="plan-chip">
          {name}
          <button
            type="button"
            aria-label={`Quitar ${name}`}
            onClick={() => onChange(species.filter((item) => item !== name))}
          >
            ×
          </button>
        </span>
      ))}
      {species.length < MAX_SPECIES ? (
        <input
          className="plan-table__input plan-species__input"
          aria-label={label}
          list="plan-species"
          maxLength={40}
          placeholder={species.length === 0 ? 'Agregar…' : '+'}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * «Todos los rodales»: fill any of the three cells and «Aplicar a todos»
 * writes those values (only the ones filled) into every row.
 */
function AllRow({ count, onApply }: { count: number; onApply: (fields: Partial<PlanningFields>) => void }) {
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
      <td>
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
      <td>
        <SpeciesCell label="Especies a reforestar para todos los rodales" species={species} onChange={setSpecies} />
      </td>
      <td>
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
    </tr>
  )
}
