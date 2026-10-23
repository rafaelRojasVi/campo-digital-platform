/**
 * The teal band under the bar: whose programme this is, and which published
 * version every number below comes from.
 *
 * It replaces the Resumen's grey context strip and carries the same facts on
 * every section, in the look of the platform's front door and campodigital.cl
 * (teal ground, faint contour lines, a wavy lower edge). It stays one short
 * band so the first numbers remain in the first screen.
 */
import type { TranselecActiveImport } from '../api'
import { formatDateTime } from '../format'

export function PageBand({ activeImport }: { activeImport: TranselecActiveImport | null }) {
  return (
    <div className="page-band">
      <div className="page-band-inner">
        <p className="page-band-client">Transmisora del Pacífico – Transelec</p>
        <h1 className="page-band-title">Seguimiento de Planes de Manejo Forestal</h1>
        <p className="page-band-version">
          {activeImport ? (
            <>
              Versión #{activeImport.import_id}, publicada{' '}
              {formatDateTime(activeImport.published_at)}
              {activeImport.published_by_display_name
                ? ` por ${activeImport.published_by_display_name}`
                : ''}
            </>
          ) : (
            'Sin versión publicada'
          )}
        </p>
      </div>
      <svg
        className="page-band-wave"
        viewBox="0 0 1440 40"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M0 26 C 240 4 480 4 720 20 S 1200 38 1440 14 V 40 H 0 Z" />
      </svg>
    </div>
  )
}
