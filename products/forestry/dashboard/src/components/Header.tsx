import { useState } from 'react'
import campoDigitalLogo from '../assets/campo-digital-logo-color.jpg'
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

// The brand mark is Campo Digital's full-colour logo (same asset as
// apps/portal and the Transelec panel), served on a white bar like the
// platform's front door. Alt text carries the company name; product and
// estate stay real text beside it.
//
// The map shows the *published* version: the one an operator or admin chose
// with «Publicar» or «Restaurar». Publication is a decision about what the
// panel shows, not a claim that the source is the official estate state.
export function Header({ active, snapshot, preview = false }: HeaderProps) {
  const [navOpen, setNavOpen] = useState(false)

  return (
    <header className="header">
      <div className="header__brand">
        <img
          className="header__logo"
          src={campoDigitalLogo}
          alt="Campo Digital"
          width={500}
          height={168}
          fetchPriority="high"
          translate="no"
        />
        <div className="header__context">
          <p className="header__product">Rodales</p>
          <p className="header__title">Patrimonio Degenfeld</p>
        </div>
        <nav
          id="header-nav"
          className={`header__nav${navOpen ? ' header__nav--open' : ''}`}
          aria-label="Secciones de Rodales"
        >
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
              onClick={(event) => {
                setNavOpen(false)
                onLinkClick(event, item.href)
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        {/* Hamburger — visible only at small breakpoints. */}
        <button
          type="button"
          className="header__nav-toggle"
          aria-label="Secciones"
          aria-expanded={navOpen}
          aria-controls="header-nav"
          onClick={() => setNavOpen((open) => !open)}
        >
          <svg className="header__menu-icon" viewBox="0 0 22 22" aria-hidden="true">
            <path className="header__menu-icon-top" d="M3 6h16" />
            <path className="header__menu-icon-mid" d="M3 11h16" />
            <path className="header__menu-icon-bottom" d="M3 16h16" />
          </svg>
        </button>
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
            {/* 2×2 grid icon: signals "switch project". */}
            <svg className="header__project-icon" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
              <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
              <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
              <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
            </svg>
            <span className="header__project-label">Proyectos</span>
          </a>
        ) : null}
      </div>
    </header>
  )
}
