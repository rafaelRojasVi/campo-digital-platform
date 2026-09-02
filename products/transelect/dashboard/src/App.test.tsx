import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders placeholder message', () => {
    render(<App />)
    expect(screen.getByText('Transelec demo — under construction')).toBeInTheDocument()
  })
})
