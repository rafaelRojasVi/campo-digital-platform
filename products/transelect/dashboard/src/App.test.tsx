import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Transelec demo App', () => {
  it('renders the DEMO banner and the demo PMF list', async () => {
    render(<App />)
    expect(screen.getByText(/DATOS DE DEMOSTRACIÓN/i)).toBeInTheDocument()
    // PmfExplorer renders the visible table plus a hidden print-only
    // duplicate, so a PMF id legitimately appears more than once.
    const matches = await screen.findAllByText('PMF-DEMO-01')
    expect(matches.length).toBeGreaterThan(0)
  })
})
