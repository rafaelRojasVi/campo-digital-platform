/**
 * The teal band under the header on document-style pages (Versiones,
 * Informes, Importar, Revisión). It carries the estate name and the
 * current snapshot's provenance — the same facts the dark header's title
 * used to carry, now moved into this band so the header stays a clean
 * white bar on every page.
 *
 * Map pages (App.tsx) skip this band: the map must fill the first screen,
 * so the header is the only chrome.
 */
import type { ForestrySnapshot } from '../types.ts'
import { formatDate } from '../lib/format.ts'

export function PageBand({ snapshot }: { snapshot?: ForestrySnapshot }) {
  return (
    <div className="page-band">
      <div className="page-band-inner">
        <p className="page-band-client">Patrimonio Degenfeld</p>
        <h1 className="page-band-title">Rodales</h1>
        {snapshot ? (
          <p className="page-band-version">
            Versión N.º {snapshot.shapefile_snapshot_id} · cargada el{' '}
            {formatDate(snapshot.created_at)}
          </p>
        ) : (
          <p className="page-band-version">Gestión Predial Forestal</p>
        )}
      </div>
      <svg
        className="page-band-wave"
        viewBox="0 0 1440 24"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0 16 C 240 2 480 2 720 12 S 1200 22 1440 8 V 24 H 0 Z" />
      </svg>
    </div>
  )
}
