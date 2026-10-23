import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CompositionBar, type CompositionSegment } from './CompositionBar'

const segments = (approved: number, inProgress: number): CompositionSegment[] => [
  { key: 'aprobado', label: 'Aprobado', value: approved, tone: 'approved' },
  { key: 'tramite', label: 'En trámite', value: inProgress, tone: 'progress' },
]

describe('CompositionBar selection', () => {
  it('toggles a segment that narrows the view', async () => {
    const onSelect = vi.fn()
    const { rerender } = render(
      <CompositionBar noun="PMF" segments={segments(3, 2)} onSelect={onSelect} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Aprobado 3' }))
    expect(onSelect).toHaveBeenLastCalledWith('aprobado')

    rerender(
      <CompositionBar
        noun="PMF"
        segments={segments(3, 2)}
        selectedKey="aprobado"
        onSelect={onSelect}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Aprobado 3' }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('does not offer a segment that already holds every item', () => {
    render(<CompositionBar noun="PMF" segments={segments(5, 0)} onSelect={vi.fn()} />)
    const all = screen.getByRole('button', { name: 'Aprobado 5' })
    expect(all).toBeDisabled()
    expect(all).toHaveAttribute('title', 'Ya se muestran todos los PMF')
  })

  it('still lets a selected segment be cleared after the data narrows to it', async () => {
    const onSelect = vi.fn()
    render(
      <CompositionBar
        noun="PMF"
        segments={segments(5, 0)}
        selectedKey="aprobado"
        onSelect={onSelect}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Aprobado 5' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
