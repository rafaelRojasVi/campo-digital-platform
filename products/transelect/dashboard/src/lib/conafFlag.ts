/**
 * Estado CONAF in Transelec: the «Estado CONAF» column and the drawer card.
 * The «Abrir Oficina Virtual CONAF» links do not depend on it.
 *
 * FACT (2026-10-18): CONAF's public consulta answers the planilla's
 * «N Ingreso» as written (e.g. 12/345-6/24, slashes URL-encoded).
 *
 * Off again since 2026-10-19. Checking every planilla number against CONAF
 * showed PMF that are «Aprobado» in the planilla but «DENEGADA» in the
 * consulta, including every PMF with a recurso de reposición recorded.
 * INFERENCE: the consulta keeps showing the original denial after an
 * approval on appeal. Until Campo Digital confirms it, the column would tell
 * Transelec that approved plans were denied (docs/platform/conaf-estado.md).
 */
export const CONAF_ESTADO_ENABLED = false
