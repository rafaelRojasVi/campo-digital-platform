/**
 * One rodal of the report in «1 Rodales»: number, species and hectares on one
 * line. A rodal in the management area is orange; the rest of a split is
 * marked «Resto». Editing the base fields (N.º rodal, códigos…) is rare, so it
 * stays behind «Editar datos».
 */
import { useState } from 'react'
import { Hint } from '../Hint.tsx'
import { NO_SPECIES_GROUP, speciesGroup } from '../../lib/species.ts'
import { EDITABLE_ATTRIBUTES, featureCode, type DraftFeature } from '../../lib/reportDraft.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const RESTO_HINT =
  'Parte del rodal que quedó fuera del área de manejo al dividirlo. Sigue en el informe para que se vea el corte, pero no sale en el Excel de cosecha. «Incluir» la vuelve a sumar.'

export function RodalRow({
  feature,
  editable,
  selected,
  baseValues,
  onSelect,
  onToggle,
  onRemove,
  onEdit,
}: {
  feature: DraftFeature
  editable: boolean
  selected: boolean
  baseValues: Record<string, string | null>
  onSelect: (additive: boolean) => void
  onToggle: () => void
  onRemove: () => void
  onEdit: (name: string, value: string, baseValue: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const code = featureCode(feature) ?? 'Sin número'
  const rawCode = feature.attributes.cod_uso_2026 ?? feature.attributes.cod_uso
  const group = speciesGroup(rawCode === null || rawCode === undefined ? null : String(rawCode))
  // Without a species in the code (bosque nativo, vegas…), the base's own use.
  const use = String(feature.attributes.uso_2026 ?? feature.attributes.desc_uso ?? '').trim()
  const species =
    group.key === NO_SPECIES_GROUP.key && use !== ''
      ? use.charAt(0).toUpperCase() + use.slice(1).toLowerCase()
      : group.label
  const area = `${ha.format(Number(feature.attributes.sup_ha ?? 0))} ha`

  return (
    <li
      className={`rodal-row${feature.in_report ? ' rodal-row--managed' : ' rodal-row--rest'}${selected ? ' rodal-row--selected' : ''}`}
    >
      <button
        type="button"
        className="rodal-row__main"
        aria-pressed={selected}
        aria-label={`Rodal ${code}, ${species}, ${area}${feature.in_report ? '' : ', resto'}`}
        onClick={(event) => onSelect(event.shiftKey)}
      >
        <span className="rodal-row__swatch" aria-hidden="true" />
        <span className="rodal-row__name">{`Rodal ${code}`}</span>
        <span className="rodal-row__meta">{`${species} · ${area}`}</span>
      </button>
      {!feature.in_report ? (
        <span className="rodal-row__rest">
          Resto <Hint text={RESTO_HINT} />
        </span>
      ) : null}
      {editable ? (
        <span className="rodal-row__actions">
          {!feature.in_report ? (
            <button type="button" className="link-button" onClick={onToggle}>
              Incluir
            </button>
          ) : null}
          <button
            type="button"
            className="link-button"
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? 'Cerrar datos' : 'Editar datos'}
          </button>
          {feature.in_report ? (
            <button
              type="button"
              className="link-button link-button--danger"
              onClick={onRemove}
              title={feature.geometry_changed ? 'Quita el rodal completo del informe, con todas sus partes.' : undefined}
            >
              Quitar rodal
            </button>
          ) : null}
        </span>
      ) : null}
      {editing && editable ? (
        <div className="rodal-row__fields">
          {feature.in_report ? (
            <button type="button" className="link-button" onClick={onToggle}>
              Dejar fuera del área de manejo
            </button>
          ) : null}
          {EDITABLE_ATTRIBUTES.map((attribute) => {
            const raw = feature.attributes[attribute.key]
            const value = raw === null || raw === undefined ? '' : String(raw)
            return (
              <label key={attribute.key} className="report-form__field">
                <span>{attribute.label}</span>
                <input
                  // Keyed on the value: undo/redo replaces the shown text.
                  key={`${attribute.key}:${value}`}
                  defaultValue={value}
                  aria-invalid={fieldError === attribute.key}
                  onBlur={(event) => {
                    const typed = event.target.value
                    if (new TextEncoder().encode(typed.trim()).length > attribute.bytes) {
                      setFieldError(attribute.key)
                      return
                    }
                    setFieldError(null)
                    if (typed.trim() !== value) onEdit(attribute.key, typed, baseValues[attribute.key] ?? null)
                  }}
                />
                {fieldError === attribute.key ? (
                  <span className="report-form__error">Texto demasiado largo para este campo.</span>
                ) : null}
              </label>
            )
          })}
        </div>
      ) : null}
    </li>
  )
}
