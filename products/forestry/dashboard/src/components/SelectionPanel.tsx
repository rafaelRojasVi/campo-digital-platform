import { formatHa, formatInt } from '../lib/format.ts'
import { speciesGroup } from '../lib/species.ts'
import type { GeoFeature } from '../types.ts'

interface SelectionPanelProps {
  features: GeoFeature[]
  onClear: () => void
  onZoom: () => void
  /** Present for operators and admins. */
  onAddToReport?: () => void
  onSelectOne: (featureOrdinal: number) => void
}

// Two or more polygons chosen with Mayús + clic or Mayús + arrastrar: their
// total, the hectares per species, and the list, ready for a report.
export function SelectionPanel({
  features,
  onClear,
  onZoom,
  onAddToReport,
  onSelectOne,
}: SelectionPanelProps) {
  const total = features.reduce((sum, feature) => sum + (feature.properties.sup_ha ?? 0), 0)
  const bySpecies = new Map<string, { label: string; ha: number; count: number }>()
  for (const feature of features) {
    const group = speciesGroup(feature.properties.cod_uso_2026)
    const entry = bySpecies.get(group.key) ?? { label: group.label, ha: 0, count: 0 }
    entry.ha += feature.properties.sup_ha ?? 0
    entry.count += 1
    bySpecies.set(group.key, entry)
  }
  const species = [...bySpecies.values()].sort((a, b) => b.ha - a.ha)

  return (
    <aside className="inspector selection" aria-label="Polígonos seleccionados">
      <div className="inspector__head">
        <div>
          <h2 className="inspector__title">{formatInt(features.length)} polígonos seleccionados</h2>
          <p className="inspector__subtitle">{formatHa(total)} ha en total</p>
        </div>
        <div className="inspector__head-actions">
          <button type="button" className="button button--ghost" onClick={onZoom}>
            Acercar
          </button>
          <button
            type="button"
            className="inspector__close"
            onClick={onClear}
            aria-label="Limpiar selección"
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
          <h3>Por especie</h3>
          <dl>
            {species.map((entry) => (
              <div key={entry.label} className="inspector__row">
                <dt>{entry.label}</dt>
                <dd>
                  {formatHa(entry.ha)} ha · {formatInt(entry.count)}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="inspector__section">
          <h3>Polígonos</h3>
          <ul className="selection__list">
            {features.map((feature) => {
              const p = feature.properties
              return (
                <li key={p.feature_ordinal}>
                  <button type="button" onClick={() => onSelectOne(p.feature_ordinal)}>
                    <span>
                      {p.nom_predio ?? 'Predio sin nombre'} ·{' '}
                      {p.n_rodal !== null && p.n_rodal !== '' ? `Rodal ${p.n_rodal}` : 'Sin rodal'}
                      {p.cod_uso_2026 !== null ? ` · ${p.cod_uso_2026}` : ''}
                    </span>
                    <span>{p.sup_ha !== null ? `${formatHa(p.sup_ha)} ha` : ''}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>

        <p className="selection__hint">
          Mayús + clic agrega o quita un polígono; Mayús + arrastrar elige un área. Esc limpia la
          selección.
        </p>
      </div>
    </aside>
  )
}
