import campoDigitalLogo from '../assets/campo-digital-logo.png'
import { formatDate } from '../lib/format.ts'
import { ROUTES, mapPath, onLinkClick } from '../router.ts'
import type { Route } from '../router.ts'
import { PLATFORM_FRONT_DOOR_PATH, platformFrontDoorEnabled } from '../runtime/frontDoor.ts'
import type { ForestryRole, ForestrySnapshot } from '../types.ts'

interface HeaderProps {
  active: Route
  role: ForestryRole | null
  /** The version on the map, when the page shows one. */
  snapshot?: ForestrySnapshot
  /** True when the map shows a version other than the published one. */
  preview?: boolean
}

// «Cargar versión» lives on the Versiones page (its button), not in the bar:
// it is an occasional admin task, not a section.
const NAV: { route: Route; href: string; label: string }[] = [
  { route: ROUTES.mapa, href: mapPath(), label: 'Mapa' },
  { route: ROUTES.informes, href: ROUTES.informes, label: 'Informes' },
  { route: ROUTES.versiones, href: ROUTES.versiones, label: 'Versiones' },
]

// The brand mark is Campo Digital's own white logo (the same asset the
// Transelec panel bundles, from campodigital.cl), drawn for this dark bar.
// Its alt text carries the company name; the product and estate stay real
// text beside it.
//
// The map shows the *published* version: the one an operator or admin chose
// with «Publicar» or «Restaurar». Publication is a decision about what the
// panel shows, not a claim that the source is the official estate state.
export function Header({ active, snapshot, preview = false }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__brand">
        <img
          className="header__logo"
          src={campoDigitalLogo}
          alt="Campo Digital"
          width={93}
          height={40}
        />
        <div className="header__context">
          <p className="header__product">Gestión Predial Forestal</p>
          <h1 className="header__title">Patrimonio Degenfeld</h1>
        </div>
        <nav className="header__nav" aria-label="Secciones de Rodales">
          {NAV.map((item) => (
            <a
              key={item.route}
              className="header__nav-link"
              href={item.href}
              aria-current={
                item.route === active ||
                (item.route === ROUTES.informes && active === ROUTES.informe) ||
                (item.route === ROUTES.versiones &&
                  (active === ROUTES.importar || active === ROUTES.revision))
                  ? 'page'
                  : undefined
              }
              onClick={(event) => onLinkClick(event, item.href)}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="header__end">
        {snapshot !== undefined ? (
          <dl
            className="header__provenance"
            title="Versión que muestra el mapa. Publicar una versión no la convierte en el estado oficial del patrimonio."
          >
            <div>
              <dt>{preview ? 'Vista previa' : 'Versión publicada'}</dt>
              <dd>
                N.º {snapshot.shapefile_snapshot_id} · cargada el {formatDate(snapshot.created_at)}
              </dd>
            </div>
          </dl>
        ) : null}
        {/* On the platform, the front door owns sign-in, sign-out and the
            project picker; this is the way back to it. */}
        {platformFrontDoorEnabled() ? (
          <a className="header__projects" href={PLATFORM_FRONT_DOOR_PATH}>
            Proyectos
          </a>
        ) : null}
      </div>
    </header>
  )
}
