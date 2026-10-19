/**
 * «Imprimir / PDF»: one page with the report's map (satellite, managed areas
 * in orange, rodal numbers, scale, north), its legend and the table of
 * rodales with totals. The browser prints it or saves it as PDF. It shows
 * the last saved version of the report.
 */
import { useEffect, useState } from 'react'
import { PRINT_MANAGED, PRINT_OTHER, PrintMap } from '../components/PrintMap.tsx'
import { formatDate } from '../lib/format.ts'
import { printRows } from '../lib/reportPrint.ts'
import {
  STATUS_LABELS,
  TYPE_LABELS,
  fetchReport,
  formatReportDate,
  type ReportDetail,
} from '../reportsApi.ts'
import { onLinkClick, reportPath } from '../router.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; detail: ReportDetail }

export function InformePrintPage({ reportId }: { reportId: number | null }) {
  const [load, setLoad] = useState<Load>(
    reportId === null ? { status: 'missing' } : { status: 'loading' },
  )

  useEffect(() => {
    if (reportId === null) return
    let cancelled = false
    fetchReport(reportId)
      .then((detail) => {
        if (!cancelled) setLoad({ status: 'ready', detail })
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'missing' })
      })
    return () => {
      cancelled = true
    }
  }, [reportId])

  if (load.status === 'loading') return <p className="print-page__status">Cargando informe…</p>
  if (load.status === 'missing') {
    return <p className="print-page__status">No se encontró el informe.</p>
  }

  const { report, features } = load.detail
  const { rows, totalHa, managedHa } = printRows(features)
  const predios = [...new Set(rows.map((row) => row.predio).filter((name) => name !== '—'))]

  return (
    <div className="print-page">
      <div className="print-page__actions">
        <a
          className="button button--ghost"
          href={reportPath(report.report_id)}
          onClick={(event) => onLinkClick(event, reportPath(report.report_id))}
        >
          ← Volver al informe
        </a>
        <button type="button" className="button" onClick={() => window.print()}>
          Imprimir o guardar como PDF
        </button>
      </div>

      <header className="print-page__header">
        <p className="print-page__kicker">Informe de manejo · Patrimonio Degenfeld</p>
        <h1>{report.name}</h1>
        <p>
          {TYPE_LABELS[report.report_type]} · {formatReportDate(report)} · {STATUS_LABELS[report.status]}
          {report.conaf_solicitud !== null ? ` · Solicitud CONAF N.º ${report.conaf_solicitud}` : ''}
        </p>
        {predios.length > 0 ? <p>Predios: {predios.join(', ')}</p> : null}
      </header>

      <PrintMap features={features} />

      <ul className="print-page__legend" aria-label="Leyenda">
        <li>
          <span style={{ background: PRINT_MANAGED }} /> Área de manejo · {ha.format(managedHa)} ha
        </li>
        <li>
          <span style={{ background: PRINT_OTHER }} /> Resto del informe ·{' '}
          {ha.format(totalHa - managedHa)} ha
        </li>
      </ul>

      <table className="print-page__table">
        <thead>
          <tr>
            <th>Rodal</th>
            <th>Código</th>
            <th>Predio</th>
            <th>Sector</th>
            <th>Uso 2026</th>
            <th>Especie</th>
            <th className="num">Superficie (ha)</th>
            <th>Área de manejo</th>
            <th>Esp. reforestar</th>
            <th className="num">Dens. refor. (pl/ha)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ordinal}>
              <td>{row.rodal}</td>
              <td>{row.code}</td>
              <td>{row.predio}</td>
              <td>{row.sector ?? ''}</td>
              <td>{row.uso}</td>
              <td>{row.species}</td>
              <td className="num">{ha.format(row.ha)}</td>
              <td>{row.managed ? 'Sí' : 'No'}</td>
              <td>{row.reforestSpecies ?? ''}</td>
              <td className="num">{row.reforestDensity != null ? String(row.reforestDensity) : ''}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={7}>Total ({rows.length} polígonos)</td>
            <td className="num">{ha.format(totalHa)}</td>
            <td>{ha.format(managedHa)} ha</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>

      <footer className="print-page__footer">
        Plataforma Campo Digital · impreso el {formatDate(new Date().toISOString())} · Superficie en
        hectáreas (EPSG:32718). Imagen satelital © Esri.
      </footer>
    </div>
  )
}
