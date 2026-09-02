/**
 * Minimal history-based router.
 *
 * Same shape as apps/portal/src/router/Router.tsx — this platform's frontends
 * deliberately do not carry a routing library for three static routes.
 */
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export const ROUTES = {
  dashboard: '/transelec',
  importar: '/transelec/importar',
  versiones: '/transelec/versiones',
} as const

interface RouterContextValue {
  pathname: string
  navigate: (path: string) => void
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined)

export function RouterProvider({
  children,
  initialPath,
}: {
  children: ReactNode
  initialPath?: string
}) {
  const [pathname, setPathname] = useState(() => initialPath ?? window.location.pathname)

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const value = useMemo<RouterContextValue>(
    () => ({
      pathname,
      navigate: (path: string) => {
        if (path !== window.location.pathname) window.history.pushState({}, '', path)
        setPathname(path)
        window.scrollTo({ top: 0 })
      },
    }),
    [pathname],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterContextValue {
  const context = useContext(RouterContext)
  if (!context) throw new Error('useRouter must be used inside a RouterProvider')
  return context
}

export function Link({
  to,
  children,
  className,
  current,
}: {
  to: string
  children: ReactNode
  className?: string
  current?: boolean
}) {
  const { navigate } = useRouter()
  return (
    <a
      href={to}
      className={className}
      aria-current={current ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return
        event.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

/** Normalize a pathname (trailing slash tolerant) to one of the three routes. */
export function resolveRoute(pathname: string): (typeof ROUTES)[keyof typeof ROUTES] {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  if (normalized === ROUTES.importar) return ROUTES.importar
  if (normalized === ROUTES.versiones) return ROUTES.versiones
  return ROUTES.dashboard
}
