import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('App demo banner', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CAMPO_DEMO', 'true')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('renders a DEMO banner when VITE_CAMPO_DEMO=true', async () => {
    const { default: App } = await import('./App')
    render(<App />)
    expect(await screen.findByText(/DATOS DE DEMOSTRACIÓN/i)).toBeInTheDocument()
  })
})
