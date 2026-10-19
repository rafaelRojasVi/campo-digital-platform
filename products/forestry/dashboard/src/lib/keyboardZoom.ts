import type L from 'leaflet'

// Ctrl/Cmd + «+» and Ctrl/Cmd + «−» zoom the map, not the page, while the
// pointer is over the map or focus is inside it. Elsewhere the browser keeps
// its own page zoom, which people rely on to read the screen.

/** +1 to zoom in, -1 to zoom out, 0 for any other key. */
export function keyboardZoomStep(event: KeyboardEvent): -1 | 0 | 1 {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return 0
  if (event.code === 'NumpadAdd' || event.key === '+' || event.key === '=') return 1
  if (event.code === 'NumpadSubtract' || event.key === '-' || event.key === '_') return -1
  return 0
}

/** Wire the shortcut to one Leaflet map; returns the cleanup. */
export function installKeyboardZoom(map: L.Map): () => void {
  const container = map.getContainer()
  let hovered = false
  const enter = () => {
    hovered = true
  }
  const leave = () => {
    hovered = false
  }
  const keydown = (event: KeyboardEvent) => {
    const step = keyboardZoomStep(event)
    if (step === 0) return
    if (!hovered && !container.contains(document.activeElement)) return
    event.preventDefault()
    if (step > 0) map.zoomIn()
    else map.zoomOut()
  }
  container.addEventListener('pointerenter', enter)
  container.addEventListener('pointerleave', leave)
  document.addEventListener('keydown', keydown)
  return () => {
    container.removeEventListener('pointerenter', enter)
    container.removeEventListener('pointerleave', leave)
    document.removeEventListener('keydown', keydown)
  }
}
