import { useMemo } from 'react'
import { formatHa, formatInt } from '../lib/format.ts'
import type { FeatureCollection, SnapshotSummary, SourceFieldComparison } from '../types.ts'
import { Hint } from './Hint.tsx'

interface KpiStripProps {
  summary: SnapshotSummary
  comparison: SourceFieldComparison
  collection: FeatureCollection
}

interface Kpi {
  label: string
  value: string
  detail?: string
  hint?: string
}

// Server-computed facts where available (summary/comparison endpoints);
// vocabulary counts are derived from the same loaded snapshot data.
export function KpiStrip({ summary, comparison, collection }: KpiStripProps) {
  const kpis = useMemo<Kpi[]>(() => {
    const predioPairs = new Set<string>()
    const predioNames = new Set<string>()
    const predioCodes = new Set<string>()
    const usos2026 = new Set<string>()

    for (const feature of collection.features) {
      const { cod_predial, nom_predio, uso_2026 } = feature.properties
      predioPairs.add(`${cod_predial ?? ''} ${nom_predio ?? ''}`)
      if (nom_predio !== null && nom_predio !== '') predioNames.add(nom_predio)
      if (cod_predial !== null && cod_predial !== '') predioCodes.add(cod_predial)
      if (uso_2026 !== null && uso_2026 !== '') {
        usos2026.add(uso_2026)
      }
    }

    return [
      {
        label: 'Polígonos de origen',
        value: formatInt(summary.feature_count),
      },
      {
        label: 'Superficie (Sup_ha)',
        value: `${formatHa(summary.total_sup_ha)} ha`,
        detail: `geometría: ${formatHa(summary.total_geometry_area_source_units / 10_000)} ha`,
        hint: 'Suma del atributo Sup_ha escrito en el archivo. «Geometría» es el área calculada del dibujo de los polígonos; ambas pueden diferir.',
      },
      {
        label: 'Pares predio código/nombre',
        value: formatInt(predioPairs.size),
        detail: `${formatInt(predioNames.size)} nombres · ${formatInt(predioCodes.size)} códigos`,
        hint: 'Combinaciones distintas de código predial (Cod_Predial) y nombre de predio (Nom_Predio) en el archivo.',
      },
      {
        label: 'Clases de uso 2026',
        value: formatInt(usos2026.size),
      },
      {
        label: 'Códigos distintos 2024/2026',
        hint: 'Polígonos cuyo código de uso 2024 (Cod_Uso) es distinto del código 2026 (CodUso_2026). Debajo, cuántos cambian de clase de uso.',
        value: formatInt(comparison.cod_uso_vs_cod_uso_2026.changed_feature_count),
        detail: `clases de uso distintas: ${formatInt(
          comparison.uso_2024_vs_uso_2026.changed_feature_count,
        )}`,
      },
      {
        label: 'Geometrías inválidas',
        value: formatInt(summary.geometry_invalid_count),
        detail: `${formatInt(summary.geometry_valid_count)} válidas`,
        hint: 'Polígonos cuyo borde se cruza a sí mismo (no válidos según OGC). Se muestran tal como vienen y no admiten «Simular ajuste».',
      },
    ]
  }, [summary, comparison, collection])

  return (
    <section className="kpis" aria-label="Resumen factual de la instantánea">
      {kpis.map((kpi) => (
        <div key={kpi.label} className="kpis__item">
          <span className="kpis__value">{kpi.value}</span>
          <span className="kpis__label">
            {kpi.label}
            {kpi.hint !== undefined ? <Hint text={kpi.hint} /> : null}
          </span>
          {kpi.detail !== undefined ? <span className="kpis__detail">{kpi.detail}</span> : null}
        </div>
      ))}
    </section>
  )
}
