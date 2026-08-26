import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from 'react'

import './App.css'

import {
  artifactUrl,
  getRun,
  listRuns,
  type MeasurementArtifact,
  type MeasurementRun,
  type MeasurementWarning,
  type RecessedRegionSummary,
} from './api'

const PointCloudPreview = lazy(
  () => import('./PointCloudPreview'),
)

type Language = 'es' | 'en'

function t(
  language: Language,
  spanish: string,
  english: string,
): string {
  return language === 'es' ? spanish : english
}

function formatNumber(
  value: number | null | undefined,
  digits: number,
  language: Language,
): string {
  if (value === null || value === undefined) {
    return '—'
  }

  return value.toLocaleString(
    language === 'es' ? 'es-CL' : 'en-US',
    {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    },
  )
}

function formatInteger(
  value: number | null | undefined,
  language: Language,
): string {
  if (value === null || value === undefined) {
    return '—'
  }

  return Math.round(value).toLocaleString(
    language === 'es' ? 'es-CL' : 'en-US',
  )
}

function formatPercent(
  fraction: number | null | undefined,
  language: Language,
  digits = 1,
): string {
  if (fraction === null || fraction === undefined) {
    return '—'
  }

  return `${formatNumber(
    fraction * 100,
    digits,
    language,
  )}%`
}

function formatDate(
  value: string | null,
  language: Language,
): string {
  if (!value) {
    return '—'
  }

  return new Date(value).toLocaleString(
    language === 'es' ? 'es-CL' : 'en-US',
  )
}

function getNumericParameter(
  parameters: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const value = parameters?.[key]

  return typeof value === 'number'
    ? value
    : null
}

function warningLabel(
  warning: MeasurementWarning,
  language: Language,
): string {
  const labels: Record<
    string,
    { es: string; en: string }
  > = {
    crs_unconfirmed: {
      es: 'Sistema de coordenadas sin confirmar',
      en: 'Coordinate reference system unconfirmed',
    },
    linear_units_unconfirmed: {
      es: 'Unidades físicas sin confirmar',
      en: 'Physical units unconfirmed',
    },
    pile_depth_not_supplied: {
      es: 'Largo o profundidad de la ruma no ingresado',
      en: 'Pile depth not supplied',
    },
    las_metadata_warning: {
      es: 'Advertencia de metadatos LAS',
      en: 'LAS metadata warning',
    },
  }

  const label = labels[warning.code]

  if (!label) {
    return warning.code
  }

  return language === 'es'
    ? label.es
    : label.en
}

function warningMessage(
  warning: MeasurementWarning,
  language: Language,
): string {
  if (language === 'en') {
    return warning.message
  }

  const messages: Record<string, string> = {
    crs_unconfirmed:
      'El archivo no contiene un sistema de referencia de coordenadas confirmado explícitamente.',
    linear_units_unconfirmed:
      'Las unidades físicas horizontales no están confirmadas. La geometría se mantiene en unidades de la nube de origen.',
    pile_depth_not_supplied:
      'No se ingresó un largo o profundidad validado de la ruma, por lo que todavía no se calcula volumen cúbico.',
    las_metadata_warning:
      'El LAS no contiene un CRS inequívoco en sus metadatos VLR/EVLR.',
  }

  return messages[warning.code] ?? warning.message
}

function artifactTitle(
  artifact: MeasurementArtifact,
  language: Language,
): string {
  const labels: Record<
    string,
    { es: string; en: string }
  > = {
    front_profile_plot: {
      es: 'Perfil frontal: base y borde superior',
      en: 'Front profile: base and upper envelope',
    },
    front_height_profile_plot: {
      es: 'Altura de la ruma por segmento',
      en: 'Timber-stack height by segment',
    },
    projected_face_raster_plot: {
      es: 'Cara proyectada y raster de ocupación',
      en: 'Projected face and occupancy raster',
    },
    front_depth_recession_plot: {
      es: 'Profundidad frontal y zonas de recesión',
      en: 'Front depth and recessed regions',
    },
  }

  const label = labels[artifact.kind]

  if (!label) {
    return artifact.kind
  }

  return language === 'es'
    ? label.es
    : label.en
}

function artifactDescription(
  artifact: MeasurementArtifact,
  language: Language,
): string {
  if (language === 'en') {
    return artifact.description ?? ''
  }

  const descriptions: Record<string, string> = {
    front_profile_plot:
      'Contorno observable de la cara: borde inferior y borde superior calculados automáticamente.',
    front_height_profile_plot:
      'Altura observada de la ruma a lo largo de su eje principal.',
    projected_face_raster_plot:
      'Evidencia de ocupación 2D, componente principal y silueta proyectada utilizada por el estimador raster.',
    front_depth_recession_plot:
      'Mapa de profundidad frontal y regiones donde la superficie retrocede respecto del frente esperado.',
  }

  return (
    descriptions[artifact.kind] ??
    artifact.description ??
    ''
  )
}

function readinessLabel(
  stage: string | undefined,
  language: Language,
): string {
  const labels: Record<
    string,
    { es: string; en: string }
  > = {
    not_ready: {
      es: 'No preparado',
      en: 'Not ready',
    },
    observable_geometry: {
      es: 'Geometría observable',
      en: 'Observable geometry',
    },
    physical_face_area: {
      es: 'Área física confirmada',
      en: 'Physical face area',
    },
    geometric_volume: {
      es: 'Volumen geométrico',
      en: 'Geometric volume',
    },
    reference_validated: {
      es: 'Validado contra referencia',
      en: 'Reference validated',
    },
  }

  if (!stage) {
    return '—'
  }

  const label = labels[stage]

  if (!label) {
    return stage
  }

  return language === 'es'
    ? label.es
    : label.en
}

interface StageProps {
  complete: boolean
  number: string
  title: string
  detail: string
}

function PipelineStage({
  complete,
  number,
  title,
  detail,
}: StageProps) {
  return (
    <article
      className={`pipeline-stage ${
        complete ? 'complete' : 'pending'
      }`}
    >
      <span className="pipeline-number">
        {number}
      </span>

      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </article>
  )
}

