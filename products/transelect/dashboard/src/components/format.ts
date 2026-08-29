export const numberFormatter = new Intl.NumberFormat('es-CL')

export const surfaceFormatter = new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
})

const dateFormatter = new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const dateOnlyFormatter = new Intl.DateTimeFormat('es-CL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed)
}

export function formatDateOnly(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : dateOnlyFormatter.format(parsed)
}

export function statusTone(status: string): string {
  const normalized = status.toLocaleLowerCase('es-CL')
  if (normalized.includes('aprobad') || normalized.includes('finaliz')) return 'positive'
  if (normalized.includes('rechaz')) return 'negative'
  if (normalized.includes('observ') || normalized.includes('reingres')) return 'warning'
  if (normalized.includes('tramit') || normalized.includes('revis')) return 'info'
  return 'neutral'
}

// Mirrors the literal colors used by .status-dot/.status-pill in App.css so the
// status-distribution chart never invents a color scheme separate from the
// table/pill tone semantics already established.
export const TONE_HEX: Record<string, string> = {
  positive: '#198b68',
  negative: '#b33b31',
  warning: '#c27b25',
  info: '#2866c7',
  neutral: '#82909a',
}

export function toneColor(status: string): string {
  return TONE_HEX[statusTone(status)] ?? TONE_HEX.neutral
}
