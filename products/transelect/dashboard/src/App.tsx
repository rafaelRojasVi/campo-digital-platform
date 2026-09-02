import { useCallback, useEffect, useState } from 'react'
import {
  type Me,
  type TranselecActiveImport,
  canPublish as canPublishFor,
  getActiveImport,
  getMe,
} from './api'
import { AppHeader } from './components/AppHeader'
import { LoadingBlock, StateBlock } from './components/StateViews'
import { classifyFailure, type ApiFailure } from './lib/apiState'
import { DashboardPage } from './pages/DashboardPage'
import { ImportarPage } from './pages/ImportarPage'
import { VersionesPage } from './pages/VersionesPage'
import { ROUTES, RouterProvider, resolveRoute, useRouter } from './router'

function Shell() {
  const { pathname } = useRouter()
  const route = resolveRoute(pathname)

  const [me, setMe] = useState<Me | null>(null)
  const [sessionFailure, setSessionFailure] = useState<ApiFailure | null>(null)
  const [sessionLoading, setSessionLoading] = useState(true)

  const [activeImport, setActiveImport] = useState<TranselecActiveImport | null>(null)
  const [provenanceVersion, setProvenanceVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    void getMe().then((result) => {
      if (cancelled) return
      if (result.ok) {
        setMe(result.data)
        setSessionFailure(null)
      } else {
        setMe(null)
        setSessionFailure({ status: result.status, error: result.error })
      }
      setSessionLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Active-version provenance: refetched whenever a publish or restore in
  // this session changes which import is active, so the header stamp and the
  // footer never show a version that is no longer live. Gated on a confirmed
  // session so an unauthenticated visitor produces exactly one 401 (the
  // session check itself) rather than a burst of them.
  useEffect(() => {
    if (!me) {
      setActiveImport(null)
      return
    }
    let cancelled = false
    void getActiveImport().then((result) => {
      if (cancelled) return
      setActiveImport(result.ok ? result.data : null)
    })
    return () => {
      cancelled = true
    }
  }, [me, provenanceVersion])

  const onActiveVersionChanged = useCallback(() => {
    setProvenanceVersion((value) => value + 1)
  }, [])

  const publisher = canPublishFor(me)

  const body = () => {
    if (sessionLoading) {
      return (
        <div className="shell">
          <section className="panel section">
            <LoadingBlock label="Verificando la sesión…" lines={2} />
          </section>
        </div>
      )
    }

    if (sessionFailure) {
      return (
        <div className="shell">
          <StateBlock view={classifyFailure(sessionFailure)} />
        </div>
      )
    }

    if ((route === ROUTES.importar || route === ROUTES.versiones) && !publisher) {
      return (
        <div className="shell">
          <StateBlock
            view={{
              kind: 'forbidden',
              title: 'Sin autorización',
              message:
                'Sólo las cuentas con rol de operador o administrador sobre Transelec pueden importar planillas o cambiar la versión publicada. Su cuenta puede consultar el panel.',
            }}
          />
        </div>
      )
    }

    if (route === ROUTES.importar) {
      return <ImportarPage onActiveVersionChanged={onActiveVersionChanged} />
    }

    if (route === ROUTES.versiones) {
      return (
        <VersionesPage
          activeImport={activeImport}
          onActiveVersionChanged={onActiveVersionChanged}
        />
      )
    }

    return <DashboardPage activeImport={activeImport} canPublish={publisher} />
  }

  return (
    <>
      <AppHeader
        me={me}
        activeImport={activeImport}
        currentPath={route}
        canPublish={publisher}
      />
      {body()}
    </>
  )
}

export default function App({ initialPath }: { initialPath?: string } = {}) {
  return (
    <RouterProvider initialPath={initialPath}>
      <Shell />
    </RouterProvider>
  )
}
