import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Hint } from './Hint.tsx'

describe('Hint', () => {
  it('explains on hover and hides again on leave', async () => {
    const user = userEvent.setup()
    render(<Hint text="Qué significa esto" />)

    expect(screen.queryByRole('tooltip')).toBeNull()
    await user.hover(screen.getByRole('button', { name: 'Ayuda' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Qué significa esto')
    await user.unhover(screen.getByRole('button', { name: 'Ayuda' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('does not trigger the click handler of the header it sits in', async () => {
    const user = userEvent.setup()
    const onHeaderClick = vi.fn()
    render(
      <button type="button" onClick={onHeaderClick}>
        Evidencia <Hint text="Ayuda" />
      </button>,
    )

    await user.click(screen.getByRole('button', { name: 'Ayuda' }))
    expect(onHeaderClick).not.toHaveBeenCalled()
  })
})