interface RegionTableProps {
  regions: RecessedRegionSummary[]
  language: Language
}

function RegionTable({
  regions,
  language,
}: RegionTableProps) {
  const visible = regions.slice(0, 10)

  return (
    <div className="region-table-wrap">
      <table className="region-table">
        <thead>
          <tr>
            <th>#</th>
            <th>
              {t(language, 'Celdas', 'Cells')}
            </th>
            <th>
              {t(
                language,
                'Área proyectada',
                'Projected area',
              )}
            </th>
            <th>
              {t(
                language,
                'Recesión mediana',
                'Median recession',
              )}
            </th>
            <th>
              {t(
                language,
                'Recesión máxima',
                'Maximum recession',
              )}
            </th>
            <th>
              {t(language, 'Puntaje', 'Score')}
            </th>
          </tr>
        </thead>

        <tbody>
          {visible.map((region) => (
            <tr key={region.rank}>
              <td>
                <strong>#{region.rank}</strong>
              </td>

              <td>
                {formatInteger(
                  region.cell_count,
                  language,
                )}
              </td>

              <td>
                {formatNumber(
                  region.area_source_units_squared,
                  4,
                  language,
                )}
              </td>

              <td>
                {formatNumber(
                  region.median_recession_source_units,
                  4,
                  language,
                )}
              </td>

              <td>
                {formatNumber(
                  region.max_recession_source_units,
                  4,
                  language,
                )}
              </td>

              <td>
                {formatNumber(
                  region.recession_score_source_units_cubed,
                  4,
                  language,
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [language, setLanguage] =
    useState<Language>('es')

  const [runs, setRuns] =
    useState<MeasurementRun[]>([])

  const [selectedRunId, setSelectedRunId] =
    useState<string | null>(null)

  const [run, setRun] =
    useState<MeasurementRun | null>(null)

  const [loadingRuns, setLoadingRuns] =
    useState(true)

  const [loadingDetail, setLoadingDetail] =
    useState(false)

  const [error, setError] =
    useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function loadRuns() {
      try {
        const data = await listRuns()

        if (cancelled) {
          return
        }

        setRuns(data)
        setSelectedRunId(
          data[0]?.run_id ?? null,
        )
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : String(reason),
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingRuns(false)
        }
      }
    }

    void loadRuns()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedRunId) {
      return
    }

    let cancelled = false

    async function loadRun() {
      setLoadingDetail(true)
      setError(null)

      try {
        const data = await getRun(
          selectedRunId as string,
        )

        if (!cancelled) {
          setRun(data)
        }
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error
              ? reason.message
              : String(reason),
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false)
        }
      }
    }

    void loadRun()

    return () => {
      cancelled = true
    }
  }, [selectedRunId])

  const pointCloudPreview = useMemo(() => {
    if (!run) {
      return null
    }

    const ply = run.artifacts.find(
      (artifact) =>
        artifact.kind ===
        'timber_stack_point_cloud_preview',
    )

    const manifest = run.artifacts.find(
      (artifact) =>
        artifact.kind ===
        'timber_stack_point_cloud_preview_manifest',
    )

    if (!ply || !manifest) {
      return null
    }

    return {
      ply,
      manifest,
    }
  }, [run])

  const visualArtifacts = useMemo(() => {
    if (!run) {
      return []
    }

    const preferredOrder = [
      'front_profile_plot',
      'front_height_profile_plot',
      'projected_face_raster_plot',
      'front_depth_recession_plot',
    ]

    return run.artifacts
      .filter(
        (artifact) =>
          artifact.media_type?.startsWith(
            'image/',
          ),
      )
      .sort((left, right) => {
        const leftIndex =
          preferredOrder.indexOf(left.kind)

        const rightIndex =
          preferredOrder.indexOf(right.kind)

        return (
          (leftIndex === -1
            ? Number.MAX_SAFE_INTEGER
            : leftIndex) -
          (rightIndex === -1
            ? Number.MAX_SAFE_INTEGER
            : rightIndex)
        )
      })
  }, [run])

  const technicalArtifacts = useMemo(
    () =>
      run?.artifacts.filter(
        (artifact) =>
          !artifact.media_type?.startsWith(
            'image/',
          ),
      ) ?? [],
    [run],
  )

  if (
    loadingRuns ||
    (selectedRunId && loadingDetail)
  ) {
    return (
      <div className="empty-state">
        <h2>
          {t(
            language,
            'Cargando medición…',
            'Loading measurement…',
          )}
        </h2>
      </div>
    )
  }

  const front = run?.front_cross_section
  const raster = run?.projected_face_raster
  const depth = run?.front_depth
  const readiness = run?.readiness

  const rasterTotalCells = raster
    ? raster.raster_rows *
      raster.raster_cols
    : null

  const rasterOccupancy = (
    raster &&
    rasterTotalCells &&
    rasterTotalCells > 0
  )
    ? raster.raw_occupied_cell_count /
      rasterTotalCells
    : null

  const pointsPerOccupiedCell = (
    raster &&
    raster.raw_occupied_cell_count > 0
  )
    ? raster.projected_point_count /
      raster.raw_occupied_cell_count
    : null

  const rasterAreaRecomputed = raster
    ? raster.filled_cell_count *
      raster.cell_size_u *
      raster.cell_size_z
    : null

  const depthTotalCells = depth
    ? depth.raster_rows *
      depth.raster_cols
    : null

  const depthCoverage = (
    depth &&
    depthTotalCells &&
    depthTotalCells > 0
  )
    ? depth.valid_cell_count /
      depthTotalCells
    : null

  const depthRuntime = depth
    ? (depth.front_depth_runtime_seconds ??
        0) +
      (depth.recession_runtime_seconds ??
        0)
    : null

  const nBins = getNumericParameter(
    front?.parameters,
    'n_bins',
  )

  const unitLinear =
    run?.coordinate_metadata?.horizontal_units
      ? run.coordinate_metadata.horizontal_units
      : t(
          language,
          'unidades de origen',
          'source units',
        )

  const unitArea =
    run?.coordinate_metadata?.horizontal_units
      ?.toLowerCase()
      .match(/^met(er|re)$/)
      ? 'm²'
      : t(
          language,
          'unidades² de origen',
          'source-units²',
        )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">
            Campo Digital
          </p>

          <h1>
            {t(
              language,
              'Consola de Análisis LiDAR',
              'LiDAR Analysis Console',
            )}
          </h1>

          <p className="brand-copy">
            {t(
              language,
              'Medición y validación de ruma de madera a partir de nube de puntos.',
              'Timber-stack measurement and validation from point-cloud data.',
            )}
          </p>
        </div>

        <div className="runs-heading">
          <span>
            {t(
              language,
              'Mediciones',
              'Measurement runs',
            )}
          </span>

          <span className="count">
            {runs.length}
          </span>
        </div>

        <div className="run-list">
          {runs.map((item) => (
            <button
              className={`run-item ${
                selectedRunId === item.run_id
                  ? 'selected'
                  : ''
              }`}
              key={item.run_id}
              onClick={() =>
                setSelectedRunId(item.run_id)
              }
              type="button"
            >
              <span
                className={`status-dot status-${item.status}`}
              />

              <span className="run-item-content">
                <strong>{item.run_id}</strong>

                <small>
                  {formatDate(
                    item.completed_at ??
                      item.started_at,
                    language,
                  )}
                </small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="content">
        <div className="language-switch">
          <button
            className={
              language === 'es'
                ? 'active'
                : ''
            }
            onClick={() =>
              setLanguage('es')
            }
            type="button"
          >
            ES
          </button>

          <button
            className={
              language === 'en'
                ? 'active'
                : ''
            }
            onClick={() =>
              setLanguage('en')
            }
            type="button"
          >
            EN
          </button>
        </div>

        {error && (
          <section className="error-banner">
            <strong>
              {t(
                language,
                'Error de API',
                'API error',
              )}
            </strong>

            <span>{error}</span>
          </section>
        )}

        {!run && !error && (
          <section className="empty-state">
            <h2>
              {t(
                language,
                'No hay medición seleccionada',
                'No measurement selected',
              )}
            </h2>
          </section>
        )}

        {run && (
          <>
            <header className="page-header">
              <div>
                <p className="eyebrow">
                  {t(
                    language,
                    'Medición',
                    'Measurement run',
                  )}
                </p>

                <h2>{run.run_id}</h2>

                <p className="subtitle">
                  {t(
                    language,
                    'Completado',
                    'Completed',
                  )}{' '}
                  {formatDate(
                    run.completed_at,
                    language,
                  )}
                </p>
              </div>

              <div className="header-statuses">
                <span
                  className={`status-badge status-${run.status}`}
                >
                  {run.status === 'completed'
                    ? t(language, 'completado', 'completed')
                    : run.status === 'started'
                      ? t(language, 'iniciado', 'started')
                      : t(language, 'fallido', 'failed')}
                </span>

                <span className="readiness-badge">
                  {readinessLabel(
                    readiness?.stage,
                    language,
                  )}
                </span>
              </div>
            </header>

            <section className="hero-summary">
              <div>
                <p className="eyebrow">
                  {t(
                    language,
                    'Resumen técnico',
                    'Technical summary',
                  )}
                </p>

                <h3>
                  {t(
                    language,
                    'Medición automática de la cara frontal',
                    'Automatic front-face measurement',
                  )}
                </h3>

                <p>
                  {t(
                    language,
                    'Todos los valores físicos permanecen en unidades de origen hasta confirmar el CRS y las unidades del LAS.',
                    'All physical values remain in source-coordinate units until LAS CRS and units are confirmed.',
                  )}
                </p>
              </div>
            </section>

            <section className="panel field-reference-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {t(
                      language,
                      'Referencia de terreno',
                      'Field reference',
                    )}
                  </p>

                  <h3>
                    {t(
                      language,
                      'Foto real de la ruma',
                      'Real timber-stack photograph',
                    )}
                  </h3>
                </div>

                <span>
                  {t(language, 'Terreno', 'Field')}
                </span>
              </div>

              <div className="field-reference-grid">
                <a
                  className="field-reference-image"
                  href="/local-demo/field-reference.jpeg"
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src="/local-demo/field-reference.jpeg"
                    alt={t(
                      language,
                      'Fotografía real de la ruma de madera medida con LiDAR',
                      'Real photograph of the timber stack measured with LiDAR',
                    )}
                  />
                </a>

                <div className="field-reference-copy">
                  <p className="eyebrow">
                    {t(
                      language,
                      'Objetivo geométrico',
                      'Geometric target',
                    )}
                  </p>

                  <h4>
                    {t(
                      language,
                      'Medir la cara formada por madera, no el suelo bajo la ruma',
                      'Measure the wood face, not the ground beneath the stack',
                    )}
                  </h4>

                  <p>
                    {t(
                      language,
                      'La fotografía permite contrastar la geometría LiDAR con la condición real en terreno. La base de la ruma es irregular y existen sectores donde se observa suelo o espacios abiertos bajo los trozos.',
                      'The photograph lets us compare LiDAR geometry with actual field conditions. The stack base is irregular and some areas expose ground or open spaces beneath the logs.',
                    )}
                  </p>

                  <div className="interpretation-warning">
                    <strong>
                      {t(
                        language,
                        'Hallazgo importante',
                        'Important finding',
                      )}
                    </strong>

                    <p>
                      {t(
                        language,
                        'Los estimadores actuales representan una cara frontal bruta candidata. Todavía pueden incorporar suelo, cavidades inferiores o espacios que no corresponden a madera. Por eso estos valores no deben interpretarse todavía como área neta de madera.',
                        'The current estimators represent a candidate gross frontal face. They may still include ground, lower cavities, or spaces that are not wood. These values must therefore not yet be interpreted as net wood area.',
                      )}
                    </p>
                  </div>

                  <div className="field-reference-stats">
                    <div>
                      <span>
                        {t(
                          language,
                          'Área por perfil actual',
                          'Current profile area',
                        )}
                      </span>
                      <strong className="compact-value">
                        {formatNumber(
                          front?.trapezoid_area,
                          3,
                          language,
                        )}
                        <span>{unitArea}</span>
                      </strong>
                    </div>

                    <div>
                      <span>
                        {t(
                          language,
                          'Área raster actual',
                          'Current raster area',
                        )}
                      </span>
                      <strong className="compact-value">
                        {formatNumber(
                          raster?.area_source_units_squared,
                          3,
                          language,
                        )}
                        <span>{unitArea}</span>
                      </strong>
                    </div>

                    <div className="field-reference-pending">
                      <span>
                        {t(
                          language,
                          'Área neta de madera',
                          'Net wood-face area',
                        )}
                      </span>
                      <strong>
                        {t(
                          language,
                          'Pendiente',
                          'Pending',
                        )}
                      </strong>
                      <small>
                        {t(
                          language,
                          'requiere excluir suelo y vacíos confirmados',
                          'requires confirmed ground and void exclusion',
                        )}
                      </small>
                    </div>

                    <div>
                      <span>
                        {t(
                          language,
                          'Recesiones detectadas',
                          'Detected recessions',
                        )}
                      </span>
                      <strong className="compact-value">
                        {formatInteger(
                          depth?.candidate_count,
                          language,
                        )}
                        <span>
                          {t(language, 'zonas', 'regions')}
                        </span>
                      </strong>
                      <small>
                        {t(
                          language,
                          'candidatos de revisión',
                          'review candidates',
                        )}
                      </small>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="metric-grid presentation-metrics">
              <article className="metric-card">
                <span>
                  {t(
                    language,
                    'Puntos analizados',
                    'Analyzed points',
                  )}
                </span>

                <strong className="metric-value">
                  {formatInteger(
                    run.timber_stack
                      ?.point_count_selected,
                    language,
                  )}
                  <span className="metric-unit">
                    {t(language, 'puntos', 'points')}
                  </span>
                </strong>

                <small>
                  {formatPercent(
                    run.timber_stack
                      ?.selected_fraction,
                    language,
                  )}{' '}
                  {t(
                    language,
                    'de la entrada',
                    'of input',
                  )}
                </small>
              </article>

              <article className="metric-card">
                <span>
                  {t(
                    language,
                    'Área por perfil',
                    'Profile area',
                  )}
                </span>

                <strong className="metric-value">
                  {formatNumber(
                    front?.trapezoid_area,
                    3,
                    language,
                  )}
                  <span className="metric-unit">
                    {unitArea}
                  </span>
                </strong>

                <small>
                  {t(
                    language,
                    'estimador trapezoidal',
                    'trapezoidal estimator',
                  )}
                </small>
              </article>

              <article className="metric-card">
                <span>
                  {t(
                    language,
                    'Área por raster',
                    'Raster area',
                  )}
                </span>

                <strong className="metric-value">
                  {formatNumber(
                    raster?.area_source_units_squared,
                    3,
                    language,
                  )}
                  <span className="metric-unit">
                    {unitArea}
                  </span>
                </strong>

                <small>
                  {t(
                    language,
                    'estimador raster',
                    'raster estimator',
                  )}
                </small>
              </article>

              <article className="metric-card">
                <span>
                  {t(
                    language,
                    'Diferencia entre métodos',
                    'Estimator disagreement',
                  )}
                </span>

                <strong className="metric-value">
                  {formatNumber(
                    raster?.scanline_disagreement_fraction === null ||
                      raster?.scanline_disagreement_fraction === undefined
                      ? null
                      : raster.scanline_disagreement_fraction * 100,
                    3,
                    language,
                  )}
                  <span className="metric-unit">%</span>
                </strong>

                <small>
                  {t(
                    language,
                    'diferencia relativa simétrica',
                    'symmetric relative difference',
                  )}
                </small>
              </article>

              <article className="metric-card">
                <span>
                  {t(
                    language,
                    'Zonas de recesión',
                    'Recession regions',
                  )}
                </span>

                <strong className="metric-value">
                  {formatInteger(
                    depth?.candidate_count,
                    language,
                  )}
                  <span className="metric-unit">
                    {t(language, 'zonas', 'regions')}
                  </span>
                </strong>

                <small>
                  {t(
                    language,
                    'candidatos automáticos',
                    'automatic candidates',
                  )}
                </small>
              </article>

              <article className="metric-card">
                <span>
                  {t(
                    language,
                    'Largo frontal',
                    'Front span',
                  )}
                </span>

                <strong className="metric-value">
                  {formatNumber(
                    front?.longitudinal_span,
                    3,
                    language,
                  )}
                  <span className="metric-unit">
                    {unitLinear}
                  </span>
                </strong>

                <small>
                  {t(
                    language,
                    'extensión longitudinal',
                    'longitudinal extent',
                  )}
                </small>
              </article>
            </section>

            <section className="panel readiness-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {t(
                      language,
                      'Estado de validación',
                      'Validation status',
                    )}
                  </p>

                  <h3>
                    {readinessLabel(
                      readiness?.stage,
                      language,
                    )}
                  </h3>
                </div>
              </div>

              <div className="readiness-grid">
                <div
                  className={
                    readiness?.pipeline_completed
                      ? 'ready'
                      : 'pending'
                  }
                >
                  <strong>
                    {t(
                      language,
                      'Pipeline',
                      'Pipeline',
                    )}
                  </strong>
                  <span>
                    {readiness?.pipeline_completed
                      ? '✓'
                      : '—'}
                  </span>
                </div>

                <div
                  className={
                    readiness?.observable_geometry_ready
                      ? 'ready'
                      : 'pending'
                  }
                >
                  <strong>
                    {t(
                      language,
                      'Geometría observable',
                      'Observable geometry',
                    )}
                  </strong>
                  <span>
                    {readiness?.observable_geometry_ready
                      ? '✓'
                      : '—'}
                  </span>
                </div>

                <div
                  className={
                    readiness?.physical_face_area_ready
                      ? 'ready'
                      : 'pending'
                  }
                >
                  <strong>
                    {t(
                      language,
                      'Área física',
                      'Physical area',
                    )}
                  </strong>
                  <span>
                    {readiness?.physical_face_area_ready
                      ? '✓'
                      : 'Pend.'}
                  </span>
                </div>

                <div
                  className={
                    readiness?.geometric_volume_ready
                      ? 'ready'
                      : 'pending'
                  }
                >
                  <strong>
                    {t(
                      language,
                      'Volumen',
                      'Volume',
                    )}
                  </strong>
                  <span>
                    {readiness?.geometric_volume_ready
                      ? '✓'
                      : 'Pend.'}
                  </span>
                </div>

                <div
                  className={
                    readiness?.reference_validated
                      ? 'ready'
                      : 'pending'
                  }
                >
                  <strong>
                    {t(
                      language,
                      'Referencia',
                      'Reference',
                    )}
                  </strong>
                  <span>
                    {readiness?.reference_validated
                      ? '✓'
                      : 'Pend.'}
                  </span>
                </div>
              </div>

              {run.warnings.length > 0 && (
                <div className="validation-warnings">
                  {run.warnings.map(
                    (warning) => (
                      <article
                        className={`validation-warning severity-${warning.severity}`}
                        key={`${warning.code}-${warning.message}`}
                      >
                        <div>
                          <strong>
                            {warningLabel(
                              warning,
                              language,
                            )}
                          </strong>

                          <code>
                            {warning.code}
                          </code>
                        </div>

                        <p>
                          {warningMessage(
                            warning,
                            language,
                          )}
                        </p>
                      </article>
                    ),
                  )}
                </div>
              )}
            </section>

            {pointCloudPreview && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      {t(
                        language,
                        'Vista 3D',
                        '3D inspection',
                      )}
                    </p>

                    <h3>
                      {t(
                        language,
                        'Ruma procesada',
                        'Processed timber stack',
                      )}
                    </h3>
                  </div>

                  <span>
                    {formatInteger(
                      run.timber_stack
                        ?.point_count_selected,
                      language,
                    )}{' '}
                    {t(
                      language,
                      'puntos',
                      'points',
                    )}
                  </span>
                </div>

                <p className="muted">
                  {t(
                    language,
                    'Vista interactiva para inspección. Arrastra para rotar, usa la rueda para acercar y botón derecho para desplazar.',
                    'Interactive inspection view. Drag to rotate, use the wheel to zoom and right-drag to pan.',
                  )}
                </p>

                <Suspense
                  fallback={
                    <div className="empty-state">
                      <p>
                        {t(
                          language,
                          'Cargando nube 3D…',
                          'Loading 3D cloud…',
                        )}
                      </p>
                    </div>
                  }
                >
                  <PointCloudPreview
                    runId={run.run_id}
                    plyPath={
                      pointCloudPreview.ply.path
                    }
                    manifestPath={
                      pointCloudPreview.manifest
                        .path
                    }
                    language={language}
                  />
                </Suspense>
              </section>
            )}

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {t(
                      language,
                      'Flujo automático',
                      'Automatic workflow',
                    )}
                  </p>

                  <h3>
                    {t(
                      language,
                      'Desde la nube hasta la validación',
                      'From point cloud to validation',
                    )}
                  </h3>
                </div>
              </div>

              <div className="pipeline-flow">
                <PipelineStage
                  complete
                  number="01"
                  title={t(
                    language,
                    'Entrada LAS',
                    'LAS input',
                  )}
                  detail={`${formatInteger(
                    run.timber_stack
                      ?.point_count_input,
                    language,
                  )} ${t(
                    language,
                    'puntos recibidos',
                    'input points',
                  )}`}
                />

                <PipelineStage
                  complete
                  number="02"
                  title={t(
                    language,
                    run.timber_stack
                      ?.localization_mode ===
                      'prelocalized_input'
                      ? 'Ruma prelocalizada'
                      : 'Localización de ruma',
                    run.timber_stack
                      ?.localization_mode ===
                      'prelocalized_input'
                      ? 'Prelocalized stack'
                      : 'Pile localization',
                  )}
                  detail={t(
                    language,
                    'La medición trabaja sobre la geometría seleccionada.',
                    'Measurement operates on the selected geometry.',
                  )}
                />

                <PipelineStage
                  complete
                  number="03"
                  title={t(
                    language,
                    'Sistema local (u, v, z)',
                    'Local frame (u, v, z)',
                  )}
                  detail={t(
                    language,
                    'La cara se orienta sobre su eje longitudinal y profundidad transversal.',
                    'The face is expressed along longitudinal and transverse depth axes.',
                  )}
                />

                <PipelineStage
                  complete={Boolean(front)}
                  number="04"
                  title={t(
                    language,
                    'Perfil frontal',
                    'Front profile',
                  )}
                  detail={t(
                    language,
                    'Base, borde superior y altura por segmentos.',
                    'Base, upper envelope and segment heights.',
                  )}
                />

                <PipelineStage
                  complete={Boolean(raster)}
                  number="05"
                  title={t(
                    language,
                    'Raster proyectado',
                    'Projected raster',
                  )}
                  detail={t(
                    language,
                    'Ocupación 2D, densidad y componente principal.',
                    '2D occupancy, density and principal component.',
                  )}
                />

                <PipelineStage
                  complete={Boolean(depth)}
                  number="06"
                  title={t(
                    language,
                    'Profundidad frontal',
                    'Front depth',
                  )}
                  detail={t(
                    language,
                    'Se conserva profundidad antes de reducir la medición a 2D.',
                    'Depth is preserved before reducing measurement to 2D.',
                  )}
                />

                <PipelineStage
                  complete={
                    (depth?.candidate_count ?? 0) > 0
                  }
                  number="07"
                  title={t(
                    language,
                    'Detección de recesiones',
                    'Recession detection',
                  )}
                  detail={`${formatInteger(
                    depth?.candidate_count,
                    language,
                  )} ${t(
                    language,
                    'regiones candidatas',
                    'candidate regions',
                  )}`}
                />

                <PipelineStage
                  complete={Boolean(
                    run.face_area_comparison
                      ?.comparison_ready,
                  )}
                  number="08"
                  title={t(
                    language,
                    'Validación de área',
                    'Area validation',
                  )}
                  detail={t(
                    language,
                    'Pendiente de referencia compatible de LiDAR360.',
                    'Awaiting compatible LiDAR360 reference.',
                  )}
                />

                <PipelineStage
                  complete={
                    run.results.length > 0
                  }
                  number="09"
                  title={t(
                    language,
                    'Volumen geométrico',
                    'Geometric volume',
                  )}
                  detail={t(
                    language,
                    'Se habilita solo con largo/profundidad explícito y unidades confirmadas.',
                    'Enabled only with explicit depth/length and confirmed units.',
                  )}
                />
              </div>
            </section>

            {run.results.length > 0 && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      {t(
                        language,
                        'Resultados',
                        'Results',
                      )}
                    </p>

                    <h3>
                      {t(
                        language,
                        'Volumen geométrico',
                        'Geometric volume',
                      )}
                    </h3>
                  </div>

                  <span>{run.results.length}</span>
                </div>

                <div className="metric-grid">
                  {run.results.map((result, index) => (
                    <article
                      className="metric-card"
                      key={`${result.method}-${index}`}
                    >
                      <span>{result.method}</span>

                      <strong className="metric-value">
                        {formatNumber(
                          result.volume,
                          6,
                          language,
                        )}
                        <span className="metric-unit">
                          {result.volume_unit === 'm3'
                            ? 'm³'
                            : t(
                                language,
                                'unidades³ de origen',
                                'cubic source units',
                              )}
                        </span>
                      </strong>

                      {result.parameters.commercial_cubicacion ===
                        false && (
                        <small>
                          {t(
                            language,
                            'Solo geométrico · no es cubicación comercial',
                            'Geometric only · not commercial cubicación',
                          )}
                        </small>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {t(
                      language,
                      'Cálculos',
                      'Calculations',
                    )}
                  </p>

                  <h3>
                    {t(
                      language,
                      'Cómo se obtiene la medición',
                      'How the measurement is calculated',
                    )}
                  </h3>
                </div>
              </div>

              <div className="formula-grid">
                <article className="formula-card">
                  <span className="formula-step">
                    1
                  </span>

                  <h4>
                    {t(
                      language,
                      'Coordenada longitudinal',
                      'Longitudinal coordinate',
                    )}
                  </h4>

                  <code className="formula">
                    uᵢ = (pᵢ,xy − c) · eᵤ
                  </code>

                  <p>
                    {t(
                      language,
                      'Cada punto se expresa respecto del centro de la ruma y se proyecta sobre el eje principal de la cara.',
                      'Each point is expressed relative to the stack centre and projected onto the principal face axis.',
                    )}
                  </p>
                </article>

                <article className="formula-card">
                  <span className="formula-step">
                    2
                  </span>

                  <h4>
                    {t(
                      language,
                      'Altura por segmento',
                      'Height by segment',
                    )}
                  </h4>

                  <code className="formula">
                    hᵢ = max(zsup,ᵢ − zbase,ᵢ, 0)
                  </code>

                  <p>
                    {t(
                      language,
                      'Se construyen envolventes robustas inferior y superior y se calcula la altura observable en cada segmento.',
                      'Robust lower and upper envelopes are constructed and observable height is calculated for every segment.',
                    )}
                  </p>

                  <dl className="mini-stats">
                    <div>
                      <dt>
                        {t(
                          language,
                          'Segmentos',
                          'Bins',
                        )}
                      </dt>
                      <dd>
                        {formatInteger(
                          nBins,
                          language,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Altura mediana',
                          'Median height',
                        )}
                      </dt>
                      <dd>
                        {formatNumber(
                          front?.median_height,
                          3,
                          language,
                        )}{' '}
                        <span className="inline-unit">
                          {unitLinear}
                        </span>
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Altura máxima',
                          'Maximum height',
                        )}
                      </dt>
                      <dd>
                        {formatNumber(
                          front?.maximum_height,
                          3,
                          language,
                        )}{' '}
                        <span className="inline-unit">
                          {unitLinear}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </article>

                <article className="formula-card">
                  <span className="formula-step">
                    3
                  </span>

                  <h4>
                    {t(
                      language,
                      'Área por perfil',
                      'Profile area',
                    )}
                  </h4>

                  <code className="formula">
                    A = Σ hᵢ Δu
                  </code>

                  <code className="formula secondary">
                    Atrap ≈ Σ ((hᵢ+hᵢ₊₁)/2) Δu
                  </code>

                  <dl className="mini-stats">
                    <div>
                      <dt>
                        {t(
                          language,
                          'Regla rectangular',
                          'Rectangle rule',
                        )}
                      </dt>
                      <dd>
                        {formatNumber(
                          front?.rectangle_area,
                          3,
                          language,
                        )}{' '}
                        <span className="inline-unit">
                          {unitArea}
                        </span>
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Regla trapezoidal',
                          'Trapezoid rule',
                        )}
                      </dt>
                      <dd>
                        {formatNumber(
                          front?.trapezoid_area,
                          3,
                          language,
                        )}{' '}
                        <span className="inline-unit">
                          {unitArea}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </article>

                <article className="formula-card">
                  <span className="formula-step">
                    4
                  </span>

                  <h4>
                    {t(
                      language,
                      'Área raster',
                      'Raster area',
                    )}
                  </h4>

                  <code className="formula">
                    Araster = Nrellenas × Δu × Δz
                  </code>

                  <p>
                    {raster
                      ? `${formatInteger(
                          raster.filled_cell_count,
                          language,
                        )} × ${formatNumber(
                          raster.cell_size_u,
                          2,
                          language,
                        )} × ${formatNumber(
                          raster.cell_size_z,
                          2,
                          language,
                        )} = ${formatNumber(
                          rasterAreaRecomputed,
                          3,
                          language,
                        )}`
                      : '—'}
                  </p>

                  <dl className="mini-stats">
                    <div>
                      <dt>
                        {t(
                          language,
                          'Resolución',
                          'Resolution',
                        )}
                      </dt>
                      <dd>
                        {raster
                          ? `${formatNumber(
                              raster.cell_size_u,
                              2,
                              language,
                            )} × ${formatNumber(
                              raster.cell_size_z,
                              2,
                              language,
                            )}`
                          : '—'}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Celdas ocupadas',
                          'Occupied cells',
                        )}
                      </dt>
                      <dd>
                        {formatInteger(
                          raster?.raw_occupied_cell_count,
                          language,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Ocupación de grilla',
                          'Grid occupancy',
                        )}
                      </dt>
                      <dd>
                        {formatPercent(
                          rasterOccupancy,
                          language,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Puntos/celda ocupada',
                          'Points/occupied cell',
                        )}
                      </dt>
                      <dd>
                        {formatNumber(
                          pointsPerOccupiedCell,
                          2,
                          language,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Componentes',
                          'Components',
                        )}
                      </dt>
                      <dd>
                        {formatInteger(
                          raster?.component_count,
                          language,
                        )}
                      </dd>
                    </div>
                  </dl>
                </article>

                <article className="formula-card">
                  <span className="formula-step">
                    5
                  </span>

                  <h4>
                    {t(
                      language,
                      'Diferencia entre estimadores',
                      'Estimator disagreement',
                    )}
                  </h4>

                  <code className="formula fraction-formula">
                    D = |Araster − Aperfil| / ((Araster + Aperfil) / 2)
                  </code>

                  <div className="formula-result">
                    {formatPercent(
                      raster?.scanline_disagreement_fraction,
                      language,
                      3,
                    )}
                  </div>

                  <p>
                    {t(
                      language,
                      'Esta diferencia interna no representa error contra terreno. La referencia LiDAR360 todavía está pendiente.',
                      'This internal disagreement is not ground-truth error. The LiDAR360 reference is still pending.',
                    )}
                  </p>
                </article>

                <article className="formula-card">
                  <span className="formula-step">
                    6
                  </span>

                  <h4>
                    {t(
                      language,
                      'Profundidad y recesiones',
                      'Depth and recessions',
                    )}
                  </h4>

                  <code className="formula">
                    r(u,z) = max(vobservado − vesperado, 0)
                  </code>

                  <p>
                    {t(
                      language,
                      'La profundidad transversal se conserva para detectar geometría que retrocede respecto de la superficie frontal esperada.',
                      'Transverse depth is retained to identify geometry recessed behind the expected front surface.',
                    )}
                  </p>

                  <dl className="mini-stats">
                    <div>
                      <dt>
                        {t(
                          language,
                          'Celdas válidas',
                          'Valid cells',
                        )}
                      </dt>
                      <dd>
                        {formatInteger(
                          depth?.valid_cell_count,
                          language,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Cobertura',
                          'Coverage',
                        )}
                      </dt>
                      <dd>
                        {formatPercent(
                          depthCoverage,
                          language,
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Umbral',
                          'Threshold',
                        )}
                      </dt>
                      <dd>
                        {formatNumber(
                          depth?.recession_threshold_source_units,
                          3,
                          language,
                        )}{' '}
                        <span className="inline-unit">
                          {unitLinear}
                        </span>
                      </dd>
                    </div>

                    <div>
                      <dt>
                        {t(
                          language,
                          'Profundidad + recesión',
                          'Depth + recession runtime',
                        )}
                      </dt>
                      <dd>
                        {depthRuntime === null
                          ? '—'
                          : `${formatNumber(
                              depthRuntime,
                              3,
                              language,
                            )} s`}
                      </dd>
                    </div>
                  </dl>
                </article>
              </div>
            </section>

            {depth && (
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">
                      {t(
                        language,
                        'Análisis de profundidad',
                        'Depth analysis',
                      )}
                    </p>

                    <h3>
                      {t(
                        language,
                        'Regiones de recesión detectadas',
                        'Detected recessed regions',
                      )}
                    </h3>
                  </div>

                  <span>
                    {depth.candidate_count}
                  </span>
                </div>

                <p className="muted">
                  {t(
                    language,
                    'Las regiones se ordenan por un puntaje geométrico basado en recesión y área proyectada. Son candidatos de revisión: todavía no se descuentan automáticamente del área.',
                    'Regions are ranked by a geometric score based on recession and projected area. They are review candidates and are not automatically subtracted from face area.',
                  )}
                </p>

                <RegionTable
                  language={language}
                  regions={depth.regions}
                />

                {depth.regions.length > 10 && (
                  <p className="table-footnote">
                    {t(
                      language,
                      `Mostrando 10 de ${depth.regions.length} candidatos.`,
                      `Showing 10 of ${depth.regions.length} candidates.`,
                    )}
                  </p>
                )}
              </section>
            )}

            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {t(
                      language,
                      'Reporte visual',
                      'Visual report',
                    )}
                  </p>

                  <h3>
                    {t(
                      language,
                      'Evidencia generada automáticamente',
                      'Automatically generated evidence',
                    )}
                  </h3>
                </div>

                <span>
                  {visualArtifacts.length}
                </span>
              </div>

              <div className="presentation-artifacts">
                {visualArtifacts.map(
                  (artifact) => {
                    const url = artifactUrl(
                      run.run_id,
                      artifact.path,
                    )

                    return (
                      <article
                        className="presentation-artifact"
                        key={artifact.path}
                      >
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={url}
                            alt={artifactTitle(
                              artifact,
                              language,
                            )}
                          />
                        </a>

                        <div>
                          <p className="eyebrow">
                            {artifact.kind}
                          </p>

                          <h4>
                            {artifactTitle(
                              artifact,
                              language,
                            )}
                          </h4>

                          <p>
                            {artifactDescription(
                              artifact,
                              language,
                            )}
                          </p>

                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t(
                              language,
                              'Abrir imagen completa',
                              'Open full image',
                            )}
                          </a>
                        </div>
                      </article>
                    )
                  },
                )}
              </div>
            </section>

            <section className="panel meeting-questions">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {t(
                      language,
                      'Validación con cliente',
                      'Client validation',
                    )}
                  </p>

                  <h3>
                    {t(
                      language,
                      'Preguntas para cerrar la definición de medición',
                      'Questions required to finalize measurement definition',
                    )}
                  </h3>
                </div>

                <span>9</span>
              </div>

              <p className="muted">
                {t(
                  language,
                  'Estas respuestas permiten pasar de una geometría experimental reproducible a una definición operacional de área y volumen.',
                  'These answers are required to move from reproducible experimental geometry to an operational definition of area and volume.',
                )}
              </p>

              <div className="question-list">
                {[
                  t(
                    language,
                    '¿El LAS del GS100G está expresado en metros? ¿Cuál es el CRS o EPSG del proyecto?',
                    'Is the GS100G LAS expressed in metres? What CRS or EPSG is used?',
                  ),
                  t(
                    language,
                    '¿Qué área entrega LiDAR360 para exactamente esta misma ruma?',
                    'What area does LiDAR360 return for exactly this same timber stack?',
                  ),
                  t(
                    language,
                    '¿Se puede exportar o compartir el polígono exacto que se dibuja en LiDAR360?',
                    'Can the exact polygon drawn in LiDAR360 be exported or shared?',
                  ),
                  t(
                    language,
                    'En el borde inferior, ¿el área debe seguir los trozos de madera y excluir completamente el suelo visible bajo la ruma?',
                    'At the lower boundary, should the area follow the timber logs and completely exclude visible ground beneath the stack?',
                  ),
                  t(
                    language,
                    '¿Los espacios pequeños normales entre trozos de madera permanecen incluidos en el área de la ruma?',
                    'Do normal small gaps between individual logs remain included in the stack area?',
                  ),
                  t(
                    language,
                    '¿Qué espacios grandes se descuentan: por tamaño, profundidad, conexión con el suelo/fondo, o por criterio visual del operador?',
                    'Which large voids are excluded: by size, depth, connection to the ground/background, or operator visual judgement?',
                  ),
                  t(
                    language,
                    '¿Los 6 m corresponden al largo real medido del producto o a un largo nominal?',
                    'Does the 6 m value represent the measured product length or a nominal length?',
                  ),
                  t(
                    language,
                    '¿El volumen final es simplemente área neta × 6 m, o después aplican algún factor de conversión para volumen sólido?',
                    'Is final volume simply net face area × 6 m, or is another conversion factor applied for solid-wood volume?',
                  ),
                  t(
                    language,
                    '¿Cuánto demora hoy el proceso completo y qué error porcentual sería aceptable para usar esta medición operacionalmente?',
                    'How long does the current full process take, and what percentage error would be acceptable for operational use?',
                  ),
                ].map((question, index) => (
                  <label
                    className="meeting-question"
                    key={question}
                  >
                    <input type="checkbox" />

                    <span className="question-number">
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    <span>{question}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="panel validation-reference">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {t(
                      language,
                      'Referencia',
                      'Reference',
                    )}
                  </p>

                  <h3>
                    LiDAR360
                  </h3>
                </div>
              </div>

              {run.face_area_comparison ? (
                <div className="reference-grid">
                  <div>
                    <span>
                      {t(
                        language,
                        'Estimación',
                        'Estimate',
                      )}
                    </span>
                    <strong>
                      {formatNumber(
                        run.face_area_comparison
                          .estimate_value,
                        3,
                        language,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      {t(
                        language,
                        'Referencia',
                        'Reference',
                      )}
                    </span>
                    <strong>
                      {formatNumber(
                        run.face_area_comparison
                          .reference.value,
                        3,
                        language,
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>
                      {t(
                        language,
                        'Error absoluto %',
                        'Absolute % error',
                      )}
                    </span>
                    <strong>
                      {run.face_area_comparison
                        .absolute_percent_error ===
                      null
                        ? '—'
                        : `${formatNumber(
                            run
                              .face_area_comparison
                              .absolute_percent_error,
                            2,
                            language,
                          )}%`}
                    </strong>
                  </div>
                </div>
              ) : (
                <div className="reference-pending">
                  <strong>
                    {t(
                      language,
                      'Referencia de esta misma ruma pendiente',
                      'Same-pile reference pending',
                    )}
                  </strong>

                  <p>
                    {t(
                      language,
                      'El siguiente paso es ingresar el área o polígono obtenido en LiDAR360 con unidades compatibles para medir el error real.',
                      'The next step is to provide the LiDAR360 area or polygon with compatible units so real error can be measured.',
                    )}
                  </p>
                </div>
              )}
            </section>

            <details className="technical-details">
              <summary>
                {t(
                  language,
                  'Archivos técnicos y procedencia',
                  'Technical files and provenance',
                )}
              </summary>

              <div className="technical-body">
                <div className="two-column">
                  <section>
                    <h4>
                      {t(
                        language,
                        'Procedencia',
                        'Provenance',
                      )}
                    </h4>

                    <dl className="detail-list">
                      <div>
                        <dt>Schema</dt>
                        <dd>
                          {run.schema_version}
                        </dd>
                      </div>

                      <div>
                        <dt>
                          {t(
                            language,
                            'Versión de código',
                            'Code version',
                          )}
                        </dt>
                        <dd>
                          {run.code_version ??
                            '—'}
                        </dd>
                      </div>

                      <div>
                        <dt>
                          {t(
                            language,
                            'Modo de localización',
                            'Localization mode',
                          )}
                        </dt>
                        <dd>
                          {run.timber_stack
                            ?.localization_mode ??
                            '—'}
                        </dd>
                      </div>

                      <div>
                        <dt>SHA-256</dt>
                        <dd className="mono">
                          {run.source_sha256
                            ? `${run.source_sha256.slice(
                                0,
                                20,
                              )}…`
                            : '—'}
                        </dd>
                      </div>

                      <div>
                        <dt>CRS / EPSG</dt>
                        <dd>
                          {run
                            .coordinate_metadata
                            ?.crs_epsg ??
                            '—'}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  <section>
                    <h4>
                      {t(
                        language,
                        'Archivos registrados',
                        'Registered files',
                      )}
                    </h4>

                    <div className="technical-file-list">
                      {technicalArtifacts.map(
                        (artifact) => (
                          <a
                            href={artifactUrl(
                              run.run_id,
                              artifact.path,
                            )}
                            key={artifact.path}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span>
                              {artifact.kind}
                            </span>

                            <code>
                              {artifact.path}
                            </code>
                          </a>
                        ),
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </details>
          </>
        )}
      </main>
    </div>
  )
}

export default App
