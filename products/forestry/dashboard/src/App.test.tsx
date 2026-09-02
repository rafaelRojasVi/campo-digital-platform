import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('Forestry demo App', () => {
  it('renders the DEMO banner and eventually the demo predio KPI strip', async () => {
    render(<App />)
    expect(await screen.findByText(/DATOS DE DEMOSTRACIÓN/i)).toBeInTheDocument()
    expect(screen.getByText('Polígonos de origen')).toBeInTheDocument()
    expect(screen.getByText('predios_demo')).toBeInTheDocument()
  })
})
