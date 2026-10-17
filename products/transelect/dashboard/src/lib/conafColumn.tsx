/**
 * The «Estado CONAF» column of the «Estado» table, after «Plazo CONAF». It
 * reads the most recent ingreso, the number the 90-day term counts from.
 */
import type { ConafSolicitud, LifecycleRow } from '../api'
import { ConafEstadoCell } from '../components/ConafEstadoCell'
import { normalizeSolicitud } from './conafEstado'
import type { EstadoColumn } from './estadoColumns'

/**
 * Off until Campo Digital confirms which planilla number is CONAF's solicitud.
 * FACT (2026-10-17, production, shapes only): no `N Ingreso` matched CONAF's
 * public consulta; most use `999/999-9/99` and the 8-digit ones answered «no
 * existe». Turning this on shows the column and the drawer card again.
 */
export const CONAF_ESTADO_ENABLED = false

export function conafNumero(row: Pick<LifecycleRow, 'numero_ingreso' | 'numero_ingreso_2'>): string | null {
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
      return <ConafEstadoCell numero={numero} record={normalized ? byNumero.get(normalized) : undefined} />
    },
  }
}
