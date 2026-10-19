/**
 * The card over the map for one rodal (Javier, 2026-10-19: «Simple»):
 * - a rodal of the report: its species and hectares, «Dividir», «Sacar del
 *   informe» (or «Incluir» for the rest of a split) and «Editar datos»;
 * - a base rodal found by number: «Agregar al informe».
 * A click on the map adds a base rodal directly; the card is for rodales
 * already in the report, so a planned rodal is never removed by a stray click.
 */
import { useState } from 'react'
import { Hint } from '../Hint.tsx'
import { Icon } from './Icon.tsx'
import { rodalKind } from '../../lib/rodalKind.ts'
import { EDITABLE_ATTRIBUTES, featureCode, type DraftFeature } from '../../lib/reportDraft.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const RESTO_HINT =
  'Parte del rodal que quedó fuera del área de manejo al dividirlo. Sigue en el informe para que se vea el corte, pero no sale en el Excel de cosecha.'

type Props =
  | {
      kind: 'feature'
      feature: DraftFeature
      editable: boolean
      baseValues: Record<string, string | null>
      onClose: () => void
      onSplit: () => void
      onRemove: () => void
      onToggle: () => void
      onEdit: (name: string, value: string, baseValue: string | null) => void
    }
  | {
      kind: 'base'
      code: string
      attributes: Record<string, unknown>
      editable: boolean
      onClose: () => void
      onAdd: () => void
    }

export function RodalCard(props: Props) {
  const [editing, setEditing] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const attributes = props.kind === 'feature' ? props.feature.attributes : props.attributes
  const code = props.kind === 'feature' ? (featureCode(props.feature) ?? 'Sin número') : props.code
  const area = `${ha.format(Number(attributes.sup_ha ?? 0))} ha`
  const managed = props.kind === 'feature' && props.feature.in_report

  return (
    <section className="rodal-card" aria-label={`Rodal ${code}`}>
      <div className="rodal-card__head">
        <div>
          <h3 className="rodal-card__title">{`Rodal ${code}`}</h3>
          <p className="rodal-card__meta">{`${rodalKind(attributes)} · ${area}`}</p>
        </div>
        <button type="button" className="icon-button" aria-label="Cerrar" onClick={props.onClose}>
          <Icon name="x" />
        </button>
      </div>

      {props.kind === 'feature' ? (
        <span className={`rodal-card__badge${managed ? '' : ' rodal-card__badge--rest'}`}>
          {managed ? 'En el informe' : 'Resto'}
          {managed ? null : <Hint text={RESTO_HINT} />}
        </span>
      ) : (
        <span className="rodal-card__badge rodal-card__badge--out">Fuera del informe</span>
      )}

      {props.editable && props.kind === 'base' ? (
        <button type="button" className="button rodal-card__main" onClick={props.onAdd}>
          <Icon name="plus" />
          Agregar al informe
        </button>
      ) : null}

      {props.editable && props.kind === 'feature' ? (
        <div className="rodal-card__actions">
          {managed ? (
            <button type="button" className="button button--ghost" onClick={props.onSplit}>
              <Icon name="scissors" />
              Dividir
            </button>
          ) : (
            <button type="button" className="button button--ghost" onClick={props.onToggle}>
              <Icon name="restore" />
              Incluir
            </button>
          )}
          <button type="button" className="button button--ghost rodal-card__danger" onClick={props.onRemove}>
            <Icon name="trash" />
            Sacar del informe
          </button>
          <button
            type="button"
            className="button button--ghost"
            aria-expanded={editing}
            onClick={() => setEditing((open) => !open)}
          >
            <Icon name="pencil" />
            {editing ? 'Cerrar datos' : 'Editar datos'}
          </button>
        </div>
      ) : null}

      {editing && props.kind === 'feature' && props.editable ? (
        <div className="rodal-card__fields">
          {managed ? (
            <button type="button" className="link-button" onClick={props.onToggle}>
              Dejar fuera del área de manejo
            </button>
          ) : null}
          {EDITABLE_ATTRIBUTES.map((attribute) => {
            const raw = props.feature.attributes[attribute.key]
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
                    if (typed.trim() !== value) {
                      props.onEdit(attribute.key, typed, props.baseValues[attribute.key] ?? null)
                    }
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
    </section>
  )
}
