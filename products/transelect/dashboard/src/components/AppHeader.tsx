/**
 * TR-FUNC-041 (encabezado / marca) and TR-FUNC-046 (vigencia de los datos).
 *
 * Brand marks are generic placeholders. The source HTML files embed both
 * logos as inline base64; those payloads are deliberately not reused here —
 * TR-OPEN-06 (logo/brand asset sourcing authorization) is still open, and
 * reusing the image bytes without Javier / Campo Digital's explicit
 * authorization is out of bounds for this rebuild.
 *
 * The date stamp is the fix TR-FUNC-046 asks for: v0 recomputed
 * `new Date()` at every page load (so a frozen snapshot always claimed to be
 * "today"), and Actualizable hardcoded "Base: 14 agosto 2026". This header
 * shows the *active version's own publish timestamp*, read from
 * `GET /transelec/imports/active` — real provenance, never a live clock and
 * never a literal.
 */
import type { Me, TranselecActiveImport } from '../api'
import { transelecRole } from '../api'
import { formatDateTime } from '../format'
import { Link, ROUTES } from '../router'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Lectura',
}

export function AppHeader({
  me,
  activeImport,
  currentPath,
  canPublish,
}: {
  me: Me | null
  activeImport: TranselecActiveImport | null
  currentPath: string
  canPublish: boolean
}) {
  const role = transelecRole(me)

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-identity">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <span className="brand-owner">Campo Digital</span>
            <div className="client-block">
              <div className="client-line">
                <span className="client-tag">Cliente</span>
                <span className="client-name">Transelec</span>
              </div>
              <h1>Transmisora del Pacífico – Transelec</h1>
              <p>
                Seguimiento de Planes de Manejo Forestal · ingresos CONAF · superficies y situación
                predial
              </p>
            </div>
          </div>
        </div>

        <div className="stamp">
          {activeImport ? (
            <>
              <strong>Versión activa #{activeImport.import_id}</strong>
              <br />
              Publicada {formatDateTime(activeImport.published_at)}
            </>
          ) : (
            <strong>Sin versión publicada</strong>
          )}
          <br />
          {me ? (
            <>
              {me.display_name}
              {role ? ` · ${ROLE_LABELS[role] ?? role}` : ''}
            </>
          ) : (
            'Sesión no iniciada'
          )}
          <br />
          Desarrollado por Campo Digital
        </div>
      </div>

      <nav className="topnav no-print" aria-label="Secciones de Transelec">
        <Link to={ROUTES.dashboard} current={currentPath === ROUTES.dashboard}>
          Panel
        </Link>
        {canPublish && (
          <>
            <Link to={ROUTES.importar} current={currentPath === ROUTES.importar}>
              Importar planilla
            </Link>
            <Link to={ROUTES.versiones} current={currentPath === ROUTES.versiones}>
              Versiones
            </Link>
          </>
        )}
      </nav>
    </header>
  )
}
