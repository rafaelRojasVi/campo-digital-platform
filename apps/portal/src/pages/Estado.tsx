import { MODULES } from '../data/modules'
import { Link } from '../router/Router'
import { moduleStatusFor } from '../runtime/runtimeConfig'
import { useRuntimeConfig } from '../runtime/useRuntimeConfig'

export function Estado() {
  const { config, loading } = useRuntimeConfig()

  return (
    <div className="estado">
      <p>
        <Link to="/">← Campo Digital</Link>
      </p>
      <h1>Estado del entorno local</h1>
      <p className="estado__note">
        Vista de diagnóstico para desarrollo. No representa disponibilidad en producción.
      </p>

      {loading ? (
        <p>Cargando…</p>
      ) : (
        <table className="estado__table">
          <thead>
            <tr>
              <th>Módulo</th>
              <th>Estado</th>
              <th>URL local</th>
              <th>Iniciado por Campo Demo</th>
            </tr>
          </thead>
          <tbody>
            {MODULES.map((module) => {
              const status = moduleStatusFor(config, module.id)
              return (
                <tr key={module.id}>
                  <td>{module.title}</td>
                  <td>{status.status}</td>
                  <td>
                    <code>{status.url ?? '—'}</code>
                  </td>
                  <td>{status.owned === undefined ? '—' : status.owned ? 'sí' : 'no (ya estaba activo)'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="estado__generated">
        Generado: <code>{config.generatedAt ?? '—'}</code>
      </p>
    </div>
  )
}
