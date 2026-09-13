/**
 * The sign-in panel every deployed build ships: Microsoft Entra ID, the only
 * identity provider outside local development (ADR-006).
 *
 * There is deliberately no fallback here. If the tenant is not configured the
 * panel says so and stops; it never degrades to a demo identity, because
 * outside development no such identity exists on the server either.
 */
import { useCallback, useState } from 'react'
import { ENTRA_LOGIN_PATH, checkEntraSignIn } from '../api'
import { SignInFailure } from './SignInFailure'

function failureMessage(status: number, error: string): string {
  if (status === 503) {
    return 'El inicio de sesión con Microsoft no está configurado en este entorno. Avise al administrador de la plataforma de Campo Digital; no existe otra forma de acceder.'
  }
  return error
}

export function EntraSignIn() {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const signIn = useCallback(async () => {
    setPending(true)
    setFailure(null)

    const result = await checkEntraSignIn()
    if (result.ok) {
      // A full top-level navigation, not a fetch: the OpenID Connect flow has
      // to run in the browser's own address bar so Microsoft can show its
      // sign-in page and post back to /auth/entra/callback.
      window.location.assign(ENTRA_LOGIN_PATH)
      return
    }

    setFailure(failureMessage(result.status, result.error))
    setPending(false)
  }, [])

  return (
    <>
      {failure !== null && <SignInFailure message={failure} onRetry={() => void signIn()} />}

      <div className="login-actions" data-testid="login-actions" aria-busy={pending}>
        <div className="login-action">
          <button type="button" className="btn" disabled={pending} onClick={() => void signIn()}>
            {pending ? 'Redirigiendo a Microsoft…' : 'Continuar con Microsoft'}
          </button>
          <p className="login-action-note">
            Se abrirá el inicio de sesión de Microsoft Entra ID de su organización. Al volver, esta
            página mostrará el seguimiento correspondiente a su cuenta.
          </p>
        </div>
      </div>

      <p className="login-foot">
        El acceso a Transelec se administra con las cuentas corporativas de Microsoft. Si su cuenta
        no tiene permisos sobre este producto, solicítelos al administrador de la plataforma de
        Campo Digital.
      </p>
    </>
  )
}
