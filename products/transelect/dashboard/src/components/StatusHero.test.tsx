import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusHero } from './StatusHero'
import { makeSummary } from '../test/factories'

describe('StatusHero (TR-FUNC-011)', () => {
  it('shows the four Estado resumido counts at predio grain', () => {
    render(<StatusHero summary={makeSummary()} />)

    expect(screen.getByTestId('hero-aprobado')).toHaveTextContent('3')
    expect(screen.getByTestId('hero-en-tramite')).toHaveTextContent('1')
    expect(screen.getByTestId('hero-pendiente')).toHaveTextContent('1')
    expect(screen.getByTestId('hero-tachado')).toHaveTextContent('1')
  })

  it('states the grain explicitly so it cannot be misread as the PMF-grain KPI row', () => {
    render(<StatusHero summary={makeSummary({ predio_count: 6 })} />)
    expect(screen.getByText(/Predios únicos del alcance seleccionado \(6 predios\)/)).toBeInTheDocument()
  })

  it('counts sum to the predio total', () => {
    const summary = makeSummary()
    render(<StatusHero summary={summary} />)
    const hero = summary.estado_resumido_hero_predio
    expect(hero.aprobado + hero.en_tramite + hero.pendiente + hero.tachado + hero.sin_estado).toBe(
      summary.predio_count,
    )
  })

  it('hides the defensive "sin estado" bucket when it is empty and shows it when it is not', () => {
    const { rerender } = render(<StatusHero summary={makeSummary()} />)
    expect(screen.queryByTestId('hero-sin-estado')).not.toBeInTheDocument()

    rerender(
      <StatusHero
        summary={makeSummary({
          predio_count: 7,
          estado_resumido_hero_predio: {
            aprobado: 3,
            en_tramite: 1,
            pendiente: 1,
            tachado: 1,
            sin_estado: 1,
          },
        })}
      />,
    )
    expect(screen.getByTestId('hero-sin-estado')).toHaveTextContent('1')
  })

  it('names the rollup rule it used', () => {
    render(<StatusHero summary={makeSummary()} />)
    expect(screen.getByText('estado_resumido_first_row')).toBeInTheDocument()
  })
})
