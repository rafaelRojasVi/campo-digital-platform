/**
 * `/transelec/versiones` — version history and restore.
 *
 * `GET /transelec/imports` returns one row per activation event
 * (`transelec_publish_event`), not one per import: an import activated twice
 * appears twice, each with its own actor, timestamp and event type. That is
 * the audit trail Javier's current workflow has no equivalent of — rolling
 * back today means re-sending a whole HTML file by hand.
 *
 * Restore is the same activation primitive as publish, recorded with
 * `event_type='restore'`. It never re-validates, because an invalid import
 * can never have been committed in the first place. The confirmation dialog
 * states exactly which import is about to become active again before the
 * mutation fires.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  type TranselecActiveImport,
  type TranselecImportHistoryRow,
  listImportHistory,
  restoreImport,
} from '../api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AlertBanner, LoadingBlock, StateBlock } from '../components/StateViews'
import { formatDateTime, formatInteger, formatNumber, shortHash } from '../format'
import { classifyFailure, type ApiFailure, type FailureView } from '../lib/apiState'
import { Link, ROUTES } from '../router'

export function VersionesPage({
  activeImport,
  onActiveVersionChanged,
}: {
  activeImport: TranselecActiveImport | null
  onActiveVersionChanged: () => void
}) {
  const [history, setHistory] = useState<TranselecImportHistoryRow[] | null>(null)
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [loading, setLoading] = useState(true)
  const [target, setTarget] = useState<TranselecImportHistoryRow | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<FailureView | null>(null)
  const [restored, setRestored] = useState<number | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void listImportHistory().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setHistory(result.data)
        setFailure(null)
      } else {
        setHistory(null)
        setFailure({ status: result.status, error: result.error })
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const confirmRestore = useCallback(async () => {
    if (!target) return
    setRestoring(true)
    setRestoreError(null)
    const result = await restoreImport(target.import_id)
    setRestoring(false)
    if (!result.ok) {
      setRestoreError(classifyFailure(result))
      setTarget(null)
      return
    }
    setRestored(result.data.import_id)
    setTarget(null)
    onActiveVersionChanged()
    setReloadToken((value) => value + 1)
  }, [onActiveVersionChanged, target])

  if (loading && !history) {
    return (
      <div className="shell versions-page">
        <section className="panel section">
          <LoadingBlock label="Cargando el historial de versiones…" lines={3} />
        </section>
      </div>
    )
  }

  if (failure) {
    return (
      <div className="shell versions-page">
        <StateBlock view={classifyFailure(failure)} />
      </div>
    )
  }

  const rows = history ?? []

  return (
    <div className="shell versions-page">
      <section className="panel section">
        <h2>Versiones publicadas</h2>
        <p className="section-note">
          Cada fila es una activación registrada: una publicación o una restauración, con quién la
          hizo y cuándo. Una misma importación puede aparecer más de una vez si volvió a
          activarse. Restaurar no vuelve a validar la planilla — una importación inválida nunca
          llega a existir.
        </p>

        {restored !== null && (
          <AlertBanner tone="ok" title="Versión restaurada">
            La importación #{restored} vuelve a ser la versión activa del panel.
          </AlertBanner>
        )}
        {restoreError && (
          <AlertBanner title={restoreError.title}>{restoreError.message}</AlertBanner>
        )}

        {rows.length === 0 ? (
          <div className="empty" data-testid="versions-empty">
            Todavía no se ha publicado ninguna versión.{' '}
            <Link to={ROUTES.importar}>Importe una planilla</Link> para comenzar.
          </div>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Evento</th>
                  <th scope="col">Importación</th>
                  <th scope="col">Fecha</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Archivo</th>
                  <th scope="col">Huella</th>
                  <th scope="col">Filas</th>
                  <th scope="col">PMF</th>
                  <th scope="col">Superficie</th>
                  <th scope="col">Acción</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.publish_event_id}
                    className={`version-row${row.is_active ? ' active' : ''}`}
                    data-testid={`version-${row.publish_event_id}`}
                  >
                    <td>
                      <span
                        className={`version-badge${row.event_type === 'restore' ? ' restore' : ''}`}
                      >
                        {row.event_type === 'restore' ? 'Restauración' : 'Publicación'}
                      </span>
                    </td>
                    <td>
                      #{row.import_id}
                      {row.is_active && <strong> · activa</strong>}
                    </td>
                    <td>{formatDateTime(row.occurred_at)}</td>
                    <td>{row.actor_display_name ?? `Usuario ${row.actor_app_user_id}`}</td>
                    <td>{row.filename ?? 'Sin nombre registrado'}</td>
                    <td>
                      <code>{shortHash(row.sha256)}…</code>
                    </td>
                    <td className="numeric">{formatInteger(row.business_rows)}</td>
                    <td className="numeric">{formatInteger(row.distinct_pmf)}</td>
                    <td className="numeric">{formatNumber(row.surface_total)} ha</td>
                    <td>
                      <button
                        type="button"
                        className="btn alt"
                        disabled={row.is_active || restoring}
                        onClick={() => {
                          setRestoreError(null)
                          setRestored(null)
                          setTarget(row)
                        }}
                        data-testid={`restore-${row.import_id}`}
                      >
                        {row.is_active ? 'Versión activa' : 'Restaurar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {activeImport && (
        <section className="panel section">
          <h2>Versión activa</h2>
          <div className="summary-grid">
            <div>
              <b>#{activeImport.import_id}</b>
              importación activa
            </div>
            <div>
              <b>{formatInteger(activeImport.business_rows)}</b>
              filas proyectadas
            </div>
            <div>
              <b>{formatInteger(activeImport.distinct_pmf)}</b>
              PMF distintos
            </div>
            <div>
              <b>{formatNumber(activeImport.surface_total)}</b>
              ha de superficie de corta
            </div>
          </div>
          <p className="hint">
            Publicada {formatDateTime(activeImport.published_at)}
            {activeImport.published_by_display_name
              ? ` por ${activeImport.published_by_display_name}`
              : ''}
            {activeImport.published_event_type === 'restore' ? ' (restauración)' : ''} · contrato{' '}
            {activeImport.schema_contract_version} · parser {activeImport.parser_version}
          </p>
        </section>
      )}

      {target && (
        <ConfirmDialog
          title="Restaurar una versión anterior"
          confirmLabel={`Activar la importación #${target.import_id}`}
          busy={restoring}
          tone="danger"
          onConfirm={() => void confirmRestore()}
          onCancel={() => setTarget(null)}
        >
          <p data-testid="restore-confirm-message">
            Está a punto de volver a activar la importación #{target.import_id}. Desde ese momento
            el panel mostrará ese contenido ({formatInteger(target.business_rows)} filas ·{' '}
            {formatInteger(target.distinct_pmf)} PMF · {formatNumber(target.surface_total)} ha) en
            lugar de la versión vigente.
          </p>
          <p>
            La restauración queda registrada con su nombre y la fecha, y puede deshacerse
            volviendo a publicar cualquier otra versión de esta lista.
          </p>
        </ConfirmDialog>
      )}
    </div>
  )
}
