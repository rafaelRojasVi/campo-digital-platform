/**
 * `/transelec/estado` — where each plan (PMF) stands in CONAF's process, and
 * how much of CONAF's 90-business-day term is left.
 *
 * Replaces «Pendientes» (meeting of 2026-10-02; specs
 * docs/superpowers/specs/2026-10-04-transelec-estado-lifecycle-design.md and
 * docs/superpowers/specs/2026-10-04-transelec-plazo-90-habiles-design.md).
 * `GET /transelec/lifecycle` gives each PMF's group and step
 * (`lifecycle_pmf_v1`); `GET /transelec/plazos` gives its term
 * (`plazo_conaf_90_habiles_v1`), joined to the table by PMF through
 * `EstadoTable`'s `extraColumns`. Both follow the current filter state.
 *
 * TR-FUNC-031 («¿Qué ingresos superaron 90 días?») is answered by the server
 * now: business days in Chile's calendar from the most recent ingreso, with
 * «today» the server's date in Chile. The browser-only panel that compared
 * the planilla's «90 dias» with the response's `Date` header is gone; its
 * rule is kept by the API as `vencimiento_columna_90_dias_legacy` and its
 * count is shown beside the new one. The old «Pendientes prioritarios» rule
 * stays, closed, in `LegacyPendingSection`.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  type LifecycleRow,
  type ResumenRow,
  type TranselecLifecycle,
  type ConafSolicitud,
  type TranselecPlazos,
  getConafSolicitudes,
  getLifecycle,
  getPlazos,
} from '../api'
import { EstadoTable } from '../components/EstadoTable'
import { PlazoFailureBanner } from '../components/PlazoFailureBanner'
import { LegacyPendingSection } from '../components/LegacyPendingSection'
import { RowDetailDrawer } from '../components/RowDetailDrawer'
import { AlertBanner, LoadingBlock, StateBlock } from '../components/StateViews'
import { formatDate, formatInteger } from '../format'
import { activeFilterChips } from '../lib/filterUrl'
import { lifecycleGroupSegments, lifecycleStepSegments } from '../lib/lifecycle'
import { indexPlazos, plazoDetail } from '../lib/plazo'
import { plazoColumn } from '../lib/plazoColumn'
import { conafColumn, conafNumero } from '../lib/conafColumn'
import { CONAF_ESTADO_ENABLED } from '../lib/conafFlag'
import { normalizeSolicitud } from '../lib/conafEstado'
import { useReads, type FilterController } from '../lib/useFilters'
import { PENDING_QUEUE_HASH, useRouter } from '../router'
import { CompositionBar } from '../ui/CompositionBar'
import { HowCalculated } from '../ui/HowCalculated'
import { Chip, SectionHeader } from '../ui/Primitives'

/** Case- and accent-insensitive text for the table search. */
function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function EstadoPage({
  filterController,
  sourceFields = null,
  activeImportId = null,
  canEdit = false,
}: {
  filterController: FilterController
  /** Contract fields the published workbook had, for the detail drawer. */
  sourceFields?: readonly string[] | null
  activeImportId?: number | null
  /** Operator/admin: the drawer offers web edits. */
  canEdit?: boolean
}) {
  const { filters, reset } = filterController
  const { hash } = useRouter()
  const key = JSON.stringify(filters)

  const { data, loading, failure, reload } = useReads<TranselecLifecycle>(
    useCallback(
      () => getLifecycle(filters),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [key],
    ),
    [key],
  )

  // A separate read: the lifecycle table stands on its own if the plazo
  // calculation fails, with a dash in its column and one banner.
  const plazos = useReads<TranselecPlazos>(
    useCallback(
      () => getPlazos(filters),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [key],
    ),
    [key],
  )
  const plazoIndex = useMemo(() => indexPlazos(plazos.data), [plazos.data])

  // Stored CONAF results for the rows on screen (never calls CONAF); a
  // failed read leaves the column at «Sin consultar».
  const conafNumeros = useMemo(
    () =>
      (CONAF_ESTADO_ENABLED ? (data?.rows ?? []) : [])
        .map((row) => normalizeSolicitud(conafNumero(row)))
        .filter((numero): numero is string => numero !== null),
    [data],
  )
  const conafKey = conafNumeros.join(',')
  const conaf = useReads<ConafSolicitud[]>(
    useCallback(
      () =>
        conafNumeros.length === 0
          ? Promise.resolve({ ok: true as const, data: [] as ConafSolicitud[] })
          : getConafSolicitudes(conafNumeros),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [conafKey],
    ),
    [conafKey],
  )
  const conafIndex = useMemo(
    () => new Map((conaf.data ?? []).map((record) => [record.numero, record])),
    [conaf.data],
  )

  const [openRow, setOpenRow] = useState<ResumenRow | null>(null)
  const [soloVencidos, setSoloVencidos] = useState(false)
  // Narrowing the table on this page only: a group or a step from the bars,
  // and a search by PMF or N.º de ingreso. The shared filters stay as they are.
  const [grupo, setGrupo] = useState<string | null>(null)
  const [paso, setPaso] = useState<string | null>(null)
  const [buscar, setBuscar] = useState('')

  // Without a plazo read there is nothing to filter by: leave the view, so the
  // table never shows every PMF under a stuck «Ver todos los PMF».
  if (plazos.failure && soloVencidos) setSoloVencidos(false)

  const chips = activeFilterChips(filters)
  const openLifecycle: LifecycleRow | null =
    openRow && data ? (data.rows.find((entry) => entry.pmf === openRow.pmf) ?? null) : null
  const vencidos =
    data && soloVencidos && plazos.data
      ? data.rows.filter((row) => plazoIndex.get(row.pmf)?.estado === 'vencido')
      : (data?.rows ?? [])
  const query = foldText(buscar)
  const rows = vencidos.filter(
    (row) =>
      (grupo === null || row.lifecycle_group === grupo) &&
      (paso === null || row.lifecycle_step === paso) &&
      (query === '' ||
        [row.pmf, row.numero_ingreso, row.numero_ingreso_2].some(
          (value) => value !== null && foldText(value).includes(query),
        )),
  )
  const narrowed = grupo !== null || paso !== null || query !== ''
  const grupoLabel =
    data && grupo !== null ? segmentLabel(lifecycleGroupSegments(data), grupo) : null
  const pasoLabel = data && paso !== null ? segmentLabel(lifecycleStepSegments(data), paso) : null
  const sinContar = plazos.data
    ? plazos.data.estados.sin_fecha_texto + plazos.data.estados.conflicto
    : 0
  const openPlazo = openRow ? plazoDetail(plazos.data, openRow.pmf) : null
  const plazoStatus = plazos.failure
    ? 'error'
    : plazos.loading && !plazos.data
      ? 'loading'
      : 'empty'

  if (failure && !data) {
    return (
      <div className="page">
        <StateBlock view={failure} />
      </div>
    )
  }

  return (
    <div className="page enter">
      <SectionHeader
        title={
          <>
            Estado <span className="hint">(provisional)</span>
          </>
        }
        meta="Dónde está cada PMF en la tramitación CONAF y cuánto le queda de plazo."
        helpLabel="Estado"
        help={
          <>
            El grupo sale del «Estado resumido» de la primera fila de cada PMF; el paso, de su
            «Estado». «Rechazado» es un paso dentro de «En trámite»: todo rechazo termina en
            «Aprobado», «Descartado» o «Desistido». Lo que esta regla no reconoce queda «Sin
            clasificar» y se lista en Calidad. El plazo CONAF cuenta 90 días hábiles desde el
            ingreso más reciente. Categorías y plazo provisionales hasta que Campo Digital los
            confirme.
          </>
        }
      />


      {failure && data && <AlertBanner title={failure.title}>{failure.message}</AlertBanner>}
      {plazos.failure && (
        <div style={{ marginBottom: 'var(--s-5)' }}>
          <PlazoFailureBanner
            failure={plazos.failure}
            rawFailure={plazos.rawFailure}
            loading={plazos.loading}
            onRetry={plazos.reload}
            scope="El servidor no pudo contar los días hábiles. La columna «Plazo CONAF» y la pregunta de vencidos no están disponibles; el resto de la página sí."
          />
        </div>
      )}

      {!data && loading && <LoadingBlock label="Cargando el estado de los PMF…" shape="bar" />}

      {data && (
        <section id="estadozone" data-testid="estado-zone">
          <div className="pending-lead">
            <CompositionBar
              title="PMF por grupo"
              noun="PMF"
              testId="estado-group"
              segments={lifecycleGroupSegments(data)}
              selectedKey={grupo}
              onSelect={(key) => {
                setGrupo(key)
                setPaso(null)
              }}
            />
            <CompositionBar
              title="En trámite, por paso"
              noun="PMF en trámite"
              testId="estado-step"
              lead={false}
              segments={lifecycleStepSegments(data)}
              selectedKey={paso}
              onSelect={(key) => {
                setPaso(key)
                setGrupo(null)
              }}
            />
          </div>

          <HowCalculated
            bases={[
              data.basis,
              ...(plazos.data ? [plazos.data.basis, plazos.data.legacy_basis] : []),
            ]}
            testId="estado-how"
          />

          <div className="btns no-print" style={{ margin: 'var(--s-5) 0' }}>
            {chips.length > 0 && (
              <button
                type="button"
                className="btn alt"
                onClick={reset}
                data-testid="clear-estado-filters"
              >
                Quitar filtros y ver todos los PMF
              </button>
            )}
            <button
              type="button"
              className={soloVencidos ? 'btn' : 'btn alt'}
              disabled={!plazos.data}
              onClick={() => setSoloVencidos((value) => !value)}
              data-quick="overdue"
            >
              {soloVencidos ? 'Ver todos los PMF' : '¿Qué PMF superaron los 90 días hábiles?'}
            </button>
          </div>

          <div role="status">
            {soloVencidos && plazos.data && (
              <p
                className="hint"
                data-testid="plazo-vencidos-note"
                style={{ marginBottom: 'var(--s-5)' }}
              >
                <b data-testid="plazo-vencidos-count">
                  {formatInteger(plazos.data.estados.vencido)}
                </b>{' '}
                PMF con el plazo CONAF vencido al <b>{formatDate(plazos.data.observed_on)}</b>, la
                fecha del servidor en Chile, no una fecha fija. Con la regla anterior (fecha «90
                dias» de la planilla anterior a hoy, sin «Aprobado») serían{' '}
                <b data-testid="plazo-legacy-count">
                  {formatInteger(plazos.data.legacy_vencido_row_count)}
                </b>{' '}
                áreas de corta.
                {sinContar > 0 && (
                  <>
                    {' '}
                    Sin contar <b>{formatInteger(sinContar)}</b> PMF cuya fecha de ingreso no se
                    pudo leer o difiere entre filas.
                  </>
                )}
              </p>
            )}
          </div>

          <section className="ruled" aria-labelledby="estado-rows-title">
            <SectionHeader
              id="estado-rows-title"
              title={soloVencidos ? 'PMF con el plazo CONAF vencido' : 'PMF del alcance'}
              meta={
                soloVencidos && plazos.data
                  ? `${formatInteger(rows.length)} de ${formatInteger(data.rows.length)} PMF · vencidos al ${formatDate(plazos.data.observed_on)}`
                  : narrowed
                    ? `${formatInteger(rows.length)} de ${formatInteger(data.rows.length)} PMF · seleccione uno para ver su detalle`
                    : `${formatInteger(rows.length)} PMF · seleccione uno para ver su detalle`
              }
            />
            <div className="estado-search no-print">
              <label className="estado-search-field">
                <span>Buscar PMF o N.º de ingreso</span>
                <input
                  type="search"
                  value={buscar}
                  placeholder="Ej.: BN041 o 170/341"
                  onChange={(event) => setBuscar(event.target.value)}
                />
              </label>
              {/* What the bars narrowed, on this page only, said next to the
                  table it narrows and removable from there. */}
              {(grupo !== null || paso !== null) && (
                <span className="active-filters">
                  <span className="eyebrow">Mostrando solo</span>
                  {grupoLabel !== null && (
                    <Chip
                      onRemove={() => setGrupo(null)}
                      removeLabel={`Dejar de mostrar solo ${grupoLabel}`}
                    >
                      {grupoLabel}
                    </Chip>
                  )}
                  {pasoLabel !== null && (
                    <Chip
                      onRemove={() => setPaso(null)}
                      removeLabel={`Dejar de mostrar solo ${pasoLabel}`}
                    >
                      {pasoLabel}
                    </Chip>
                  )}
                </span>
              )}
              {narrowed && (
                <button
                  type="button"
                  className="btn alt"
                  onClick={() => {
                    setGrupo(null)
                    setPaso(null)
                    setBuscar('')
                  }}
                >
                  Ver todos
                </button>
              )}
            </div>
            <EstadoTable
              rows={rows}
              selectedRow={openRow?.source_row_number ?? null}
              onOpen={setOpenRow}
              extraColumns={[
                plazoColumn(plazoIndex, plazos.loading),
                ...(CONAF_ESTADO_ENABLED ? [conafColumn(conafIndex)] : []),
              ]}
              emptyText={
                narrowed
                  ? 'Ningún PMF coincide con la búsqueda o el grupo elegido.'
                  : soloVencidos
                    ? 'Ningún PMF del alcance superó el plazo.'
                    : undefined
              }
            />
          </section>

          <section className="ruled">
            <LegacyPendingSection
              filters={filters}
              reveal={hash === PENDING_QUEUE_HASH}
              selectedRow={openRow?.source_row_number ?? null}
              onOpenRow={setOpenRow}
            />
          </section>
        </section>
      )}

      {openRow && (
        <RowDetailDrawer
          row={openRow}
          lifecycle={openLifecycle}
          plazo={openPlazo}
          plazoStatus={plazoStatus}
          onClose={() => setOpenRow(null)}
          sourceFields={sourceFields}
          canEdit={canEdit}
          activeImportId={activeImportId}
          // An edit can move the PMF to another group or change its term.
          onRowEdited={() => {
            reload()
            plazos.reload()
          }}
        />
      )}
    </div>
  )
}

/** A bar segment's label by key, for the «Mostrando solo» chip. */
function segmentLabel(segments: readonly { key: string; label: string }[], key: string): string {
  return segments.find((segment) => segment.key === key)?.label ?? key
}
