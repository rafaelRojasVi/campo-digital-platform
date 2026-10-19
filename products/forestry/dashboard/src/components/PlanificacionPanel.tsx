/**
 * «Planificación» of the selected managed rodales in the report editor:
 * sector, species to reforest and total density (Javier, 2026-10-19).
 */
import { useState } from 'react'
import { featureCode, type PlanningFields, type ReportDraft } from '../lib/reportDraft.ts'

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

const MAX_REFOREST_SPECIES = 6
const plants = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 })

/** One value shared by every selected rodal, or «mixed» when they differ. */
type Shared<T> = { mixed: true } | { mixed: false; value: T }

function shared<T>(values: T[], same: (a: T, b: T) => boolean): Shared<T> {
  const [first] = values
  if (values.length === 0 || first === undefined) return { mixed: true }
  return values.every((value) => same(value, first)) ? { mixed: false, value: first } : { mixed: true }
}

const sameList = (a: string[] | null, b: string[] | null) => JSON.stringify(a ?? []) === JSON.stringify(b ?? [])

/**
 * «Planificación» of the selected managed rodales: sector, species to
 * reforest and total density (Javier, 2026-10-19). With several rodales
 * selected a field that differs shows «Varios valores» and is only written
 * when the user actually types a new value: leaving it untouched, or
 * focusing and leaving it, never overwrites the rodales' own values.
 */
export function PlanificacionPanel({
  draft,
  selectedKeys,
  editable,
  onChangePlanning,
}: {
  draft: ReportDraft
  selectedKeys: Set<string>
  editable: boolean
  onChangePlanning: (keys: Set<string>, fields: Partial<PlanningFields>) => void
}) {
  const selected = draft.features.filter((f) => selectedKeys.has(f.key) && f.in_report)
  if (selected.length === 0) return null
  // Re-mount the inputs when the selection or the stored values change, so
  // each field starts from what the rodales hold.
  const signature = selected
    .map((f) => `${f.key}:${f.sector ?? ''}:${(f.reforest_species ?? []).join('|')}:${f.reforest_density ?? ''}`)
    .join(';')
  return (
    <PlanificacionFields
      key={signature}
      draft={draft}
      selected={selected}
      editable={editable}
      onChange={(fields) => onChangePlanning(new Set(selected.map((f) => f.key)), fields)}
    />
  )
}

