/**
 * A small «?» beside a heading or a term, holding an explanation that used to
 * sit under it as a paragraph.
 *
 * Hover or keyboard focus shows it; a click or tap pins it open (touch has no
 * hover); Escape, a second click or a click elsewhere closes it. The text
 * stays in the DOM while closed (hidden attr + aria-describedby), so a screen
 * reader hears it on focus and printing the page can show it. Near the right
 * edge it opens leftwards.
 */
import type { ReactNode } from 'react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

export function HelpBubble({
  label,
  children,
}: {
  /** What the bubble explains, for the button's accessible name. */
  label: string
  children: ReactNode
}) {
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [alignEnd, setAlignEnd] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const id = useId()
  const open = pinned || hovered || focused

  // Near the right edge the bubble opens leftwards instead of overflowing.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return
    const { left } = wrapRef.current.getBoundingClientRect()
    setAlignEnd(left + 300 > window.innerWidth)
  }, [open])

  useEffect(() => {
    if (!pinned) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      if (event instanceof MouseEvent && wrapRef.current?.contains(event.target as Node)) return
      setPinned(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('mousedown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('mousedown', close)
    }
  }, [pinned])

  return (
    <span
      ref={wrapRef}
      className="help"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="help-trigger"
        aria-label={`Más información: ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onClick={(event) => {
          // HelpBubble may sit inside a header button or other interactive
          // element; a click should toggle only this explanation.
          event.stopPropagation()
          setPinned((value) => !value)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setPinned(false)
            setFocused(false)
          }
        }}
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={`help-bubble${open ? ' open' : ''}${alignEnd ? ' end' : ''}`}
        hidden={!open}
      >
        {children}
      </span>
    </span>
  )
}
