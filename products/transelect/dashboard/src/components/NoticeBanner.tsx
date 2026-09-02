/**
 * TR-FUNC-042 — the "Consulta documental" explanatory banner.
 *
 * Wording matches the source dashboards, which are identical here.
 */
export function NoticeBanner() {
  return (
    <div className="notice no-print" data-testid="notice-banner">
      <b>Consulta documental:</b> el campo <b>N.º de ingreso está asociado directamente a cada
      PMF</b>. Escriba el número completo o una parte en «Búsqueda general» para obtener el PMF,
      rol, predio y estado correspondiente. La base no incluye un campo separado de N.º de
      resolución.
    </div>
  )
}
