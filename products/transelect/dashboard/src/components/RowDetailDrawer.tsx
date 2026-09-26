/**
 * One PMF's detail, in a side panel.
 *
 * The shipped interface could show a row only as a row: thirteen cells in a
 * horizontally scrolling table, with no way to see the rest of the contract
 * fields or the other áreas de corta that belong to the same PMF. This panel
 * makes the connection between PMF, predio, rol and source row explicit,
 * using `GET /transelec/pmfs/{pmf}` — a read endpoint the application already
 * had a typed client for and never called.
 *
 * The row that was clicked is shown immediately from data the table already
 * holds, and the PMF's sibling rows arrive when the request resolves, so the
 * panel is never blank while it loads.
 *
 * The AEF section is row-level on purpose. The workbook records AEF, the
 * requester and the three dates per área de corta, and most PMFs that have
 * one AEF row also have rows without one; so a blank here says "this row has
 * no value", the sibling table shows which rows do, and nothing is borrowed
 * across rows. When the published workbook had no AEF columns at all, the
 * panel says that instead of implying every row is blank.
 */
import { useEffect, useState } from 'react'
import {
  type ResumenRow,
  type TranselecPmfDetail,
  getPmfDetail,
} from '../api'
import { cell, formatDate, formatInteger, formatNumber } from '../format'
import { aefInSource, chronologyFlagsOf, chronologyLabel, hasAefTracking } from '../lib/aef'
import { classifyFailure, type FailureView } from '../lib/apiState'
import { Drawer } from '../ui/Drawer'
import { AlertBanner, LoadingBlock } from './StateViews'
import { StatusPill } from './StatusPill'

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
      <section className="stack-tight" data-testid="drawer-aef">
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
    <section className="stack-tight" data-testid="drawer-aef">
      <h3>Seguimiento AEF</h3>
      {chronologyFlagsOf(row).length > 0 && (
        <AlertBanner tone="warn" title="Fechas a revisar en la planilla">
          {chronologyFlagsOf(row).map(chronologyLabel).join('; ')}. Se muestran tal como vienen en
          la fila {formatInteger(row.source_row_number)}; no se corrigen.
        </AlertBanner>
      )}
      <dl className="defs">
        <dt>AEF</dt>
        <dd>{cell(row.aef, missing)}</dd>
        <dt>Quién solicita</dt>
        <dd>{cell(row.quien_solicita, missing)}</dd>
        <dt>Fecha solicitud</dt>
        <dd>{formatDate(row.fecha_solicitud) || missing}</dd>
        <dt>Fecha corta</dt>
        <dd>{formatDate(row.fecha_corta) || missing}</dd>
        <dt>Fecha término</dt>
        <dd>{formatDate(row.fecha_termino) || missing}</dd>
      </dl>
      {detail && (
        <p className="hint" data-testid="drawer-aef-coverage">
          {formatInteger(tracked.length)} de {formatInteger(detail.row_count)} filas de{' '}
          {detail.pmf} tienen registro AEF.
          {!rowTracked && tracked.length > 0 &&
            ' El registro es por fila: el de otras filas no se aplica a esta.'}
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
  const [detail, setDetail] = useState<TranselecPmfDetail | null>(null)
  const [failure, setFailure] = useState<FailureView | null>(null)
  const [loading, setLoading] = useState(true)

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

  const siblings = detail?.rows.filter(
    (entry) => entry.source_row_number !== row.source_row_number,
  )

  return (
    <Drawer
      title={row.pmf}
      subtitle={`Fila de origen ${formatInteger(row.source_row_number)} de la hoja «Resumen»`}
      onClose={onClose}
      testId="row-drawer"
    >
      <div className="stack">
        <div className="row">
          <StatusPill value={row.estado_resumido} />
          {detail && (
            <span className="basis-tag">{detail.basis_estado_resumido}</span>
          )}
        </div>

        <dl className="defs">
          <dt>Predio ref.</dt>
          <dd>{cell(row.predio_ref, 'Sin información')}</dd>
          <dt>Predio</dt>
          <dd>{cell(row.numero_predio, 'Sin información')}</dd>
          <dt>Rol</dt>
          <dd>{cell(row.rol, 'Sin rol')}</dd>
          <dt>Área corta</dt>
          <dd>{cell(row.numero_area_corta, 'Sin información')}</dd>
          <dt>Superficie</dt>
          <dd>
            {formatNumber(row.superficie_corta)} ha de un total de{' '}
            {formatNumber(row.superficie_total_corta)} ha
          </dd>
          <dt>Carpeta PMF</dt>
          <dd>{cell(row.carpeta_source, 'Sin información')}</dd>
          <dt>Carpeta normalizada</dt>
          <dd>{cell(row.carpeta_normalizada, 'Sin información')}</dd>
          <dt>PAS</dt>
          <dd>{cell(row.pas, 'Sin información')}</dd>
          <dt>Estado vigente</dt>
          <dd>{cell(row.estado, 'Sin información')}</dd>
          <dt>Motivo</dt>
          <dd>{cell(row.tipo_rechazo, 'Sin motivo registrado')}</dd>
          <dt>N.º ingreso</dt>
          <dd>{cell(row.numero_ingreso, 'Sin ingreso')}</dd>
          <dt>Fecha ingreso</dt>
          <dd>{formatDate(row.fecha_ingreso) || 'Sin fecha'}</dd>
          <dt>90 días</dt>
          <dd>{formatDate(row.fecha_90_dias) || 'Sin fecha'}</dd>
          <dt>Empresa</dt>
          <dd>{cell(row.empresa, 'Sin información')}</dd>
          <dt>Propietario</dt>
          <dd>{cell(row.tipo_propietario, 'Sin información')}</dd>
          <dt>Sector</dt>
          <dd>{cell(row.sector, 'Sin información')}</dd>
          <dt>ID predial</dt>
          <dd>{cell(row.id_predio_unico, 'Sin identificador')}</dd>
        </dl>

        <AefSection row={row} detail={detail} sourceHasAef={sourceHasAef} />

        {loading && <LoadingBlock label="Buscando las demás filas de este PMF…" lines={2} />}
        {failure && <AlertBanner title={failure.title}>{failure.message}</AlertBanner>}

        {detail && (
          <section className="stack-tight">
            <h3>
              Otras áreas de corta de {detail.pmf}{' '}
              <span className="hint" data-testid="drawer-sibling-count">
                ({formatInteger(detail.row_count)} filas en total)
              </span>
            </h3>
            {siblings && siblings.length > 0 ? (
              <div className="tablewrap short">
                <table>
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
                    {siblings.map((entry) => (
                      <tr key={entry.source_row_number}>
                        <td className="numeric">{entry.source_row_number}</td>
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
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="hint">
                Este PMF tiene una sola fila de origen en la versión publicada.
              </p>
            )}
          </section>
        )}
      </div>
    </Drawer>
  )
}
