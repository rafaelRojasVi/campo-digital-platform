/**
 * TR-FUNC-039 — "Detalle filtrado", the main row-grain table.
 *
 * Actualizable's 12-column set, with one deliberate correction: its single
 * `Carpeta` column is shown as the two positionally-distinct source columns
 * it silently collapsed. The workbook has two different columns both named
 * `Carpeta` (E, 1:1 with PMF; AC, a coarser grouping), and both HTML files
 * keep only whichever one survived a JavaScript object-literal key
 * collision. TR-OPEN-02 is still open, so this table does not choose either
 * — it labels and shows both, exactly as the ratified CSV export does.
 *
 * Pagination is real, server-side and cursor-based. The source's hidden
 * `slice(0, 1000)` cap is not reproduced: the row count shown is the API's
 * true `total_count` for the current filter state, never a capped one.
 */
import type { ResumenRow } from '../api'
import { cell, formatInteger, formatNumber } from '../format'
import { StatusPill } from './StatusPill'

export function RowsTable({
  rows,
  totalCount,
  loading,
}: {
  rows: ResumenRow[]
  totalCount: number
  loading: boolean
}) {
  return (
    <>
      <h2 id="rows-title">
        Detalle filtrado{' '}
        <span className="hint" data-testid="rows-total">
          ({formatInteger(totalCount)} áreas de corta)
        </span>
      </h2>
      <div className="tablewrap" aria-busy={loading}>
        <table>
          <thead>
            <tr>
              <th scope="col">PMF</th>
              <th scope="col">Predio de reforestación</th>
              <th scope="col">Carpeta (col. E)</th>
              <th scope="col">Carpeta (col. AC)</th>
              <th scope="col">Rol</th>
              <th scope="col">Predio</th>
              <th scope="col">Área corta</th>
              <th scope="col">Sup. ha</th>
              <th scope="col">Estado resumido</th>
              <th scope="col">N.º ingreso</th>
              <th scope="col">Empresa</th>
              <th scope="col">Propietario</th>
              <th scope="col">Sector</th>
            </tr>
          </thead>
          <tbody data-testid="rows-body">
            {rows.map((row) => (
              <tr key={row.source_row_number}>
                <td>
                  <b>{row.pmf}</b>
                </td>
                <td>{cell(row.predio_ref, 'Sin información')}</td>
                <td>{cell(row.carpeta_source)}</td>
                <td>{cell(row.carpeta_normalizada)}</td>
                <td>{cell(row.rol)}</td>
                <td>{cell(row.numero_predio)}</td>
                <td>{cell(row.numero_area_corta)}</td>
                <td className="numeric">{formatNumber(row.superficie_corta)}</td>
                <td>
                  <StatusPill value={row.estado_resumido} />
                </td>
                <td>{cell(row.numero_ingreso)}</td>
                <td>{cell(row.empresa)}</td>
                <td>{cell(row.tipo_propietario)}</td>
                <td>{cell(row.sector)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={13} className="empty">
                  No hay registros para los filtros aplicados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
