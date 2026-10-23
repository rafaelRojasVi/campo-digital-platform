import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HelpBubble } from './HelpBubble.tsx'

describe('HelpBubble', () => {
  it('shows the bubble on hover and hides it again on leave', async () => {
    const user = userEvent.setup()
    render(<HelpBubble label="Rodal">Qué es un rodal</HelpBubble>)

    expect(screen.queryByRole('tooltip')).toBeNull()
    await user.hover(screen.getByRole('button', { name: 'Más información: Rodal' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Qué es un rodal')
    await user.unhover(screen.getByRole('button', { name: 'Más información: Rodal' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('pins the bubble open on click then closes when the mouse leaves', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <HelpBubble label="Rodal">Definición del rodal</HelpBubble>
        <button type="button">otro</button>
      </div>,
    )

    const trigger = screen.getByRole('button', { name: 'Más información: Rodal' })
    // Click pins the bubble.
    await user.click(trigger)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    // A click elsewhere unpins it and the mouseout clears hover → hidden.
    await user.click(screen.getByRole('button', { name: 'otro' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('closes on Escape when pinned', async () => {
    const user = userEvent.setup()
    render(<HelpBubble label="Rodal">Definición</HelpBubble>)

    const trigger = screen.getByRole('button', { name: 'Más información: Rodal' })
    await user.click(trigger)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    // Move focus off the trigger so hover state clears, then press Escape.
    await user.unhover(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('does not bubble up a click to a parent button', async () => {
    const user = userEvent.setup()
    const parentClick = vi.fn()
    render(
      <button type="button" onClick={parentClick}>
        Heading
        <HelpBubble label="Rodal">Definición</HelpBubble>
      </button>,
    )

    await user.click(screen.getByRole('button', { name: 'Más información: Rodal' }))
    expect(parentClick).not.toHaveBeenCalled()
  })
})
