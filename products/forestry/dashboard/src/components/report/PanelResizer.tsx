/**
 * The edge between the report panel and the map: drag it (or use ← → when
 * focused) to change the panel's width; the button on it collapses the
 * panel to a thin rail so the map takes the screen.
 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Icon } from './Icon.tsx'

export const PANEL_MIN = 380
export const PANEL_MAX = 960
const STEP = 40

function clamp(width: number): number {
  const max = Math.min(PANEL_MAX, Math.max(PANEL_MIN, window.innerWidth - 360))
  return Math.round(Math.min(max, Math.max(PANEL_MIN, width)))
}

export function PanelResizer({
  width,
  onWidth,
  onCollapse,
}: {
  width: number
  onWidth: (width: number) => void
  onCollapse: () => void
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button') !== null) return
    drag.current = { startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('is-resizing')
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return
    onWidth(clamp(drag.current.startWidth + event.clientX - drag.current.startX))
  }
  const onPointerUp = () => {
    drag.current = null
    document.body.classList.remove('is-resizing')
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') onWidth(clamp(width - STEP))
    else if (event.key === 'ArrowRight') onWidth(clamp(width + STEP))
    else if (event.key === 'Home') onWidth(PANEL_MIN)
    else if (event.key === 'End') onWidth(clamp(PANEL_MAX))
    else return
    event.preventDefault()
  }

  return (
    <div
      className="panel-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del panel del informe"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      title="Arrastre para cambiar el ancho · doble clic: ancho normal"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onWidth(clamp(600))}
      onKeyDown={onKeyDown}
    >
      <span className="panel-resizer__grip" aria-hidden="true" />
      <button
        type="button"
        className="panel-resizer__collapse"
        onClick={onCollapse}
        aria-label="Ocultar el panel del informe"
        title="Ocultar el panel"
      >
        <Icon name="panelClose" size={16} />
      </button>
    </div>
  )
}
