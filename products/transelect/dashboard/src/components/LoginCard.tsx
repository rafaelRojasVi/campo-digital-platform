/**
 * The unauthenticated screen for `/transelec`.
 *
 * This replaces a generic "Sesión requerida" block that told the visitor to
 * go and sign in somewhere else and come back. It adds no authentication
 * mechanism of its own: every button here drives an endpoint the platform
 * already exposes, and the session it produces is the same HttpOnly
 * `campo_session` cookie every other caller uses. Nothing is written to
 * localStorage, sessionStorage, a readable cookie or this bundle.
 *
 * The two panels are chosen by TWO independent conditions, and both must
 * hold before a demo identity is offered:
 *
 *  1. `import.meta.env.DEV`, written as a literal here so the bundler can
 *     see it. In a `vite build` artifact it folds to `false`, which drops
 *     the entire `DemoSignIn` module — and with it every seeded identity
 *     key — out of the shipped output.
 *  2. `demoAvailable`, the same boundary read through
 *     `src/runtime/environment.ts`, which keeps the decision testable and
 *     keeps the reason for it documented in one place.
 *
 * Neither is the security control. The server is: `POST /auth/dev-login` is
 * mounted only under `APP_ENV == "development"` (apps/api/app/main.py).
 */
import { DemoSignIn } from './DemoSignIn'
import { EntraSignIn } from './EntraSignIn'

export function LoginCard({
  demoAvailable,
  onSignedIn,
}: {
  demoAvailable: boolean
  /** Re-reads the session so the app advances without a browser refresh. */
  onSignedIn: () => void | Promise<void>
}) {
  return (
    <section className="panel login-card" data-testid="login-card" aria-labelledby="login-card-title">
      <p className="login-eyebrow">Campo Digital · Transelec</p>
      <h2 id="login-card-title">Inicie sesión para ver el seguimiento CONAF</h2>
      <p className="login-lead">
        El seguimiento de Planes de Manejo Forestal de Transmisora del Pacífico – Transelec sólo se
        muestra a cuentas autorizadas. Elija cómo desea acceder.
      </p>

      {import.meta.env.DEV && demoAvailable ? (
        <DemoSignIn onSignedIn={onSignedIn} />
      ) : (
        <EntraSignIn />
      )}
    </section>
  )
}
