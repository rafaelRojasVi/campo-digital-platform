import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../lib/platformApi'
import { FrontDoor } from './FrontDoor'

vi.mock('../lib/platformApi', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    getMe: vi.fn(),
    logout: vi.fn(),
    devLogin: vi.fn(),
    getTranselecHeadline: vi.fn(),
    getRodalesHeadline: vi.fn(),
  }
})

const me = (grants: api.ProductGrant[]): api.ApiResult<api.Me> => ({
  ok: true,
  data: { identity_key: 'sub-1', display_name: 'Javier Soto', product_grants: grants },
})

describe('FrontDoor', () => {
  beforeEach(() => {
    vi.mocked(api.getMe).mockReset()
    vi.mocked(api.logout).mockReset()
    vi.mocked(api.getTranselecHeadline).mockReset()
    vi.mocked(api.getTranselecHeadline).mockResolvedValue({ ok: false, status: 404, error: 'none' })
    vi.mocked(api.getRodalesHeadline).mockReset()
    vi.mocked(api.getRodalesHeadline).mockResolvedValue({ ok: false, status: 404, error: 'none' })
  })

  it('offers Google sign-in when signed out', async () => {
    vi.mocked(api.getMe).mockResolvedValue({ ok: false, status: 401, error: 'no session' })
    render(<FrontDoor />)
    const link = await screen.findByRole('link', { name: 'Iniciar sesión con Google' })
    expect(link).toHaveAttribute('href', '/api/auth/google/login')
  })

  it('introduces the platform beside the sign-in panel, like the Transelec sign-in', async () => {
    vi.mocked(api.getMe).mockResolvedValue({ ok: false, status: 401, error: 'no session' })
    render(<FrontDoor />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Plataforma de gestión forestal' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { level: 2, name: 'Inicie sesión para continuar' }),
    ).toBeInTheDocument()
  })

  it('shows only the projects the user can open', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'transelect', role: 'viewer' }]))
    render(<FrontDoor />)
    expect(await screen.findByText('Hola, Javier')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Transelec/ })).toHaveAttribute('href', '/transelec/')
    expect(screen.queryByText('Rodales')).not.toBeInTheDocument()
  })

  it('links Rodales only for an account holding a forestry grant', async () => {
    vi.mocked(api.getMe).mockResolvedValue(
      me([
        { product_key: 'transelect', role: 'admin' },
        { product_key: 'forestry', role: 'viewer' },
      ]),
    )
    render(<FrontDoor />)
    expect(await screen.findByRole('link', { name: /Rodales/ })).toHaveAttribute(
      'href',
      '/rodales/',
    )
    expect(screen.getByRole('link', { name: /Transelec/ })).toHaveAttribute('href', '/transelec/')
  })

  it('shows a project that is not online yet as upcoming, without a link', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'lidar', role: 'admin' }]))
    render(<FrontDoor />)
    expect(await screen.findByText('Cubicación LiDAR')).toBeInTheDocument()
    expect(screen.getByText('Próximamente')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /LiDAR/ })).not.toBeInTheDocument()
  })

  it('explains an account with no projects', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([]))
    render(<FrontDoor />)
    expect(await screen.findByText(/no tiene proyectos asignados/)).toBeInTheDocument()
  })

  it('reports an unreachable platform instead of asking to sign in', async () => {
    vi.mocked(api.getMe).mockResolvedValue({ ok: false, status: 503, error: 'down' })
    render(<FrontDoor />)
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Iniciar sesión con Google' })).not.toBeInTheDocument()
  })

  it('signs out back to the sign-in view', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'transelect', role: 'viewer' }]))
    vi.mocked(api.logout).mockResolvedValue({ ok: true, data: undefined })
    render(<FrontDoor />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Iniciar sesión con Google' })).toBeInTheDocument(),
    )
  })

  it('says so when signing out fails, and keeps the session view', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'transelect', role: 'viewer' }]))
    vi.mocked(api.logout).mockResolvedValue({ ok: false, status: 503, error: 'down' })
    render(<FrontDoor />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cerrar la sesión')
    expect(screen.getByText('Hola, Javier')).toBeInTheDocument()
  })

  it('offers the seeded demo identities only in the Vite dev server', async () => {
    vi.mocked(api.getMe).mockResolvedValueOnce({ ok: false, status: 401, error: 'no session' })
    vi.mocked(api.devLogin).mockResolvedValue(me([{ product_key: 'transelect', role: 'viewer' }]))
    render(<FrontDoor />)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Ver como Javier (solo lectura)' }),
    )
    expect(api.devLogin).toHaveBeenCalledWith('dev-viewer')
    expect(await screen.findByText('Hola, Javier')).toBeInTheDocument()
  })

  it('compiles the demo identities out of every build', async () => {
    vi.stubEnv('DEV', false)
    try {
      vi.mocked(api.getMe).mockResolvedValue({ ok: false, status: 401, error: 'no session' })
      render(<FrontDoor />)
      await screen.findByRole('link', { name: 'Iniciar sesión con Google' })
      expect(screen.queryByRole('button', { name: /demostración|solo lectura/ })).not.toBeInTheDocument()
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('marks an open project with "Abrir" and keeps its illustration decorative', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'transelect', role: 'viewer' }]))
    const { container } = render(<FrontDoor />)
    const link = await screen.findByRole('link', { name: /Transelec/ })
    expect(link).toHaveTextContent('Abrir')
    expect(screen.getByRole('article', { name: 'Transelec' }).querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('img', { name: /Identidad visual/ })).not.toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it('greets by first name and shows the account and its role', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'transelect', role: 'admin' }]))
    render(<FrontDoor />)
    expect(await screen.findByRole('heading', { name: 'Hola, Javier' })).toBeInTheDocument()
    expect(screen.getByText('Javier Soto')).toBeInTheDocument()
    expect(screen.getByText('JS')).toBeInTheDocument()
    expect(screen.getByText('Administrador')).toBeInTheDocument()
  })

  it("shows the active Transelec import's headline figures", async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'transelect', role: 'viewer' }]))
    vi.mocked(api.getTranselecHeadline).mockResolvedValue({
      ok: true,
      data: {
        pmf_count: 159,
        predio_count: 272,
        surface_total: 164.63,
        aprobados_pmf_count: 120,
        en_tramite_pmf_count: 39,
      },
    })
    render(<FrontDoor />)
    expect(await screen.findByText('planes de manejo')).toBeInTheDocument()
    expect(screen.getByText('159')).toBeInTheDocument()
    expect(screen.getByText('164,6')).toBeInTheDocument()
    expect(screen.getByText('ha de superficie')).toBeInTheDocument()
  })

  it('shows no figures when a product has nothing published', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'forestry', role: 'viewer' }]))
    render(<FrontDoor />)
    await screen.findByRole('heading', { name: 'Rodales' })
    await waitFor(() => expect(api.getRodalesHeadline).toHaveBeenCalled())
    expect(screen.queryByText('rodales')).not.toBeInTheDocument()
  })

  it('never asks for figures of a product the account cannot open', async () => {
    vi.mocked(api.getMe).mockResolvedValue(me([{ product_key: 'transelect', role: 'viewer' }]))
    render(<FrontDoor />)
    await screen.findByRole('heading', { name: 'Transelec' })
    expect(api.getRodalesHeadline).not.toHaveBeenCalled()
  })
})
