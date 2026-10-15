import { useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface HintProps {
  /** Plain-language explanation; line breaks are kept. */
  text: string
}

const TOOLTIP_WIDTH = 280
const GUTTER = 8

/**
 * A small "?" next to a label that explains it on hover or keyboard focus.
 * The tooltip is portalled to <body> with fixed positioning so scrolling
 * tables and the draft panel never clip it.
 */
export function Hint({ text }: HintProps) {
  const id = useId()
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(
    null,
  )

  useLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    if (anchor === null) return
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(TOOLTIP_WIDTH, window.innerWidth - GUTTER * 2)
    const left = Math.min(
      Math.max(GUTTER, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - GUTTER,
    )
    const above = rect.top > window.innerHeight / 2
    setPosition({ left, top: above ? rect.top - GUTTER : rect.bottom + GUTTER, above })
  }, [open])

  return (
    <>
      <span
        ref={anchorRef}
        className="hint"
        tabIndex={0}
        role="button"
        aria-label="Ayuda"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          // Hints sit inside sortable headers and labels; a click should only
          // toggle the explanation (touch screens have no hover).
          event.preventDefault()
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        ?
      </span>
      {open && position !== null
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              className={`hint__tooltip${position.above ? ' hint__tooltip--above' : ''}`}
              style={{ left: position.left, top: position.top, maxWidth: TOOLTIP_WIDTH }}
            >
              {text}
            </span>,
            document.body,
          )
        : null}
    </>
  )
}
