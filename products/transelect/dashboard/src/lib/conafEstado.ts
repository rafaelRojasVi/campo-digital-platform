/**
 * Estado CONAF, as the dashboard shows it: a tone with a text label (never
 * colour alone), how fresh the read is, and a plain message for every
 * result that is not a found solicitud. Same logic as Rodales' copy; the
 * products stay separate packages.
 */
import type { ConafSolicitud } from '../api'

export type ConafTone = 'ok' | 'progress' | 'danger' | 'muted' | 'neutral'

export const TONE_LABELS: Record<ConafTone, string> = {
  ok: 'Aprobada',
  progress: 'En evaluación',
  danger: 'Rechazada',
  muted: 'No vigente',
  neutral: 'Otro estado',
}

/** Transelec's existing status pills, by tone. */
export const TONE_PILL: Record<ConafTone, string> = {
  ok: 'pill-aprobado',
  progress: 'pill-en-tramite',
  danger: 'pill-pendiente',
  muted: 'pill-tachado',
  neutral: 'pill-otro',
}

/** 1–9 ASCII digits, padded to six (the server's rule); otherwise null. */
export function normalizeSolicitud(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!/^[0-9]{1,9}$/.test(value)) return null
  return value.padStart(6, '0')
}

export function conafTone(record: ConafSolicitud): ConafTone {
  const estado = (record.estado ?? '').toUpperCase()
  if (/NO VIGENTE|DESIST|CADUC/.test(estado)) return 'muted'
  if (/RECHAZ|DENEG|DESAPROB|\bNO APROB/.test(estado)) return 'danger'
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

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}

/** CONAF's own text, unless the tone label already says the same. */
export function rawEstado(record: ConafSolicitud): string | null {
  if (record.estado === null) return null
  return plain(record.estado) === plain(TONE_LABELS[conafTone(record)]) ? null : record.estado
}

/**
 * The notice after «Actualizar». An unchanged `checked_at` means the server
 * answered from storage: within its 60 s guard, or because CONAF was busy.
 */
export function refreshNotice(
  before: ConafSolicitud | null,
  after: ConafSolicitud,
  now: Date = new Date(),
): string | null {
  if (after.lookup_status !== 'found') return null
  if (before !== null && before.checked_at === after.checked_at) {
    const age = now.getTime() - new Date(after.checked_at).getTime()
    return age <= 90_000
      ? 'CONAF se consultó hace un momento; se muestra ese resultado.'
      : 'CONAF está ocupado; se muestra el último dato.'
  }
  return 'Estado actualizado desde CONAF.'
}
