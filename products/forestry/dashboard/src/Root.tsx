/**
 * Resolves the viewer's Rodales role once, then routes between the map and
 * the version pages. Access is enforced by the API on every call; the role
 * here only decides which links to offer.
 */
import { useCallback, useEffect, useState } from 'react'
import App from './App.tsx'
import { ApiError, SESSION_EXPIRED_EVENT, devLogin, fetchForestryRole } from './api.ts'
import { ErrorView, ForbiddenView, LoadingView, SignedOutView } from './components/StatusViews.tsx'
import { ImportarPage } from './pages/ImportarPage.tsx'
import { InformeEditorPage } from './pages/InformeEditorPage.tsx'
import { InformePrintPage } from './pages/InformePrintPage.tsx'
import { InformesPage } from './pages/InformesPage.tsx'
import { RevisionPage } from './pages/RevisionPage.tsx'
import { VersionesPage } from './pages/VersionesPage.tsx'
import { ROUTES, reportParam, useLocation, versionParam } from './router.ts'
import { PLATFORM_FRONT_DOOR_PATH, platformFrontDoorEnabled } from './runtime/frontDoor.ts'
import type { ForestryRole } from './types.ts'

type Access =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'error' }
  | { status: 'ready'; role: ForestryRole | null }

export default function Root() {
  const location = useLocation()
  const [access, setAccess] = useState<Access>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchForestryRole()
      .then((role) => {
        if (!cancelled) setAccess({ status: 'ready', role })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        if (error instanceof ApiError && error.status === 401) {
          if (platformFrontDoorEnabled()) {
            window.location.assign(PLATFORM_FRONT_DOOR_PATH)
            return
          }
          setAccess({ status: 'signed-out' })
        } else {
          setAccess({ status: 'error' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [nonce])

  useEffect(() => {
    const onExpired = () => {
      if (platformFrontDoorEnabled()) {
        window.location.assign(PLATFORM_FRONT_DOOR_PATH)
        return
      }
      setAccess({ status: 'signed-out' })
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  const retry = useCallback(() => setNonce((n) => n + 1), [])
  const handleDevLogin = useCallback((identityKey: string) => {
    void devLogin(identityKey)
      .catch(() => undefined)
      .finally(() => setNonce((n) => n + 1))
  }, [])

  if (access.status === 'loading') return <LoadingView step="Conectando con la plataforma…" />
  if (access.status === 'signed-out') return <SignedOutView onDevLogin={handleDevLogin} />
  if (access.status === 'error') {
    return <ErrorView message="No fue posible verificar su acceso." onRetry={retry} />
  }
  if (access.role === null) return <ForbiddenView />

  const { role } = access
  switch (location.pathname) {
    case ROUTES.versiones:
      return <VersionesPage role={role} search={location.search} />
    case ROUTES.importar:
      return <ImportarPage role={role} />
    case ROUTES.revision:
      return (
        <RevisionPage
          key={location.search.toString()}
          role={role}
          versionId={versionParam(location.search)}
          uploadStatus={location.search.get('cargada')}
        />
      )
    case ROUTES.informes:
      return <InformesPage role={role} />
    case ROUTES.informe:
      return (
        <InformeEditorPage
          key={location.search.toString()}
          role={role}
          reportId={reportParam(location.search)}
        />
      )
    case ROUTES.imprimir:
      return <InformePrintPage key={location.search.toString()} reportId={reportParam(location.search)} />
    default:
      return (
        <App
          key={`${nonce}-${location.search.get('version') ?? ''}`}
          role={role}
          versionId={versionParam(location.search)}
        />
      )
  }
}
