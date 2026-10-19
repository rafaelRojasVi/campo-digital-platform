import { describe, expect, it } from 'vitest'
import type { ConafSolicitud } from '../reportsApi'
import {
  conafMessage,
  conafTone,
  freshness,
  normalizeSolicitud,
  rawEstado,
  refreshNotice,
  TONE_LABELS,
} from './conafEstado'

const NOW = new Date('2026-10-16T15:00:00Z')

function record(overrides: Partial<ConafSolicitud> = {}): ConafSolicitud {
  return {
    numero: '090663',
    lookup_status: 'found',
    tipo: 'PLAN DE MANEJO',
    estado: 'EN EVALUACION',
    superficie_ha: 3,
    fecha_ingreso: '2026-09-01',
    fecha_resolucion: null,
    returned_solicitud: null,
    checked_at: '2026-10-16T12:00:00Z',
    found_at: '2026-10-16T12:00:00Z',
    estado_changed_at: null,
    stale: false,
    recently_changed: false,
    conaf_url: 'https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663',
    ...overrides,
  }
}

describe('conafEstado', () => {
  it('normalizes like the server', () => {
    expect(normalizeSolicitud(' 90663 ')).toBe('090663')
    expect(normalizeSolicitud('123456789')).toBe('123456789')
    // CONAF's own slashed numbers, kept as written; a typo is not corrected.
    expect(normalizeSolicitud(' 12/345-6/24 ')).toBe('12/345-6/24')
    expect(normalizeSolicitud('16/345-10-25')).toBeNull()
    expect(normalizeSolicitud('1234567890')).toBeNull()
    expect(normalizeSolicitud(null)).toBeNull()
  })

  it.each([
    ['P.M. APROBADA', 'ok'],
    ['APROBADA', 'ok'],
    ['P.M. APROBADA NO VIGENTE', 'muted'],
    ['EN EVALUACION', 'progress'],
    ['EN TRAMITE', 'progress'],
    ['RECHAZADA', 'danger'],
    ['DENEGADA', 'danger'],
    ['DESISTIDA', 'muted'],
    ['ALGO NUEVO', 'neutral'],
  ])('tone of %s is %s', (estado, tone) => {
    expect(conafTone(record({ estado }))).toBe(tone)
  })

  it('labels every tone with text, not colour alone', () => {
    expect(TONE_LABELS).toEqual({
      ok: 'Aprobada',
      progress: 'En evaluación',
      danger: 'Rechazada',
      muted: 'No vigente',
      neutral: 'Otro estado',
    })
  })

  it('says how fresh the data is', () => {
    expect(freshness(record(), NOW)).toBe('Consultado hace 3 h')
    expect(freshness(record({ checked_at: '2026-10-16T14:58:00Z' }), NOW)).toBe('Consultado hace 2 min')
    expect(freshness(record({ checked_at: '2026-10-16T14:59:40Z' }), NOW)).toBe('Consultado hace un momento')
    expect(freshness(record({ checked_at: '2026-10-13T15:00:00Z' }), NOW)).toBe('Consultado hace 3 días')
  })

  it('explains each non-found result', () => {
    expect(conafMessage(record({ lookup_status: 'not_found', estado: null }))).toBe(
      'CONAF no encuentra esa solicitud.',
    )
    expect(conafMessage(record({ lookup_status: 'mismatch', returned_solicitud: '069025' }))).toBe(
      'CONAF respondió otra solicitud (069025); revise el número.',
    )
    expect(conafMessage(record({ lookup_status: 'unavailable', found_at: null, estado: null }))).toBe(
      'No se pudo consultar CONAF ahora.',
    )
    expect(conafMessage(record({ lookup_status: 'unavailable' }))).toBe(
      'No se pudo actualizar; se muestra el último dato.',
    )
    expect(conafMessage(record())).toBeNull()
  })

  it('hides the raw CONAF text when the label already says it', () => {
    expect(rawEstado(record({ estado: 'APROBADA' }))).toBeNull()
    expect(rawEstado(record({ estado: 'EN EVALUACION' }))).toBeNull()
    expect(rawEstado(record({ estado: 'APROBADA CON OBSERVACIONES' }))).toBe('APROBADA CON OBSERVACIONES')
    expect(rawEstado(record({ estado: 'EN TRAMITE' }))).toBe('EN TRAMITE')
  })

  it('says when a refresh only repeated the stored answer', () => {
    const before = record()
    expect(refreshNotice(before, record({ checked_at: '2026-10-16T14:59:30Z' }))).toBe('Estado actualizado desde CONAF.')
    const recent = record({ checked_at: '2026-10-16T14:59:30Z' })
    expect(refreshNotice(recent, recent, NOW)).toBe('CONAF se consultó hace un momento; se muestra ese resultado.')
    expect(refreshNotice(before, record({ lookup_status: 'unavailable', checked_at: '2026-10-16T14:59:30Z' }))).toBeNull()
  })

  it('never shows a refused approval as approved', () => {
    expect(conafTone(record({ estado: 'DESAPROBADA' }))).toBe('danger')
    expect(conafTone(record({ estado: 'NO APROBADA' }))).toBe('danger')
    expect(conafTone(record({ estado: 'APROBADA' }))).toBe('ok')
  })

  it('says CONAF was busy when the refresh returned an old answer', () => {
    const old = record({ checked_at: '2026-10-13T15:00:00Z' })
    expect(refreshNotice(old, old, NOW)).toBe('CONAF está ocupado; se muestra el último dato.')
    const recent = record({ checked_at: '2026-10-16T14:59:30Z' })
    expect(refreshNotice(recent, recent, NOW)).toBe('CONAF se consultó hace un momento; se muestra ese resultado.')
  })

  it('reads withdrawn or expired solicitudes as no longer in force, not rejected', () => {
    expect(conafTone(record({ estado: 'DESISTIDA' }))).toBe('muted')
    expect(conafTone(record({ estado: 'CADUCADA' }))).toBe('muted')
    expect(conafTone(record({ estado: 'RECHAZADA' }))).toBe('danger')
  })
})
