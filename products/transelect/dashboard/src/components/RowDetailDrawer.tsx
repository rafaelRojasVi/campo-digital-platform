/**
 * One PMF's detail, in a side panel.
 *
 * The shipped interface could show a row only as a row: thirteen cells in a
 * horizontally scrolling table, with no way to see the rest of the contract
 * fields or the other áreas de corta that belong to the same PMF. This panel
 * makes the connection between PMF, predio, rol and source row explicit,
 * using `GET /transelec/pmfs/{pmf}`.
 *
 * Reading order (dashboard UI pass): what an operator opens a PMF for comes
 * first — its tramitación (estado, motivo, ingreso, plazos, empresa) and its
 * AEF tracking — then every row of the PMF with the selected one marked, then
 * the full field list of the selected área de corta. The source row stays in
 * the fixed header the whole time, so provenance never scrolls away. Two
 * columns of short facts replace one long label/value column, which roughly
 * halves the panel's length.
 *
 * Choosing another row of the same PMF re-targets the panel to that row,
 * without another request and without closing it.
 *
 * The AEF section is row-level on purpose. The workbook records AEF, the
 * requester and the three dates per área de corta, and most PMFs that have
 * one AEF row also have rows without one; so a blank here says "this row has
 * no value", the rows table shows which rows do, and nothing is borrowed
 * across rows. When the published workbook had no AEF columns at all, the
 * panel says that instead of implying every row is blank.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  type ResumenRow,
  type TranselecPmfDetail,
  getPmfDetail,
} from '../api'
import { cell, formatInteger, formatNumber } from '../format'
import { aefInSource, chronologyFlagsOf, chronologyLabel, hasAefTracking } from '../lib/aef'
import { classifyFailure, type FailureView } from '../lib/apiState'
import { Drawer } from '../ui/Drawer'
import { AlertBanner, LoadingBlock } from './StateViews'
import { SourceDate } from './SourceDate'
import { StatusPill } from './StatusPill'

function Fact({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`fact${wide ? ' wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function AefSection({
  row,
  detail,
  sourceHasAef,
}: {
  row: ResumenRow
  detail: TranselecPmfDetail | null
  sourceHasAef: boolean | null
}) {
  if (sourceHasAef === false) {
    return (
      <section className="drawer-section" data-testid="drawer-aef">
        <h3>Seguimiento AEF</h3>
        <p className="hint">
          La planilla publicada no incluye las columnas de seguimiento AEF, por lo que no hay
          información AEF para ninguna fila de esta versión.
        </p>
      </section>
    )
  }

  const tracked = detail?.rows.filter(hasAefTracking) ?? []
  const rowTracked = hasAefTracking(row)
  const missing = 'Sin registro en esta fila'

  return (
    <section className="drawer-section" data-testid="drawer-aef">
      <h3>Seguimiento AEF</h3>
      {chronologyFlagsOf(row).length > 0 && (
        <AlertBanner tone="warn" title="Fechas a revisar en la planilla">
          {chronologyFlagsOf(row).map(chronologyLabel).join('; ')}. Se muestran tal como vienen en
          la fila {formatInteger(row.source_row_number)}; no se corrigen.
        </AlertBanner>
      )}
      <dl className="facts">
        <Fact label="AEF">{cell(row.aef, missing)}</Fact>
        <Fact label="Quién solicita">{cell(row.quien_solicita, missing)}</Fact>
        <Fact label="Fecha solicitud">
          <SourceDate row={row} field="fecha_solicitud" missing={missing} />
        </Fact>
        <Fact label="Fecha corta">
          <SourceDate row={row} field="fecha_corta" missing={missing} />
        </Fact>
        <Fact label="Fecha término">
          <SourceDate row={row} field="fecha_termino" missing={missing} />
        </Fact>
      </dl>
      {detail && (
        <p className="hint" data-testid="drawer-aef-coverage">
          {formatInteger(tracked.length)} de {formatInteger(detail.row_count)} filas de{' '}
          {detail.pmf} tienen registro AEF.
          {!rowTracked &&
            tracked.length > 0 &&
            ` El seguimiento de este PMF está en ${tracked.length === 1 ? 'la fila' : 'las filas'} ${tracked
              .map((entry) => entry.source_row_number)
              .join(', ')}; esta fila no lo repite y se muestra vacía, como en la planilla.`}
        </p>
      )}
    </section>
  )
}

export function RowDetailDrawer({
  row,
  onClose,
  sourceFields,
}: {
  row: ResumenRow
  onClose: () => void
  /** The published version's source fields; null/undefined while unknown. */
  sourceFields?: readonly string[] | null
}) {
  const sourceHasAef = aefInSource(sourceFields)
  const [current, setCurrent] = useState<ResumenRow>(row)
  const [openedFrom, setOpenedFrom] = useState<ResumenRow>(row)
  const [detail, setDetail] = useState<TranselecPmfDetail | null>(null)
  const [failure, setFailure] = useState<FailureView | null>(null)
  const [loading, setLoading] = useState(true)

  // A different row chosen behind the panel replaces the one shown here.
  // Adjusted during render rather than in an effect, so the panel never
  // paints one frame of the previous row.
  if (openedFrom !== row) {
    setOpenedFrom(row)
    setCurrent(row)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setDetail(null)
    setFailure(null)

    void getPmfDetail(row.pmf).then((result) => {
      if (cancelled) return
      if (result.ok) setDetail(result.data)
      else setFailure(classifyFailure({ status: result.status, error: result.error }))
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [row.pmf])

  const rows = detail
    ? [...detail.rows].sort((a, b) => a.source_row_number - b.source_row_number)
    : []
  const firstRow = rows[0] ?? null
  // The PMF is counted under its first row's «Estado resumido». Say so only
  // when the row being read disagrees, which is when it matters.
  const countedDifferently =
    detail !== null &&
    firstRow !== null &&
    firstRow.source_row_number !== current.source_row_number &&
    cell(detail.estado_resumido) !== cell(current.estado_resumido)

  const where = [
    cell(current.predio_ref, 'Sin predio de reforestación informado'),
    current.rol ? `rol ${current.rol}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Drawer
      title={current.pmf}
      eyebrow="Plan de manejo (PMF)"
      subtitle={where}
      onClose={onClose}
      testId="row-drawer"
      headerExtra={
        <div className="drawer-meta">
          <StatusPill value={current.estado_resumido} />
          <span className="provenance" data-testid="drawer-provenance">
            Fila de origen {formatInteger(current.source_row_number)} de la hoja «Resumen»
          </span>
        </div>
      }
    >
      <div className="drawer-sections">
        {countedDifferently && (
          <p className="drawer-note" data-testid="drawer-counted-as">
            En las cifras del panel este PMF se cuenta como «{cell(detail?.estado_resumido, 'sin estado')}»,
            el «Estado resumido» de su primera fila (fila {formatInteger(firstRow?.source_row_number)}).
          </p>
        )}

        <section className="drawer-section" aria-labelledby="drawer-tramitacion">
          <h3 id="drawer-tramitacion">Tramitación</h3>
          <dl className="facts">
            <Fact label="Estado vigente" wide>
              {cell(current.estado, 'Sin información')}
            </Fact>
            <Fact label="Motivo" wide>
              {cell(current.tipo_rechazo, 'Sin motivo registrado')}
            </Fact>
            <Fact label="N.º ingreso">{cell(current.numero_ingreso, 'Sin ingreso')}</Fact>
            <Fact label="PAS">{cell(current.pas, 'Sin información')}</Fact>
            <Fact label="Fecha ingreso">
              <SourceDate row={current} field="fecha_ingreso" missing="Sin fecha" />
            </Fact>
            <Fact label="90 días">
              <SourceDate row={current} field="fecha_90_dias" missing="Sin fecha" />
            </Fact>
            <Fact label="Empresa">{cell(current.empresa, 'Sin información')}</Fact>
            <Fact label="Propietario">{cell(current.tipo_propietario, 'Sin información')}</Fact>
          </dl>
        </section>

        <AefSection row={current} detail={detail} sourceHasAef={sourceHasAef} />

        <section className="drawer-section" aria-labelledby="drawer-rows">
          <h3 id="drawer-rows">
            Filas de {current.pmf}{' '}
            {detail && (
              <span className="hint" data-testid="drawer-sibling-count">
                ({formatInteger(detail.row_count)}{' '}
                {detail.row_count === 1 ? 'fila en total' : 'filas en total'})
              </span>
            )}
          </h3>
          {loading && <LoadingBlock label="Buscando las filas de este PMF…" lines={2} />}
          {failure && <AlertBanner title={failure.title}>{failure.message}</AlertBanner>}
          {detail &&
            (rows.length > 1 ? (
              <>
                <p className="hint">Elija una fila para ver su detalle aquí mismo.</p>
                <div className="tablewrap short">
                  <table className="drawer-rows">
                    <thead>
                      <tr>
                        <th scope="col">Fila</th>
                        <th scope="col">Rol</th>
                        <th scope="col">Área</th>
                        <th scope="col" className="numeric">
                          Sup. ha
                        </th>
                        <th scope="col">Estado</th>
                        {sourceHasAef !== false && <th scope="col">AEF</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((entry) => {
                        const selected = entry.source_row_number === current.source_row_number
                        return (
                          <tr
                            key={entry.source_row_number}
                            aria-current={selected ? 'true' : undefined}
                            data-testid={`drawer-row-${entry.source_row_number}`}
                          >
                            <td className="numeric">
                              {selected ? (
                                <span className="row-here">
                                  {entry.source_row_number}
                                  <span className="row-here-tag">esta fila</span>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  className="row-switch"
                                  onClick={() => setCurrent(entry)}
                                  aria-label={`Ver la fila ${entry.source_row_number}`}
                                >
                                  {entry.source_row_number}
                                </button>
                              )}
                            </td>
                            <td>{cell(entry.rol)}</td>
                            <td>{cell(entry.numero_area_corta)}</td>
                            <td className="numeric">{formatNumber(entry.superficie_corta)}</td>
                            <td>
                              <StatusPill value={entry.estado_resumido} />
                            </td>
                            {sourceHasAef !== false && (
                              <td>{cell(entry.aef) || <span className="aef-empty">—</span>}</td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="hint">Este PMF tiene una sola fila de origen en la versión publicada.</p>
            ))}
        </section>

        <section className="drawer-section" aria-labelledby="drawer-area">
          <h3 id="drawer-area">
            Área de corta de la fila {formatInteger(current.source_row_number)}
          </h3>
          <dl className="facts">
            <Fact label="Predio ref." wide>
              {cell(current.predio_ref, 'Sin información')}
            </Fact>
            <Fact label="Rol">{cell(current.rol, 'Sin rol')}</Fact>
            <Fact label="Predio">{cell(current.numero_predio, 'Sin información')}</Fact>
            <Fact label="Área corta">{cell(current.numero_area_corta, 'Sin información')}</Fact>
            <Fact label="Superficie">
              {formatNumber(current.superficie_corta)} ha de un total de{' '}
              {formatNumber(current.superficie_total_corta)} ha
            </Fact>
            <Fact label="Sector">{cell(current.sector, 'Sin información')}</Fact>
            <Fact label="ID predial">{cell(current.id_predio_unico, 'Sin identificador')}</Fact>
            <Fact label="Carpeta PMF">{cell(current.carpeta_source, 'Sin información')}</Fact>
            <Fact label="Carpeta normalizada">
              {cell(current.carpeta_normalizada, 'Sin información')}
            </Fact>
          </dl>
        </section>
      </div>
    </Drawer>
  )
}
