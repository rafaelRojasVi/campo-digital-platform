import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouterProvider } from '../router/Router'
import { ModulePage } from './Module'

function mockRuntimeFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ModulePage', () => {
  it('renders an iframe pointed at the loopback URL when the module is available', async () => {
    mockRuntimeFetch({
      modules: { forestal: { status: 'available', url: 'http://127.0.0.1:5175/', owned: true } },
    })

    render(
      <RouterProvider>
        <ModulePage moduleId="forestal" />
      </RouterProvider>,
    )

    const frame = await screen.findByTitle('Gestión Predial Forestal')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', 'http://127.0.0.1:5175/')
  })

  it('shows a friendly "demo no iniciada" state, never a raw connection error, when unavailable', async () => {
    mockRuntimeFetch({ modules: { forestal: { status: 'unavailable' } } })

    render(
      <RouterProvider>
        <ModulePage moduleId="forestal" />
      </RouterProvider>,
    )

    expect(await screen.findByText('Demo no iniciada.')).toBeInTheDocument()
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument()
  })

  it('refuses to render an iframe for an unsafe or non-loopback URL even if marked available', async () => {
    mockRuntimeFetch({
      modules: { forestal: { status: 'available', url: 'javascript:alert(1)' } },
    })

    render(
      <RouterProvider>
        <ModulePage moduleId="forestal" />
      </RouterProvider>,
    )

    expect(await screen.findByText('Demo no iniciada.')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('renders a fallback for an unknown module id instead of crashing', () => {
    mockRuntimeFetch({ modules: {} })

    render(
      <RouterProvider>
        <ModulePage moduleId="not-a-real-module" />
      </RouterProvider>,
    )

    expect(screen.getByText('Módulo desconocido.')).toBeInTheDocument()
  })
})
