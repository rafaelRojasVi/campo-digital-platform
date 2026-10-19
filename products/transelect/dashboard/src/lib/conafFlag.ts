/**
 * Estado CONAF in Transelec: the «Estado CONAF» column, the drawer card and
 * the «Abrir Oficina Virtual CONAF» links.
 *
 * FACT (2026-10-18): CONAF's public consulta answers the planilla's
 * «N Ingreso» as written (e.g. 12/345-6/24 → APROBADA).
 * It had been off since 2026-10-17 because only digit numbers were queried,
 * and those (the 8-digit `100…` ones) answer «no existe».
 */
export const CONAF_ESTADO_ENABLED = true
