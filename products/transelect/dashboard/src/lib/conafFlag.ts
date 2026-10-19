/**
 * Off until Campo Digital confirms which planilla number is CONAF's solicitud.
 * FACT (2026-10-17, production, shapes only): no `N Ingreso` matched CONAF's
 * public consulta; most use `999/999-9/99` and the 8-digit ones answered «no
 * existe». Turning this on shows the «Estado CONAF» column, the drawer card
 * and the «Abrir Oficina Virtual CONAF» links again.
 */
export const CONAF_ESTADO_ENABLED = false
