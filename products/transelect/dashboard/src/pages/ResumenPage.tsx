/**
 * `/transelec` — the operational command centre.
 *
 * The page answers four questions in this order, and the visual weight
 * follows that order rather than the order the source workbook happened to
 * produce numbers in:
 *
 *   1. Where does the programme stand?        lead figure + composition bars
 *   2. What needs attention?                  attention row
 *   3. How big is the thing being measured?   scale strip (quiet)
 *   4. What do I do next?                     work queue, then the Explorador
 *
 * Every value comes from `GET /transelec/summary` and `GET /transelec/pending`
 * under the current filter state, which is read from the URL. Nothing here
 * recomputes a business number, and the two disagreeing legacy rules behind
 * these figures are named on screen rather than reconciled.
 *
 * The two reads are issued together and committed in one update (see
 * `useReads`), so the lead figure, the bars and the queue can never describe
 * two different filter states.
 */
import { useCallback } from 'react'
import {
  type TranselecActiveImport,
  type TranselecPending,
  type TranselecSummary,
  getPending,
  getSummary,
} from '../api'
import { AlertBanner, LoadingBlock, StateBlock } from '../components/StateViews'
import { cell, formatDateTime, formatInteger, formatNumber } from '../format'
import { activeFilterChips, withoutChip } from '../lib/filterUrl'
import { PENDING_STAGE_LABELS } from '../lib/pendingStage'
import {
  approvalSegments,
  buildAttentionItems,
  buildScaleStats,
  estadoResumidoSegments,
} from '../lib/summaryView'
import { useReads, type FilterController } from '../lib/useFilters'
import { Link, ROUTES } from '../router'
import { CompositionBar, leadPercentage } from '../ui/CompositionBar'
import { Chip, Figure, SectionHeader, StatStrip } from '../ui/Primitives'

const QUEUE_LIMIT = 6

interface ResumenData {
  summary: TranselecSummary
  pending: TranselecPending
}

