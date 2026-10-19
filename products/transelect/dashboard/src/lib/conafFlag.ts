/**
 * Estado CONAF in Transelec: the «Estado CONAF» column and the drawer card.
 * The «Abrir Oficina Virtual CONAF» links do not depend on it.
 *
 * FACT (2026-10-18): CONAF's public consulta answers the planilla's
 * «N Ingreso» as written (e.g. 12/345-6/24, slashes URL-encoded).
 *
 * Paused on 2026-10-19 after approved plans showed «DENEGADA» in the
 * consulta; back on the same day once Campo Digital confirmed why (an
 * approved recurso de reposición is not reflected there). Those cases show
 * «Revisar», not «Rechazada» (lib/conafEstado.ts, contradictsPlanilla).
 */
export const CONAF_ESTADO_ENABLED = true
