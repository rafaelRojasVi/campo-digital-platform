import { DEV_IDENTITIES } from '../api.ts'
import { ROUTES } from '../router.ts'
import { PLATFORM_FRONT_DOOR_PATH, platformFrontDoorEnabled } from '../runtime/frontDoor.ts'

interface RetryProps {
  onRetry: () => void
}

export function LoadingView({ step }: { step: string }) {
  return (
    <div className="status status--stage" role="status" aria-live="polite">
      <div className="status__stage-inner">
        {/* Stand-mosaic mark: stylised pine trees representing Gestión Predial Forestal. */}
        <svg
          className="status__stage-mark"
          viewBox="0 0 80 64"
          aria-hidden="true"
          focusable="false"
        >
          {/* Left tree — tall pine */}
          <polygon points="16,48 24,48 20,36" fill="rgba(255,255,255,0.55)" />
          <polygon points="14,42 26,42 20,26" fill="rgba(255,255,255,0.75)" />
          <polygon points="12,35 28,35 20,14" fill="rgba(255,255,255,0.95)" />
          <rect x="18" y="48" width="4" height="8" rx="1" fill="rgba(255,255,255,0.4)" />
          {/* Centre tree — tallest */}
          <polygon points="34,50 46,50 40,38" fill="rgba(255,255,255,0.55)" />
          <polygon points="32,44 48,44 40,28" fill="rgba(255,255,255,0.75)" />
          <polygon points="30,37 50,37 40,16" fill="rgba(255,255,255,0.95)" />
          <polygon points="28,30 52,30 40,6" fill="rgba(255,255,255,0.70)" />
          <rect x="38" y="50" width="4" height="8" rx="1" fill="rgba(255,255,255,0.4)" />
          {/* Right tree — medium */}
          <polygon points="54,48 64,48 59,37" fill="rgba(255,255,255,0.50)" />
          <polygon points="52,42 66,42 59,24" fill="rgba(255,255,255,0.70)" />
          <rect x="57" y="48" width="4" height="8" rx="1" fill="rgba(255,255,255,0.35)" />
          {/* Ground line */}
          <rect x="8" y="57" width="64" height="2" rx="1" fill="rgba(255,255,255,0.25)" />
        </svg>
        <h1 className="status__stage-title">Gestión Predial Forestal</h1>
        <p className="status__stage-step">{step}</p>
        <div className="status__stage-dots" aria-hidden="true">
          <span /><span /><span />
        </div>
      </div>
    </div>
  )
}

export function NoSnapshotView({ onRetry, canUpload }: RetryProps & { canUpload: boolean }) {
  return (
    <div className="status">
      <div className="status__card">
        <h1 className="status__title">Sin versión publicada</h1>
        <p className="status__text">
          Todavía no hay una versión de Rodales publicada en la plataforma.
        </p>
        {canUpload ? (
          <p className="status__text status__text--secondary">
            Puede cargar una capa en <a href={ROUTES.importar}>Cargar versión</a>, revisarla y
            publicarla.
          </p>
        ) : null}
        {platformFrontDoorEnabled() || canUpload ? null : (
          <p className="status__text status__text--secondary">
            Para cargar la instantánea real desde la fuente externa, ejecute{' '}
            <code>make forestry-dev</code> en el repositorio.
          </p>
        )}
        <button type="button" className="button" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    </div>
  )
}

export function ErrorView({ message, onRetry }: RetryProps & { message: string }) {
  return (
    <div className="status">
      <div className="status__card">
        <h1 className="status__title">API no disponible</h1>
        <p className="status__text">{message}</p>
        {platformFrontDoorEnabled() ? null : (
          <p className="status__text status__text--secondary">
            Verifique que el servicio backend esté activo (<code>make forestry-status</code>).
          </p>
        )}
        <button type="button" className="button" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    </div>
  )
}

/**
 * No session. On the platform the app redirects to the front door before
 * this renders; a local build offers the development identities instead.
 */
export function SignedOutView({ onDevLogin }: { onDevLogin: (identityKey: string) => void }) {
  return (
    <div className="status">
      <div className="status__card">
        <h1 className="status__title">Inicie sesión</h1>
        {import.meta.env.DEV ? (
          <>
            <p className="status__text">
              Entorno de desarrollo: elija una identidad de prueba.
            </p>
            <div className="status__actions">
              {DEV_IDENTITIES.map((identity) => (
                <button
                  key={identity.identityKey}
                  type="button"
                  className="button"
                  onClick={() => onDevLogin(identity.identityKey)}
                >
                  {identity.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="status__text">Para ver Rodales, inicie sesión en Campo Digital.</p>
            <a className="button" href={PLATFORM_FRONT_DOOR_PATH}>
              Ir al inicio de sesión
            </a>
          </>
        )}
      </div>
    </div>
  )
}

/** Signed in, but the account holds no Rodales grant. */
export function ForbiddenView() {
  return (
    <div className="status">
      <div className="status__card">
        <h1 className="status__title">Sin acceso a Rodales</h1>
        <p className="status__text">
          Su cuenta no tiene acceso a este proyecto. Solicite acceso a un administrador de
          Rodales.
        </p>
        <a className="button" href={PLATFORM_FRONT_DOOR_PATH}>
          Volver a Proyectos
        </a>
      </div>
    </div>
  )
}
