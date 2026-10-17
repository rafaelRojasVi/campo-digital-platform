/**
 * Estado CONAF, as the dashboard shows it: a tone with a text label (never
 * colour alone), how fresh the read is, and a plain message for every
 * result that is not a found solicitud. Same logic as Transelec's copy; the
 * products stay separate packages.
 */
import type { ConafSolicitud } from '../reportsApi'

export type ConafTone = 'ok' | 'progress' | 'danger' | 'muted' | 'neutral'

export const TONE_LABELS: Record<ConafTone, string> = {
  ok: 'Aprobada',
  progress: 'En evaluación',
  danger: 'Rechazada',
  muted: 'No vigente',
  neutral: 'Otro estado',
}

/** Rodales pill classes (reports.css), by tone. */
export const TONE_PILL: Record<ConafTone, string> = {
  ok: 'conaf-pill conaf-pill--ok',
  progress: 'conaf-pill conaf-pill--progress',
  danger: 'conaf-pill conaf-pill--danger',
  muted: 'conaf-pill conaf-pill--muted',
  neutral: 'conaf-pill conaf-pill--neutral',
}

/** 1–9 ASCII digits, padded to six (the server's rule); otherwise null. */
export function normalizeSolicitud(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!/^[0-9]{1,9}$/.test(value)) return null
  return value.padStart(6, '0')
}

export function conafTone(record: ConafSolicitud): ConafTone {
  const estado = (record.estado ?? '').toUpperCase()
  if (estado.includes('NO VIGENTE')) return 'muted'
  if (/RECHAZ|DENEG|DESIST|CADUC/.test(estado)) return 'danger'
  if (estado.includes('APROB')) return 'ok'
  if (/EVALUAC|TRAMIT|INGRES|REVISI|RECURSO/.test(estado)) return 'progress'
  return 'neutral'
}

export function freshness(record: ConafSolicitud, now: Date = new Date()): string {
  const seconds = Math.max(0, (now.getTime() - new Date(record.checked_at).getTime()) / 1000)
  if (seconds < 60) return 'Consultado hace un momento'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Consultado hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `Consultado hace ${hours} h`
  return `Consultado hace ${Math.floor(hours / 24)} días`
}

export function hasData(record: ConafSolicitud): boolean {
  return record.found_at !== null && record.estado !== null
}

export function conafMessage(record: ConafSolicitud): string | null {
  switch (record.lookup_status) {
    case 'not_found':
      return 'CONAF no encuentra esa solicitud.'
    case 'mismatch':
      return `CONAF respondió otra solicitud (${record.returned_solicitud ?? '?'}); revise el número.`
    case 'unavailable':
      return hasData(record)
        ? 'No se pudo actualizar; se muestra el último dato.'
        : 'No se pudo consultar CONAF ahora.'
    default:
      return null
  }
}
