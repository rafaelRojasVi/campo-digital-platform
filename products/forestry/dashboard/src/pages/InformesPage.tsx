/**
 * «Informes»: management reports (informes de manejo). Editors see every
 * report and start new ones; viewers see approved reports only (the API
 * filters). Submitted reports come first; admins see how many wait for them.
 */
import { useEffect, useState } from 'react'
import { canUpload } from '../api.ts'
import { NewReportDialog } from '../components/NewReportDialog.tsx'
import { Notice, PageShell } from '../components/PageShell.tsx'
import { ReportStatusChip } from '../components/ReportStatusChip.tsx'
import { formatDate } from '../lib/format.ts'
import {
  TYPE_LABELS,
  fetchConafSolicitudes,
  fetchReports,
  type ConafSolicitud,
  type ReportList,
} from '../reportsApi.ts'
import { ROUTES, onLinkClick, reportPath } from '../router.ts'
import { conafTone, TONE_LABELS, TONE_PILL } from '../lib/conafEstado.ts'
import type { ForestryRole } from '../types.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; list: ReportList }

export function InformesPage({ role }: { role: ForestryRole }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [creating, setCreating] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [conaf, setConaf] = useState<Map<string, ConafSolicitud>>(new Map())

  useEffect(() => {
    let cancelled = false
    fetchReports()
      .then((list) => {
        if (cancelled) return
        setLoad({ status: 'ready', list })
        // Stored CONAF results only (never calls CONAF); a failure leaves «—».
        const numeros = list.reports.flatMap((r) => (r.conaf_solicitud ? [r.conaf_solicitud] : []))
        if (numeros.length > 0) {
          fetchConafSolicitudes(numeros)
            .then((records) => {
              if (!cancelled) setConaf(new Map(records.map((record) => [record.numero, record])))
            })
            .catch(() => undefined)
        }
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  const editor = canUpload(role)

  return (
    <PageShell active={ROUTES.informes} role={role}>
      <div className="page__heading">
        <h2 className="page__title">Informes de manejo</h2>
        <p className="page__lead">
          {editor
            ? 'Elija rodales, divídalos si hace falta y envíe el informe a revisión. Una vez aprobado, expórtelo para Campo Digital.'
            : 'Informes aprobados por Campo Digital.'}
        </p>
      </div>

      {editor ? (
        <div className="page__actions">
          <button type="button" className="button" onClick={() => setCreating(true)}>
            Nuevo informe
          </button>
        </div>
      ) : null}

      {load.status === 'loading' ? <p className="page__busy">Cargando informes…</p> : null}
      {load.status === 'error' ? (
        <Notice tone="error" title="No fue posible cargar los informes.">
          <button type="button" className="button button--ghost" onClick={() => setNonce((n) => n + 1)}>
            Reintentar
          </button>
        </Notice>
      ) : null}

      {load.status === 'ready' ? (
        <>
          {load.list.pending_review_count > 0 ? (
            <Notice tone="info">{`Pendientes de revisión: ${load.list.pending_review_count}`}</Notice>
          ) : null}
          {load.list.reports.length === 0 ? (
            <p className="muted">
              {editor
                ? 'Aún no hay informes. Use «Nuevo informe» para empezar.'
                : 'Aún no hay informes aprobados.'}
            </p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Informe</th>
                    <th>Tipo · mes</th>
                    <th>Estado</th>
                    <th>Creado por</th>
                    <th>CONAF</th>
                    <th className="numeric">Área de manejo</th>
                    <th>Actualizado</th>
                  </tr>
                </thead>
                <tbody>
                  {load.list.reports.map((report) => (
                    <tr key={report.report_id}>
                      <td>
                        <a
                          href={reportPath(report.report_id)}
                          onClick={(event) => onLinkClick(event, reportPath(report.report_id))}
                        >
                          {report.name}
                        </a>
                      </td>
                      <td>{`${TYPE_LABELS[report.report_type]} · ${report.report_month}`}</td>
                      <td>
                        <ReportStatusChip status={report.status} />
                      </td>
                      <td>{report.created_by_display_name}</td>
                      <td>
                        <ConafListCell
                          numero={report.conaf_solicitud}
                          record={report.conaf_solicitud ? conaf.get(report.conaf_solicitud) : undefined}
                        />
                      </td>
                      <td className="numeric">{`${ha.format(report.managed_area_ha)} ha`}</td>
                      <td>{formatDate(report.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {creating ? <NewReportDialog onCancel={() => setCreating(false)} /> : null}
    </PageShell>
  )
}

function ConafListCell({ numero, record }: { numero: string | null; record: ConafSolicitud | undefined }) {
  if (numero === null) return <span className="muted">—</span>
  const warning =
    record?.lookup_status === 'not_found'
      ? 'No existe en CONAF'
      : record?.lookup_status === 'mismatch'
        ? 'Revisar N.º'
        : record?.lookup_status === 'unavailable' && record.estado === null
          ? 'CONAF no respondió'
          : null
  if (warning !== null) {
    return (
      <span className="conaf-list-cell">
        <span className="conaf-warn">{warning}</span>
        <span className="conaf-list-cell__numero">{numero}</span>
      </span>
    )
  }
  const tone = record !== undefined && record.estado !== null ? conafTone(record) : null
  return (
    <span className="conaf-list-cell">
      {tone !== null && record !== undefined ? (
        <span className={TONE_PILL[tone]} title={record.estado ?? undefined}>
          {TONE_LABELS[tone]}
        </span>
      ) : (
        <span className="muted">Sin consultar</span>
      )}
      <span className="conaf-list-cell__numero">{numero}</span>
    </span>
  )
}
