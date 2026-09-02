import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PendingZone } from './PendingZone'
import { makePending } from '../test/factories'

const noop = () => {}

describe('PendingZone (TR-FUNC-007/032/033)', () => {
  it('shows the pending count against the total PMF count and its share', () => {
    render(
      <PendingZone pending={makePending()} focused={false} onShowPending={noop} onReset={noop} />,
    )
    expect(screen.getByTestId('pending-count')).toHaveTextContent('2 de 6')
    expect(screen.getByText(/33,33% de los PMF del alcance seleccionado/)).toBeInTheDocument()
  })

  it('breaks the pending set down by the three legacy stages', () => {
    render(
      <PendingZone pending={makePending()} focused={false} onShowPending={noop} onReset={noop} />,
    )
    expect(screen.getByTestId('pending-stage-preparacion')).toHaveTextContent('1')
    expect(screen.getByTestId('pending-stage-recurso_rechazo')).toHaveTextContent('1')
    expect(screen.getByTestId('pending-stage-otros')).toHaveTextContent('0')
    expect(screen.getAllByText('En preparación / no presentado').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Recurso rechazado').length).toBeGreaterThan(0)
  })

  it('stage counts sum to the pending PMF count', () => {
    const pending = makePending()
    render(<PendingZone pending={pending} focused={false} onShowPending={noop} onReset={noop} />)
    const stages = pending.stages
    expect(stages.preparacion + stages.recurso_rechazo + stages.otros).toBe(
      pending.pending_pmf_count,
    )
  })

  it('names both the pending rule and the stage heuristic, and flags the divergence', () => {
    render(
      <PendingZone pending={makePending()} focused={false} onShowPending={noop} onReset={noop} />,
    )
    expect(screen.getByText('pending_priority_legacy')).toBeInTheDocument()
    expect(screen.getByText('pending_stage_legacy')).toBeInTheDocument()
    expect(screen.getByText(/no es la misma que la de los indicadores/)).toBeInTheDocument()
    expect(screen.getByText(/No es una taxonomía CONAF confirmada/)).toBeInTheDocument()
  })

  it('renders Actualizable’s detail columns, with the two Carpeta columns kept apart', () => {
    render(
      <PendingZone pending={makePending()} focused={false} onShowPending={noop} onReset={noop} />,
    )
    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent)
    expect(headers).toEqual([
      'PMF',
      'Predio de reforestación',
      'Carpeta (col. E)',
      'Carpeta (col. AC)',
      'Predio',
      'Rol',
      'Estado resumido',
      'Motivo',
      'N.º ingreso',
      'Empresa',
    ])
  })

  it('exposes both reset entry points and wires them to the callers’ handlers (TR-FUNC-023/024/032)', async () => {
    const onShowPending = vi.fn()
    const onReset = vi.fn()
    render(
      <PendingZone
        pending={makePending()}
        focused={false}
        onShowPending={onShowPending}
        onReset={onReset}
      />,
    )

    await userEvent.click(screen.getByTestId('show-pending'))
    await userEvent.click(screen.getByTestId('back-to-total'))

    expect(onShowPending).toHaveBeenCalledTimes(1)
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('shows an explicit empty state when nothing is pending', () => {
    render(
      <PendingZone
        pending={makePending({ rows: [], pending_pmf_count: 0 })}
        focused={false}
        onShowPending={noop}
        onReset={noop}
      />,
    )
    expect(
      screen.getByText('No hay PMF pendientes prioritarios para el alcance seleccionado.'),
    ).toBeInTheDocument()
  })

  it('marks itself as focused after the quick action targets it', () => {
    const { container } = render(
      <PendingZone pending={makePending()} focused onShowPending={noop} onReset={noop} />,
    )
    expect(container.querySelector('.pendingzone')).toHaveClass('focused')
  })
})
