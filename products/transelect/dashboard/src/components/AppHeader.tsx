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
import { useCallback, useState } from 'react'
import type { Me, TranselecActiveImport } from '../api'
import { logout, transelecRole } from '../api'
import { formatDateTime } from '../format'
import { Link, ROUTES } from '../router'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Lectura',
}

/**
 * Ends the current session from the header.
 *
 * `POST /auth/logout` goes through the shared API client, so it carries the
 * session-bound CSRF token `GET /auth/csrf` issues, exactly like every other
 * state-changing call in this app — there is no second transport here. The
 * caller is told only after the server has actually cleared the session, so
 * a failed sign-out never leaves the UI claiming the user is signed out.
 */
function SessionControl({
  label,
  onSignedOut,
}: {
  label: string
  onSignedOut: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const endSession = useCallback(async () => {
    setBusy(true)
    setFailed(false)

    const result = await logout()
    if (result.ok) {
      onSignedOut()
      return
    }

    setFailed(true)
    setBusy(false)
  }, [onSignedOut])

  return (
    <div className="session-control no-print">
      <button type="button" className="btn alt" disabled={busy} onClick={() => void endSession()}>
        {busy ? 'Cerrando sesión…' : label}
      </button>
      {failed && (
        <span className="session-control-error" role="alert">
          No se pudo cerrar la sesión. Intente nuevamente.
        </span>
      )}
    </div>
  )
}

export function AppHeader({
  me,
  activeImport,
  currentPath,
  canPublish,
  demoMode = false,
  onSignedOut,
}: {
  me: Me | null
  activeImport: TranselecActiveImport | null
  currentPath: string
  canPublish: boolean
  /**
   * Local development, where switching between seeded identities is the
   * point — it only changes the control's wording, never who may do what.
   */
  demoMode?: boolean
  /**
   * Optional: the header also renders in states that have no session to end
   * (and in component tests that exercise the brand and navigation alone),
   * so the control appears only when a caller can actually handle the result.
   */
  onSignedOut?: () => void
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
          {me && onSignedOut && (
            <SessionControl
              label={demoMode ? 'Cambiar usuario' : 'Cerrar sesión'}
              onSignedOut={onSignedOut}
            />
          )}
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
