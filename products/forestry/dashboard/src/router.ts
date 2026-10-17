/**
 * Minimal history-based router, the same idea as the Transelec panel's and
 * the portal's (no routing library for four static pages).
 *
 * ROUTES must match RODALES_SPA_PAGE_PATHS in apps/api/app/main.py, so that
 * reloading any page directly gets the app shell instead of a 404
 * (enforced by apps/api/tests/test_dashboard_static.py).
 */
import { useEffect, useState } from 'react'

export const ROUTES = {
  mapa: '/rodales',
  versiones: '/rodales/versiones',
  importar: '/rodales/importar',
  revision: '/rodales/revision',
  informes: '/rodales/informes',
  informe: '/rodales/informes/editar',
} as const

export type Route = (typeof ROUTES)[keyof typeof ROUTES]

export interface Location {
  pathname: string
  search: URLSearchParams
}

function current(): Location {
  const raw = window.location.pathname
  const pathname = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw
  return { pathname, search: new URLSearchParams(window.location.search) }
}

const NAVIGATION_EVENT = 'rodales:navigate'

/**
 * A page with unsaved work (the report editor) registers a guard; every
 * in-app navigation asks it first. `beforeunload` only covers real page
 * unloads, not these history changes.
 */
type LeaveGuard = () => boolean
let leaveGuard: LeaveGuard | null = null

export function setLeaveGuard(guard: LeaveGuard | null): void {
  leaveGuard = guard
}

function mayLeave(): boolean {
  return leaveGuard === null || leaveGuard()
}

function currentHref(): string {
  return `${window.location.pathname}${window.location.search}`
}

let lastHref = typeof window === 'undefined' ? '' : currentHref()

export function navigate(to: string): void {
  if (!mayLeave()) return
  window.history.pushState(null, '', to)
  lastHref = currentHref()
  window.dispatchEvent(new Event(NAVIGATION_EVENT))
  window.scrollTo(0, 0)
}

export function useLocation(): Location {
  const [location, setLocation] = useState(current)

  useEffect(() => {
    const update = () => setLocation(current())
    const onPopState = () => {
      // Back/forward already changed the URL: undo it if the page says stay.
      if (!mayLeave()) {
        window.history.pushState(null, '', lastHref)
        return
      }
      lastHref = currentHref()
      update()
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener(NAVIGATION_EVENT, update)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener(NAVIGATION_EVENT, update)
    }
  }, [])

  return location
}

/** `?version=<id>` as a positive integer, or null. */
export function versionParam(search: URLSearchParams): number | null {
  const raw = search.get('version')
  if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return null
  return Number(raw)
}

/** `?informe=<id>` as a positive integer, or null. */
export function reportParam(search: URLSearchParams): number | null {
  const raw = search.get('informe')
  if (raw === null || !/^[1-9][0-9]*$/.test(raw)) return null
  return Number(raw)
}

export function reportPath(reportId: number): string {
  return `${ROUTES.informe}?informe=${reportId}`
}

export function reviewPath(snapshotId: number): string {
  return `${ROUTES.revision}?version=${snapshotId}`
}

export function mapPath(snapshotId?: number): string {
  return snapshotId === undefined ? `${ROUTES.mapa}/` : `${ROUTES.mapa}/?version=${snapshotId}`
}

/** A plain link that navigates in-app on a normal click, like an <a>. */
export function onLinkClick(event: React.MouseEvent<HTMLAnchorElement>, to: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }
  event.preventDefault()
  navigate(to)
}
