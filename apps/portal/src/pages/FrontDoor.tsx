import { useEffect, useState } from 'react'
import logo from '../assets/campo-digital-logo-color.jpg'
import { ParticleNetwork } from '../components/ParticleNetwork'
import { ProjectHub } from '../components/ProjectHub'
import { GOOGLE_LOGIN_PATH } from '../data/productCards'
import { devLogin, getMe, logout, type ApiResult, type Me } from '../lib/platformApi'
import '../styles/front-door.css'

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'unreachable' }
  | { kind: 'signed-in'; me: Me }

// 401 is the signed-out state; any other failure is an unreachable platform,
// never a request to sign in.
function sessionState(result: ApiResult<Me>): State {
  if (result.ok) return { kind: 'signed-in', me: result.data }
  return result.status === 401 ? { kind: 'signed-out' } : { kind: 'unreachable' }
}

/**
 * The unified platform's front door: sign in once with Google Workspace, then
 * open a project. It only shows what the session's grants allow; every
 * product still enforces its own access on the server.
 */
export function FrontDoor() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    void getMe().then((result) => {
      if (active) setState(sessionState(result))
    })
    return () => {
      active = false
    }
  }, [])

  const retry = () => {
    setState({ kind: 'loading' })
    void getMe().then((result) => setState(sessionState(result)))
  }

  const [signOutFailed, setSignOutFailed] = useState(false)

  const signInAsDemo = async (identityKey: string) => {
    setState(sessionState(await devLogin(identityKey)))
  }

  // The front door is the only place to sign out, so a failure must be said
  // out loud: on a shared computer "nothing happened" reads as "signed out".
  const signOut = async () => {
    setSignOutFailed(false)
    const result = await logout()
    if (result.ok) setState({ kind: 'signed-out' })
    else setSignOutFailed(true)
  }

  return (
    <div className="door">
      <header className="door__bar">
        <img className="door__logo" src={logo} alt="Campo Digital" width={500} height={168} />
        {state.kind === 'signed-in' ? (
          <div className="door__account">
            <span className="door__user">
              <span className="door__avatar" aria-hidden="true">
                {initials(state.me.display_name)}
              </span>
              <span className="door__user-name">{state.me.display_name}</span>
            </span>
            <button type="button" className="door__signout" onClick={() => void signOut()}>
              Cerrar sesión
            </button>
          </div>
        ) : null}
      </header>
      <main
        className={
          state.kind === 'loading' || state.kind === 'signed-in' || state.kind === 'signed-out'
            ? 'door__main door__main--hub'
            : 'door__main'
        }
      >
        {signOutFailed && state.kind === 'signed-in' ? (
          <p className="door__error" role="alert">
            No se pudo cerrar la sesión. Vuelva a intentarlo o cierre el navegador.
          </p>
        ) : null}
        {state.kind === 'loading' ? (
          <div className="door__stage door__stage--loading">
            <ParticleNetwork />
            <div className="door__loader" role="status" aria-live="polite">
              <span className="door__loader-ring" aria-hidden="true">
                <img src={logo} alt="" width={500} height={168} />
              </span>
              <p>Verificando la sesión…</p>
            </div>
          </div>
        ) : null}
        {state.kind === 'signed-out' ? (
          <div className="door__stage">
            <ParticleNetwork />
            <div className="door__signin">
              <div className="door__intro">
                <p className="door__eyebrow">Campo Digital</p>
                <h1>Plataforma de gestión forestal</h1>
                <p className="door__lead">
                  Seguimiento de planes de manejo, rodales y mediciones en un solo lugar, con una
                  sola cuenta de Campo Digital.
                </p>
                {/* Generic on purpose: nothing about a client shows before sign-in. */}
                <ul className="door__areas" aria-label="Qué reúne la plataforma">
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M7 3h7l4 4v14H7z" />
                      <path d="M14 3v4h4M10 12h5M10 16h5" />
                    </svg>
                    Planes de manejo
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z" />
                      <path d="M9 4v13M15 7v13" />
                    </svg>
                    Rodales y superficies
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="6" cy="16" r="1.4" />
                      <circle cx="10" cy="12" r="1.4" />
                      <circle cx="14" cy="14" r="1.4" />
                      <circle cx="18" cy="8" r="1.4" />
                      <path d="M4 20h16" />
                    </svg>
                    Mediciones LiDAR
                  </li>
                </ul>
                <ul className="door__facts">
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
                    </svg>
                    Cada persona ve solo los proyectos que tiene asignados.
                  </li>
                  <li>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12l4 4 10-10" />
                    </svg>
                    El acceso lo decide el servidor a partir de los permisos de su cuenta.
                  </li>
                </ul>
              </div>

              <section className="door__panel" aria-labelledby="door-signin-title">
                <span className="door__lock" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <rect x="5" y="10.5" width="14" height="10" rx="2" />
                    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <h2 id="door-signin-title">Inicie sesión para continuar</h2>
                <p className="door__muted">
                  Use su cuenta de Google de Campo Digital (@campodigital.cl), o la cuenta de Google
                  que Campo Digital le haya invitado a usar.
                </p>
                {/* Google's own button look (white, the four-colour «G»), which
                    people recognise from every other site that uses it. */}
                <a className="door__google" href={GOOGLE_LOGIN_PATH}>
                  <svg viewBox="0 0 48 48" aria-hidden="true">
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"
                    />
                  </svg>
                  Iniciar sesión con Google
                </a>
                {/* Vite replaces import.meta.env.DEV with false in every build, so
                  these seeded identities exist only in the local dev server;
                  the API also mounts /auth/dev-login only in development. */}
                {import.meta.env.DEV ? (
                  <div className="door__demo">
                    <p className="door__demo-label">Solo en desarrollo local</p>
                    <button
                      type="button"
                      className="door__secondary"
                      onClick={() => void signInAsDemo('dev-admin')}
                    >
                      Entrar como administrador de demostración
                    </button>
                    <button
                      type="button"
                      className="door__secondary"
                      onClick={() => void signInAsDemo('dev-viewer')}
                    >
                      Ver como Javier (solo lectura)
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
            <svg
              className="door__stage-wave"
              viewBox="0 0 1440 80"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M0 48 C 240 8 480 8 720 36 S 1200 72 1440 28 V 80 H 0 Z" />
            </svg>
          </div>
        ) : null}
        {state.kind === 'unreachable' ? (
          <section className="door__panel" role="alert">
            <h1>No se pudo contactar la plataforma</h1>
            <p className="door__muted">Revise su conexión y vuelva a intentarlo.</p>
            <button type="button" className="door__primary" onClick={retry}>
              Reintentar
            </button>
          </section>
        ) : null}
        {state.kind === 'signed-in' ? <ProjectHub me={state.me} /> : null}
      </main>
    </div>
  )
}

/** "Javier Soto" -> "JS", for the account chip. */
function initials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean)
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
}
