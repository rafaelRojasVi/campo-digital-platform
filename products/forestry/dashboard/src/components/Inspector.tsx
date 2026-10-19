import { useEffect, useState } from 'react'
import { fetchFeatureDetail } from '../api.ts'
import { formatHa } from '../lib/format.ts'
import { qualityFlagLabel } from '../lib/qualityLabels.ts'
import { sourceUnitsToHa } from '../lib/format.ts'
import { NO_SPECIES_GROUP, speciesGroup } from '../lib/species.ts'
import type { GeoFeature, SourceFeatureDetail } from '../types.ts'

interface InspectorProps {
  snapshotId: number
  feature: GeoFeature
  onClose: () => void
  onZoom: () => void
  /** Present for operators and admins: sends this polygon to a report. */
  onAddToReport?: () => void
}

type DetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; detail: SourceFeatureDetail }

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="inspector__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

// Detail view of one selected polygon. The everyday facts (species, use,
// code, area) come first in plain words; source evidence (2024 fields,
// geometry validity, OBJECTID, the original attribute row) sits behind
// «Detalle técnico».
export function Inspector({ snapshotId, feature, onClose, onZoom, onAddToReport }: InspectorProps) {
  const [detailState, setDetailState] = useState<DetailState>({ status: 'loading' })
  const [attributesOpen, setAttributesOpen] = useState(false)

  const p = feature.properties

  useEffect(() => {
    let cancelled = false

    fetchFeatureDetail(snapshotId, p.feature_ordinal)
      .then((detail) => {
        if (!cancelled) {
          setDetailState({ status: 'ready', detail })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailState({ status: 'error' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [snapshotId, p.feature_ordinal])

  const usoDiffers = p.uso_2024 !== p.uso_2026
  const codeDiffers = p.cod_uso !== p.cod_uso_2026
  const detail = detailState.status === 'ready' ? detailState.detail : null
  const species = speciesGroup(p.cod_uso_2026)
  const speciesText = species === NO_SPECIES_GROUP ? null : species.label

  return (
    <aside className="inspector" aria-label="Detalle del polígono seleccionado">
      <div className="inspector__head">
        <div>
          <h2 className="inspector__title">
            {p.nom_predio ?? 'Predio sin nombre'}
            {p.cod_predial !== null ? (
              <span className="inspector__code"> {p.cod_predial}</span>
            ) : null}
          </h2>
          <p className="inspector__subtitle">
            {p.n_rodal !== null && p.n_rodal !== ''
              ? `Rodal ${p.n_rodal}`
              : 'Sin rodal en la fuente'}
          </p>
        </div>
        <div className="inspector__head-actions">
          <button type="button" className="button button--ghost" onClick={onZoom}>
            Acercar
          </button>
          <button
            type="button"
            className="inspector__close"
            onClick={onClose}
            aria-label="Cerrar detalle"
          >
            ×
          </button>
        </div>
      </div>

      {onAddToReport !== undefined ? (
        <div className="inspector__primary">
          <button type="button" className="button" onClick={onAddToReport}>
            Agregar a un informe
          </button>
        </div>
      ) : null}

      <div className="inspector__body">
        <section className="inspector__section">
          <dl>
            {speciesText !== null ? <Row label="Especie" value={speciesText} /> : null}
            <Row label="Uso 2026" value={p.uso_2026 ?? '(vacío)'} />
            <Row label="Código 2026" value={p.cod_uso_2026 ?? '(vacío)'} />
            <Row label="Descripción" value={p.desc_uso ?? '(vacío)'} />
            <Row
              label="Superficie"
              value={p.sup_ha !== null ? `${formatHa(p.sup_ha)} ha` : '(vacío)'}
            />
          </dl>
        </section>

        {p.quality_flags.length > 0 ? (
          <section className="inspector__section inspector__section--review">
            <h3>Para revisar en la base</h3>
            <ul className="inspector__flags">
              {p.quality_flags.map((flag) => (
                <li key={flag}>{qualityFlagLabel(flag)}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <details className="inspector__technical">
          <summary>Detalle técnico</summary>
          <dl>
            <Row label="Uso 2024" value={p.uso_2024 ?? '(vacío)'} />
            {usoDiffers ? (
              <p className="inspector__difference">El uso 2024 y el uso 2026 son distintos.</p>
            ) : null}
            <Row label="Código 2024" value={p.cod_uso ?? '(vacío)'} />
            {codeDiffers ? (
              <p className="inspector__difference">El código 2024 y el código 2026 son distintos.</p>
            ) : null}
            <Row
              label="Área calculada del dibujo"
              value={`${formatHa(sourceUnitsToHa(p.geometry_area_source_units))} ha`}
            />
            <Row label="Geometría" value={p.geometry_is_valid ? 'Válida' : 'Inválida'} />
            {detail !== null && detail.geometry_invalid_reason !== null ? (
              <Row label="Motivo" value={detail.geometry_invalid_reason} />
            ) : null}
            <Row
              label="OBJECTID"
              value={p.source_objectid !== null ? String(p.source_objectid) : '(vacío)'}
            />
            <Row label="Registro N° en el shapefile" value={String(p.feature_ordinal)} />
            <Row label="Versión" value={String(snapshotId)} />
          </dl>
        </details>

        <section className="inspector__section">
          {detailState.status === 'loading' ? (
            <p className="inspector__loading">Cargando atributos originales…</p>
          ) : null}
          {detailState.status === 'error' ? (
            <p className="inspector__error">
              No fue posible cargar el detalle completo desde la API.
            </p>
          ) : null}
          {detail !== null ? (
            <>
              <button
                type="button"
                className="inspector__attributes-toggle"
                aria-expanded={attributesOpen}
                onClick={() => setAttributesOpen((open) => !open)}
              >
                {attributesOpen ? 'Ocultar atributos originales' : 'Atributos originales'} (
                {Object.keys(detail.source_attributes).length} campos)
              </button>
              {attributesOpen ? (
                <dl className="inspector__attributes">
                  {Object.entries(detail.source_attributes).map(([key, value]) => (
                    <Row
                      key={key}
                      label={key}
                      value={value === null || value === '' ? '(vacío)' : String(value)}
                    />
                  ))}
                </dl>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </aside>
  )
}
