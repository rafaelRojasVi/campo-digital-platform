/**
 * `/transelec/datos` — data administration, for operators and administrators.
 *
 * Two panes that were two top-level routes. They belong together: importing a
 * planilla and deciding which version is live are one job with two halves,
 * and separating them made "publish, then check what is now active" a
 * navigation instead of a glance.
 *
 * The old routes still resolve here, so `/transelec/importar` and
 * `/transelec/versiones` keep working as links and bookmarks — they simply
 * select a pane.
 *
 * Access is presentation only. The server re-enforces the same boundary on
 * every endpoint this section calls; a viewer who types the URL gets the
 * unauthorized state from the shell and a 403 from the API.
 */
import type { TranselecActiveImport } from '../api'
import { Link, ROUTES, type Route } from '../router'
import { SectionHeader } from '../ui/Primitives'
import { ImportarPage } from './ImportarPage'
import { VersionesPage } from './VersionesPage'

export function DatosPage({
  route,
  activeImport,
  onActiveVersionChanged,
}: {
  route: Route
  activeImport: TranselecActiveImport | null
  onActiveVersionChanged: () => void
}) {
  const pane = route === ROUTES.versiones ? 'versiones' : 'importar'

  return (
    <div className="page enter">
      <SectionHeader
        title="Administración de datos"
        meta="Sólo operadores y administradores de Transelec."
        actions={null}
      />

      <nav className="datos-tabs no-print" aria-label="Paneles de administración de datos">
        <Link to={ROUTES.importar} current={pane === 'importar'}>
          Importar planilla
        </Link>
        <Link to={ROUTES.versiones} current={pane === 'versiones'}>
          Versiones
        </Link>
      </nav>

      <div style={{ marginTop: 'var(--s-6)' }}>
        {pane === 'importar' ? (
          <ImportarPage onActiveVersionChanged={onActiveVersionChanged} />
        ) : (
          <VersionesPage
            activeImport={activeImport}
            onActiveVersionChanged={onActiveVersionChanged}
          />
        )}
      </div>
    </div>
  )
}
