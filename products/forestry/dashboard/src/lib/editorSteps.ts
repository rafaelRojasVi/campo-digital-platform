/** The report editor's steps and their place in the URL (?paso=). */

export type EditorStep = 'rodales' | 'planificacion' | 'exportar'

export const EDITOR_STEPS: readonly { id: EditorStep; label: string }[] = [
  { id: 'rodales', label: 'Rodales' },
  { id: 'planificacion', label: 'Planificación' },
  { id: 'exportar', label: 'Exportar' },
]

const STEP_PARAM = 'paso'

/** The step named in the URL (?paso=), so a reload or a shared link keeps it. */
export function stepFromUrl(): EditorStep {
  const value = new URL(window.location.href).searchParams.get(STEP_PARAM)
  return EDITOR_STEPS.some((step) => step.id === value) ? (value as EditorStep) : 'rodales'
}

export function writeStepToUrl(step: EditorStep): void {
  const url = new URL(window.location.href)
  if (step === 'rodales') url.searchParams.delete(STEP_PARAM)
  else url.searchParams.set(STEP_PARAM, step)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`)
}
