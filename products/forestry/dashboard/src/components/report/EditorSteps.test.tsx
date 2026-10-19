import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { EditorStep } from '../../lib/editorSteps.ts'
import { EditorSteps } from './EditorSteps.tsx'

function Harness() {
  const [step, setStep] = useState<EditorStep>('rodales')
  return <EditorSteps step={step} onChange={setStep} />
}

describe('EditorSteps', () => {
  it('shows the three steps in order with the current one selected', () => {
    render(<Harness />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['1Rodales', '2Planificación', '3Exportar'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('moves between steps with the arrow keys, wrapping around', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('tab', { name: /Rodales/ }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: /Planificación/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Planificación/ })).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /Exportar/ })).toHaveAttribute('aria-selected', 'true')
  })
})
