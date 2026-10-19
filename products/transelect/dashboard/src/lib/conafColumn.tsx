/**
 * The «Estado CONAF» column of the «Estado» table, after «Plazo CONAF». It
 * reads the most recent ingreso, the number the 90-day term counts from.
 */
import type { ConafSolicitud, LifecycleRow } from '../api'
import { ConafEstadoCell } from '../components/ConafEstadoCell'
import { normalizeSolicitud, solicitudesInCell } from './conafEstado'
import type { EstadoColumn } from './estadoColumns'


/**
 * The CONAF number to read for a PMF: the most recent one, as the 90-day term
 * counts from it — the last number of «N Ingreso2», else of «N Ingreso» (a
 * cell may hold the ingreso and the reingreso). When neither holds a
 * queryable number, the raw cell, which shows as «Sin N.º consultable».
 */
export function conafNumero(row: Pick<LifecycleRow, 'numero_ingreso' | 'numero_ingreso_2'>): string | null {
  for (const cell of [row.numero_ingreso_2, row.numero_ingreso]) {
    const found = solicitudesInCell(cell)
    if (found.length > 0) return found[found.length - 1]
  }
  return row.numero_ingreso_2 ?? row.numero_ingreso
}

export function conafColumn(byNumero: ReadonlyMap<string, ConafSolicitud>): EstadoColumn {
  return {
    key: 'conaf',
    header: 'Estado CONAF',
    after: 'pmf',
    webFields: ['numero_ingreso', 'numero_ingreso_2'],
    render: (row) => {
      const numero = conafNumero(row)
      const normalized = normalizeSolicitud(numero)
      return (
        <ConafEstadoCell
          numero={numero}
          record={normalized ? byNumero.get(normalized) : undefined}
          estadoResumido={row.estado_resumido}
        />
      )
    },
  }
}
