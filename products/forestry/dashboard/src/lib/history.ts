/** Undo/redo over immutable snapshots (the report draft is small). */
export const MAX_HISTORY = 100

export interface History<T> {
  past: T[]
  future: T[]
}

export function createHistory<T>(): History<T> {
  return { past: [], future: [] }
}

/** Record `previous` (the state right before a just-applied change). */
export function recordHistory<T>(history: History<T>, previous: T): History<T> {
  return { past: [...history.past, previous].slice(-MAX_HISTORY), future: [] }
}

export function undoHistory<T>(
  history: History<T>,
  current: T,
): { history: History<T>; value: T } | null {
  const value = history.past.at(-1)
  if (value === undefined) return null
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, value }
}

export function redoHistory<T>(
  history: History<T>,
  current: T,
): { history: History<T>; value: T } | null {
  const value = history.future[0]
  if (value === undefined) return null
  return { history: { past: [...history.past, current], future: history.future.slice(1) }, value }
}
