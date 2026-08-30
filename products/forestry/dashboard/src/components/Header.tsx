import { formatDate, shortFingerprint } from '../lib/format.ts'
import type { ForestrySnapshot, SnapshotSummary } from '../types.ts'

interface HeaderProps {
  snapshot: ForestrySnapshot
  summary: SnapshotSummary
}

// The provenance block deliberately says "última ingesta": the API only
// establishes ingestion order, never that this snapshot is the officially
// current ("vigente") state of the estate.
export function Header({ snapshot, summary }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="26" height="26" role="presentation">
            <rect width="32" height="32" rx="6" fill="#2f6b4f" />
            <path d="M16 5l7 10h-4.4l4.9 7H8.5l4.9-7H9z" fill="#fcfcf9" />
            <rect x="14.8" y="22" width="2.4" height="5" fill="#fcfcf9" />
          </svg>
        </span>
        <div>
          <p className="header__product">Campo Digital · Gestión Predial Forestal</p>
          <h1 className="header__title">Patrimonio Degenfeld</h1>
        </div>
      </div>

      <dl
        className="header__provenance"
        title="Instantánea más reciente ingerida en la plataforma. No implica que sea la versión oficial vigente del patrimonio."
      >
        <div>
          <dt>Última ingesta</dt>
          <dd>{formatDate(snapshot.created_at)}</dd>
        </div>
        <div>
          <dt>Capa de origen</dt>
          <dd>{snapshot.layer_name}</dd>
        </div>
        <div>
          <dt>CRS almacenado</dt>
          <dd>EPSG:{summary.storage_srid}</dd>
        </div>
        <div>
          <dt>Huella de familia</dt>
          <dd>
            <code>{shortFingerprint(snapshot.family_fingerprint)}</code>
          </dd>
        </div>
      </dl>
    </header>
  )
}