export function ResumenPage({
  activeImport,
  canPublish,
  filterController,
}: {
  activeImport: TranselecActiveImport | null
  canPublish: boolean
  filterController: FilterController
}) {
  const { filters, replaceFilters } = filterController
  const key = JSON.stringify(filters)

  const { data, loading, failure } = useReads<ResumenData>(
    useCallback(async () => {
      const [summary, pending] = await Promise.all([getSummary(filters), getPending(filters)])
      if (!summary.ok) return summary
      if (!pending.ok) return pending
      return { ok: true, data: { summary: summary.data, pending: pending.data } }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
    [key],
  )

  const chips = activeFilterChips(filters)

  if (failure && !data) {
    return (
      <div className="page">
        <StateBlock view={failure}>
          {failure.kind === 'empty' && canPublish && (
            <Link to={ROUTES.datos} className="btn">
              Importar planilla
            </Link>
          )}
        </StateBlock>
      </div>
    )
  }

  return (
    <div className="page enter">
      <div className="context-strip">
        <span className="client">Transmisora del Pacífico – Transelec</span>
        <span className="sep">/</span>
        <span>Seguimiento de Planes de Manejo Forestal · ingresos CONAF</span>
        {activeImport && (
          <>
            <span className="sep">/</span>
            <span>
              Versión #{activeImport.import_id}, publicada{' '}
              {formatDateTime(activeImport.published_at)}
              {activeImport.published_by_display_name
                ? ` por ${activeImport.published_by_display_name}`
                : ''}
            </span>
          </>
        )}
      </div>

      {chips.length > 0 && (
        <div className="active-filters" style={{ paddingTop: 'var(--s-5)' }}>
          <span className="eyebrow">Alcance filtrado</span>
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              onRemove={() => replaceFilters(withoutChip(filters, chip))}
              removeLabel={`Quitar el filtro ${chip.label}: ${chip.value}`}
            >
              {chip.label}: {chip.value}
            </Chip>
          ))}
        </div>
      )}

      {failure && data && <AlertBanner title={failure.title}>{failure.message}</AlertBanner>}

      {!data && loading && (
        <div className="stack" style={{ paddingTop: 'var(--s-7)' }}>
          <LoadingBlock label="Cargando el alcance seleccionado…" shape="bar" />
          <LoadingBlock label="" shape="rows" lines={4} />
        </div>
      )}

      {data && (
        <>
          <section className="lead-block" aria-labelledby="estado-title">
            <div className="lead-figure">
              <Figure
                lead
                testId="lead-approval"
                value={formatNumber(leadPercentage(approvalSegments(data.summary.avance_por_pmf)))}
                unit="%"
                label="de los PMF aprobados"
                note={`${formatInteger(data.summary.avance_por_pmf.aprobado)} de ${formatInteger(
                  data.summary.pmf_count,
                )} planes de manejo del alcance seleccionado`}
              />
              <span className="basis-tag">{data.summary.basis_estado_resumido}</span>
            </div>

            <div className="compositions">
              <h2 id="estado-title" className="eyebrow">
                Avance de aprobación
              </h2>
              <CompositionBar
                title="Por planes de manejo (PMF)"
                noun="PMF aprobados"
                testId="composition-pmf"
                segments={approvalSegments(data.summary.avance_por_pmf)}
              />
              <CompositionBar
                title="Por predios"
                noun="predios aprobados"
                testId="composition-predios"
                segments={approvalSegments(data.summary.avance_por_predio)}
              />
            </div>
          </section>

          <section className="ruled" aria-labelledby="atencion-title" data-testid="attention-row">
            <SectionHeader
              id="atencion-title"
              title="Requiere atención"
              meta="Cada tarjeta lleva a la sección que resuelve el caso."
            />
            <div className="attention">
              {buildAttentionItems(data.summary, {
                pendientes: ROUTES.pendientes,
                calidad: ROUTES.calidad,
              }).map((item) => (
                <Link
                  key={item.id}
                  to={item.href}
                  className="attention-card"
                  data-attention={item.id}
                >
                  <span className="attention-value" data-testid={`kpi-${item.id}`}>
                    {formatInteger(item.value)}
                  </span>
                  <span className="attention-label">{item.label}</span>
                  <span className="attention-sub">{item.sub}</span>
                  <span className="attention-go">{item.action} →</span>
                </Link>
              ))}
            </div>
            <p className="hint" style={{ marginTop: 'var(--s-4)' }}>
              «Pendientes prioritarios» aplica{' '}
              <span className="basis-tag">{data.summary.basis_pending_priority}</span>, una regla
              distinta de la que produce «Aprobado» y «En trámite» (
              <span className="basis-tag">{data.summary.basis_estado_resumido}</span>): puede
              clasificar el mismo PMF de otra forma, y las dos cifras no son subconjuntos una de la
              otra.
            </p>
          </section>

          <section className="ruled" aria-labelledby="alcance-title" data-testid="kpi-row">
            <SectionHeader
              id="alcance-title"
              title="Alcance medido"
              meta="Conteos de referencia del alcance seleccionado."
            />
            <StatStrip items={buildScaleStats(data.summary)} />
          </section>

          <section className="ruled" aria-labelledby="estado-predio-title">
            <SectionHeader
              id="estado-predio-title"
              title="Estado resumido por predio"
              basis={data.summary.basis_estado_resumido}
              meta={`${formatInteger(data.summary.predio_count)} predios únicos`}
            />
            <CompositionBar
              title="Predios únicos del alcance seleccionado"
              noun="predios aprobados"
              testId="status-hero"
              segments={estadoResumidoSegments(data.summary)}
            />
          </section>

          <section className="ruled" aria-labelledby="cola-title" data-testid="work-queue">
            <SectionHeader
              id="cola-title"
              title="Cola de trabajo"
              basis={data.pending.basis}
              meta={
                <>
                  {formatInteger(data.pending.pending_pmf_count)} de{' '}
                  {formatInteger(data.pending.total_pmf_count)} PMF ·{' '}
                  {formatNumber(data.pending.pending_pmf_percentage)}%
                </>
              }
            />
            {data.pending.rows.length === 0 ? (
              <div className="queue">
                <p className="empty">
                  No hay PMF pendientes prioritarios para el alcance seleccionado.
                </p>
              </div>
            ) : (
              <div className="queue">
                {data.pending.rows.slice(0, QUEUE_LIMIT).map((row) => (
                  <div className="queue-row" key={row.source_row_number}>
                    <span className="queue-pmf">{row.pmf}</span>
                    <span className="queue-where">
                      {cell(row.predio_ref, 'Sin predio de reforestación informado')}
                      {row.rol ? ` · rol ${row.rol}` : ''}
                    </span>
                    <span className="queue-stage">{PENDING_STAGE_LABELS[row.pending_stage]}</span>
                    <span className="queue-stage">
                      {cell(row.numero_ingreso, 'Sin ingreso')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="btns no-print" style={{ marginTop: 'var(--s-4)' }}>
              <Link to={ROUTES.pendientes} className="btn">
                Ver todos los pendientes
              </Link>
              <Link to={ROUTES.explorador} className="btn alt">
                Abrir el explorador
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
