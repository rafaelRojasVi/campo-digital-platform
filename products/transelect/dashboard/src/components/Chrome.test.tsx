/**
 * Chrome-level components: header/brand (041), notice banner (042),
 * provenance footer (043/046) and the quick-action cards (024-031).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppHeader } from './AppHeader'
import { NoticeBanner } from './NoticeBanner'
import { ProvenanceFooter } from './ProvenanceFooter'
import { QUICK_ACTIONS, QuickActions } from './QuickActions'
import { ROUTES, RouterProvider } from '../router'
import { makeActiveImport } from '../test/factories'

const me = {
  identity_key: 'dev-admin',
  display_name: 'Dev Admin',
  product_grants: [{ product_key: 'transelect', role: 'admin' as const }],
}

function renderWithRouter(node: React.ReactNode) {
  return render(<RouterProvider initialPath={ROUTES.dashboard}>{node}</RouterProvider>)
}

describe('AppHeader (TR-FUNC-041/046)', () => {
  it('renders both brand identities as text, with no image element at all', () => {
    const { container } = renderWithRouter(
      <AppHeader me={me} activeImport={makeActiveImport()} currentPath={ROUTES.dashboard} canPublish />,
    )
    expect(screen.getByText('Campo Digital')).toBeInTheDocument()
    expect(screen.getByText('Transelec')).toBeInTheDocument()
    expect(screen.getByText('Transmisora del Pacífico – Transelec')).toBeInTheDocument()
    // TR-OPEN-06: no logo payload is reused, so there is no <img> to carry one.
    expect(container.querySelector('img')).toBeNull()
  })

  it('stamps the active version’s own publish timestamp, not the current date', () => {
    renderWithRouter(
      <AppHeader
        me={me}
        activeImport={makeActiveImport({ import_id: 42 })}
        currentPath={ROUTES.dashboard}
        canPublish
      />,
    )
    expect(screen.getByText('Versión activa #42')).toBeInTheDocument()
    expect(screen.getByText(/Publicada 02-09-2026/)).toBeInTheDocument()
  })

  it('says so plainly when nothing is published', () => {
    renderWithRouter(
      <AppHeader me={me} activeImport={null} currentPath={ROUTES.dashboard} canPublish />,
    )
    expect(screen.getByText('Sin versión publicada')).toBeInTheDocument()
  })

  it('hides the operator-only routes from a viewer', () => {
    const { rerender } = renderWithRouter(
      <AppHeader
        me={me}
        activeImport={null}
        currentPath={ROUTES.dashboard}
        canPublish={false}
      />,
    )
    expect(screen.queryByRole('link', { name: 'Importar planilla' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Versiones' })).not.toBeInTheDocument()

    rerender(
      <RouterProvider initialPath={ROUTES.dashboard}>
        <AppHeader me={me} activeImport={null} currentPath={ROUTES.importar} canPublish />
      </RouterProvider>,
    )
    expect(screen.getByRole('link', { name: 'Importar planilla' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('NoticeBanner (TR-FUNC-042)', () => {
  it('reproduces the source’s Consulta documental wording', () => {
    render(<NoticeBanner />)
    const banner = screen.getByTestId('notice-banner')
    expect(banner).toHaveTextContent('Consulta documental:')
    expect(banner).toHaveTextContent('N.º de ingreso está asociado directamente a cada PMF')
    expect(banner).toHaveTextContent('La base no incluye un campo separado de N.º de resolución.')
  })
})

describe('ProvenanceFooter (TR-FUNC-043/046)', () => {
  it('cites the active version’s real provenance instead of a static filename string', () => {
    render(<ProvenanceFooter activeImport={makeActiveImport()} />)
    const footer = screen.getByTestId('provenance-footer')

    expect(footer).toHaveTextContent('#12')
    expect(footer).toHaveTextContent('resumen.xlsx')
    expect(footer).toHaveTextContent('82ba5eaed0b1')
    expect(footer).toHaveTextContent('transelec-resumen-v1')
    expect(footer).toHaveTextContent('Dev Admin')
    expect(footer).toHaveTextContent('7 filas')
  })

  it('marks a restore explicitly in the provenance line', () => {
    render(<ProvenanceFooter activeImport={makeActiveImport({ published_event_type: 'restore' })} />)
    expect(screen.getByText(/restauración de una versión anterior/)).toBeInTheDocument()
  })

  it('keeps the source’s ingestion-scope statements', () => {
    render(<ProvenanceFooter activeImport={makeActiveImport()} />)
    expect(screen.getByText(/hoja «Resumen»/)).toBeInTheDocument()
    expect(screen.getByText(/nunca modifica la planilla de origen/)).toBeInTheDocument()
  })

  it('discloses that the brand marks are provisional (TR-OPEN-06)', () => {
    render(<ProvenanceFooter activeImport={null} />)
    expect(screen.getByText(/los logotipos originales no se reutilizan/)).toBeInTheDocument()
  })

  it('says there is no provenance to cite when nothing is published', () => {
    render(<ProvenanceFooter activeImport={null} />)
    expect(screen.getByText(/todavía no hay procedencia que citar/)).toBeInTheDocument()
  })
})

describe('QuickActions (TR-FUNC-024-031)', () => {
  it('renders all eight source cards, keyed by their original type', () => {
    render(<QuickActions onQuick={() => {}} />)
    expect(QUICK_ACTIONS).toHaveLength(8)
    for (const card of QUICK_ACTIONS) {
      expect(screen.getByText(card.title)).toBeInTheDocument()
    }
  })

  it('dispatches the card’s own type to the handler', async () => {
    const onQuick = vi.fn()
    render(<QuickActions onQuick={onQuick} />)

    await userEvent.click(screen.getByText('¿Qué expedientes tienen rechazo?'))
    expect(onQuick).toHaveBeenLastCalledWith('rejected')

    await userEvent.click(screen.getByText('¿Qué ingresos superaron 90 días?'))
    expect(onQuick).toHaveBeenLastCalledWith('overdue')
  })

  it('describes what the three under-delivering cards actually do', () => {
    render(<QuickActions onQuick={() => {}} />)
    expect(screen.getByText(/no existe todavía una tabla comparativa por empresa/)).toBeInTheDocument()
    expect(
      screen.getByText(/Limpia los filtros y lleva al indicador de superficie/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Deja el cursor en la búsqueda general/)).toBeInTheDocument()
  })

  it('does not claim the surface card leaves the filters alone — it resets them', () => {
    render(<QuickActions onQuick={() => {}} />)
    expect(screen.queryByText(/no cambia los filtros/)).not.toBeInTheDocument()
  })

  it('describes the two blunt substring searches as such', () => {
    render(<QuickActions onQuick={() => {}} />)
    expect(screen.getByText(/Busca «rechaz» en todos los campos, no sólo en Estado/)).toBeInTheDocument()
    expect(screen.getByText(/Busca «legal» en todos los campos, no sólo en Estado/)).toBeInTheDocument()
  })

  it('labels the pending card with the rule this application actually applies', () => {
    render(<QuickActions onQuick={() => {}} />)
    expect(screen.getByText('¿Qué falta presentar a CONAF?')).toBeInTheDocument()
    expect(screen.getByText('Sin N.º de ingreso o estado vigente con rechazo.')).toBeInTheDocument()
  })
})