function PlanificacionFields({
  draft,
  selected,
  editable,
  onChange,
}: {
  draft: ReportDraft
  selected: ReportDraft['features']
  editable: boolean
  onChange: (fields: Partial<PlanningFields>) => void
}) {
  const sector = shared(selected.map((f) => f.sector), (a, b) => a === b)
  const species = shared(selected.map((f) => f.reforest_species), sameList)
  const density = shared(selected.map((f) => f.reforest_density), (a, b) => a === b)

  const initialSector = sector.mixed ? '' : (sector.value ?? '')
  const initialDensity = density.mixed || density.value === null ? '' : String(density.value)
  const [sectorText, setSectorText] = useState(initialSector)
  const [densityText, setDensityText] = useState(initialDensity)
  const [speciesText, setSpeciesText] = useState('')
  const [densityError, setDensityError] = useState<string | null>(null)

  const many = selected.length > 1
  const title = many
    ? `Planificación · ${selected.length} rodales`
    : `Planificación · ${featureCode(selected[0]!) ?? 'rodal sin número'}`
  const currentSpecies = species.mixed ? null : (species.value ?? [])

  const commitSector = () => {
    const clean = sectorText.trim()
    if (clean === initialSector.trim()) return
    onChange({ sector: clean === '' ? null : clean })
  }

  const commitDensity = () => {
    const raw = densityText.trim()
    if (raw === initialDensity) {
      setDensityError(null)
      return
    }
    if (raw === '') {
      setDensityError(null)
      onChange({ reforest_density: null })
      return
    }
    const value = Number(raw)
    if (!Number.isInteger(value) || value < 1 || value > 20000) {
      setDensityError('Use un número entero entre 1 y 20.000 pl/ha.')
      return
    }
    setDensityError(null)
    onChange({ reforest_density: value })
  }

  const addSpecies = () => {
    const clean = speciesText.trim()
    if (clean === '') return
    const base = currentSpecies ?? []
    if (base.some((s) => s.toLocaleLowerCase('es') === clean.toLocaleLowerCase('es'))) {
      setSpeciesText('')
      return
    }
    if (base.length >= MAX_REFOREST_SPECIES) return
    onChange({ reforest_species: [...base, clean] })
    setSpeciesText('')
  }

  const removeSpecies = (name: string) => {
    const next = (currentSpecies ?? []).filter((s) => s !== name)
    onChange({ reforest_species: next.length > 0 ? next : null })
  }

  const usedSectors = [...new Set(draft.features.flatMap((f) => (f.sector ? [f.sector] : [])))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  )
  const usedSpecies = draft.features.flatMap((f) => f.reforest_species ?? [])
  const suggestions = [...new Set([...usedSpecies, ...REFOREST_SUGGESTIONS])].filter(
    (s) => !(currentSpecies ?? []).includes(s),
  )

  if (!editable) {
    const show = <T,>(field: Shared<T>, format: (value: T) => string) =>
      field.mixed ? 'Varios valores' : format(field.value)
    return (
      <section className="report-section plan" aria-label="Planificación">
        <h3 className="report-section__title">{title}</h3>
        <dl className="plan__readonly">
          <div><dt>Sector</dt><dd>{show(sector, (v) => v ?? '—')}</dd></div>
          <div><dt>Especie(s) a reforestar</dt><dd>{show(species, (v) => (v && v.length > 0 ? v.join(' + ') : '—'))}</dd></div>
          <div><dt>Densidad reforestación</dt><dd>{show(density, (v) => (v === null ? '—' : `${plants.format(v)} pl/ha`))}</dd></div>
        </dl>
      </section>
    )
  }

  return (
    <section className="report-section plan" aria-label="Planificación">
      <h3 className="report-section__title">{title}</h3>
      {many ? <p className="plan__hint">Lo que escriba aquí se aplica a los {selected.length} rodales seleccionados.</p> : null}

      <div className="report-form__field">
        <label htmlFor="plan-sector">Sector</label>
        <input
          id="plan-sector"
          list="plan-sector-list"
          value={sectorText}
          placeholder={sector.mixed ? 'Varios valores' : 'Ej.: La Reina'}
          maxLength={60}
          onChange={(event) => setSectorText(event.target.value)}
          onBlur={commitSector}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitSector()
          }}
        />
        <datalist id="plan-sector-list">
          {usedSectors.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      <div className="report-form__field">
        <label htmlFor="plan-species">Especie(s) a reforestar</label>
        {species.mixed ? (
          <p className="plan__mixed">Varios valores · agregar una especie reemplaza la lista en los {selected.length} rodales.</p>
        ) : currentSpecies && currentSpecies.length > 0 ? (
          <ul className="plan__chips" aria-label="Especies a reforestar">
            {currentSpecies.map((name) => (
              <li key={name} className="plan__chip">
                <span>{name}</span>
                <button type="button" aria-label={`Quitar ${name}`} onClick={() => removeSpecies(name)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="plan__add">
          <input
            id="plan-species"
            list="plan-species-list"
            value={speciesText}
            placeholder="Escriba o elija una especie"
            maxLength={40}
            disabled={(currentSpecies?.length ?? 0) >= MAX_REFOREST_SPECIES}
            onChange={(event) => setSpeciesText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addSpecies()
              }
            }}
          />
          <button
            type="button"
            className="button button--ghost"
            disabled={speciesText.trim() === '' || (currentSpecies?.length ?? 0) >= MAX_REFOREST_SPECIES}
            onClick={addSpecies}
          >
            Agregar
          </button>
          <datalist id="plan-species-list">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="report-form__field">
        <label htmlFor="plan-density">Densidad reforestación (pl/ha)</label>
        <input
          id="plan-density"
          inputMode="numeric"
          value={densityText}
          placeholder={density.mixed ? 'Varios valores' : 'Ej.: 1111'}
          aria-invalid={densityError !== null}
          aria-describedby={densityError ? 'plan-density-error' : undefined}
          onChange={(event) => setDensityText(event.target.value)}
          onBlur={commitDensity}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitDensity()
          }}
        />
        {densityError ? (
          <span id="plan-density-error" className="plan__error" role="alert">
            {densityError}
          </span>
        ) : null}
      </div>
    </section>
  )
}
