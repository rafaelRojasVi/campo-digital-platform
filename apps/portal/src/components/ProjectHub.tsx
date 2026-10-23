import { useEffect, useState, type CSSProperties } from 'react'
import { ParticleNetwork } from './ParticleNetwork'
import { MODULE_VISUALS } from './visuals'
import { PRODUCT_CARDS, type ProductCard } from '../data/productCards'
import {
  getRodalesHeadline,
  getTranselecHeadline,
  type ApiResult,
  type Me,
  type ProductKey,
  type Role,
} from '../lib/platformApi'

/** One figure in a project's headline row. */
interface Figure {
  value: number
  label: string
  /** Hectares keep one decimal; counts none. */
  decimals: number
}

type Figures = { kind: 'loading' } | { kind: 'ready'; figures: Figure[] } | { kind: 'none' }

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Solo lectura',
}

/** "Javier Soto" -> "Javier"; an email-like or empty name stays as it is. */
function firstName(displayName: string): string {
  const name = displayName.trim()
  if (name === '' || name.includes('@')) return name
  return name.split(/\s+/)[0]
}

function todayLabel(now: Date): string {
  const text = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Headline figures come from the same read endpoints the products use, and
 * only for products the session holds a grant for. A failure or an empty
 * product just hides the row: the front door never shows a guessed number.
 */
const HEADLINES: Partial<Record<ProductKey, () => Promise<ApiResult<Figure[]>>>> = {
  transelect: async () => {
    const result = await getTranselecHeadline()
    if (!result.ok) return result
    const data = result.data
    return {
      ok: true,
      data: [
        { value: data.pmf_count, label: 'planes de manejo', decimals: 0 },
        { value: data.aprobados_pmf_count, label: 'aprobados', decimals: 0 },
        { value: data.en_tramite_pmf_count, label: 'en trámite', decimals: 0 },
        { value: data.surface_total, label: 'ha de superficie', decimals: 1 },
      ],
    }
  },
  forestry: async () => {
    const result = await getRodalesHeadline()
    if (!result.ok) return result
    return {
      ok: true,
      data: [
        { value: result.data.feature_count, label: 'rodales', decimals: 0 },
        { value: result.data.total_sup_ha, label: 'ha en total', decimals: 1 },
      ],
    }
  },
}

function useFigures(key: ProductKey, online: boolean): Figures {
  const load = online ? HEADLINES[key] : undefined
  const [figures, setFigures] = useState<Figures>(
    load === undefined ? { kind: 'none' } : { kind: 'loading' },
  )

  useEffect(() => {
    if (load === undefined) return
    let active = true
    void load().then((result) => {
      if (!active) return
      setFigures(
        result.ok && result.data.length > 0
          ? { kind: 'ready', figures: result.data }
          : { kind: 'none' },
      )
    })
    return () => {
      active = false
    }
  }, [load])

  return figures
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Counts up to `target` once, ~0.9 s, eased; instant with reduced motion. */
function useCountUp(target: number): number {
  const [still] = useState(
    () => prefersReducedMotion() || typeof requestAnimationFrame !== 'function',
  )
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (still) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 900)
      setShown(target * (1 - Math.pow(1 - progress, 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [still, target])

  return still ? target : shown
}

function FigureValue({ figure }: { figure: Figure }) {
  const shown = useCountUp(figure.value)
  const format = new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: figure.decimals,
    maximumFractionDigits: figure.decimals,
  })
  return (
    <span className="hub__figure">
      {/* Screen readers get the final value, not every frame of the count. */}
      <span className="hub__figure-value" aria-hidden="true">
        {format.format(shown)}
      </span>
      <span className="visually-hidden">{format.format(figure.value)}</span>
      <span className="hub__figure-label">{figure.label}</span>
    </span>
  )
}

function ProjectFigures({ figures }: { figures: Figures }) {
  if (figures.kind === 'none') return null
  if (figures.kind === 'loading') {
    return <div className="hub__figures hub__figures--loading" aria-hidden="true" />
  }
  return (
    <div className="hub__figures">
      {figures.figures.map((figure) => (
        <FigureValue key={figure.label} figure={figure} />
      ))}
    </div>
  )
}

function Project({ card, role, index }: { card: ProductCard; role: Role; index: number }) {
  const Visual = MODULE_VISUALS[card.accent]
  const online = card.href !== null
  const figures = useFigures(card.key, online)
  const titleId = `hub-${card.key}`

  const visual = (
    // Identity mark only: the title and text carry the meaning.
    <span className="hub__visual door__card-visual" aria-hidden="true">
      <Visual />
    </span>
  )

  return (
    <article
      className={`hub__project door__card door__card--${card.accent}${online ? '' : ' door__card--soon'}`}
      style={{ '--i': index } as CSSProperties}
      aria-labelledby={titleId}
    >
      {online ? (
        <a className="hub__visual-link" href={card.href ?? undefined} tabIndex={-1}>
          {visual}
        </a>
      ) : (
        visual
      )}
      <div className="hub__content">
        <div className="hub__meta">
          <span className="hub__role">{ROLE_LABELS[role]}</span>
          {online ? null : <span className="door__soon">Próximamente</span>}
        </div>
        <h2 id={titleId} className="hub__title">
          {card.title}
        </h2>
        <p className="hub__lead">{card.description}</p>
        <p className="hub__summary">{card.summary}</p>
        {card.features.length > 0 ? (
          <ul className="hub__features">
            {card.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        ) : null}
        <ProjectFigures figures={figures} />
        {online ? (
          <a className="hub__cta" href={card.href ?? undefined}>
            Abrir {card.title} <span aria-hidden="true">→</span>
          </a>
        ) : null}
      </div>
    </article>
  )
}

/** The signed-in front door: a greeting, then one section per granted project. */
export function ProjectHub({ me, now = new Date() }: { me: Me; now?: Date }) {
  const roles = new Map(me.product_grants.map((grant) => [grant.product_key, grant.role]))
  const cards = PRODUCT_CARDS.filter((card) => roles.has(card.key))
  const open = cards.filter((card) => card.href !== null).length

  return (
    <section className="hub" aria-labelledby="door-hello">
      <header className="hub__hero">
        <ParticleNetwork />
        <p className="hub__date">{todayLabel(now)}</p>
        <h1 id="door-hello" className="hub__hello">
          Hola, {firstName(me.display_name)}
        </h1>
        <p className="hub__intro">
          {cards.length === 0
            ? 'Su cuenta no tiene proyectos asignados. Pida acceso a un administrador de Campo Digital.'
            : open === 0
              ? 'Sus proyectos todavía no están en línea.'
              : open === 1
              ? 'Tiene 1 proyecto disponible. Elíjalo para continuar.'
              : `Tiene ${open} proyectos disponibles. Elija uno para continuar.`}
        </p>
        {/* The wavy edge campodigital.cl closes its sections with. */}
        <svg className="hub__wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 48 C 240 8 480 8 720 36 S 1200 72 1440 28 V 80 H 0 Z" />
        </svg>
      </header>
      {cards.length > 0 ? (
        <div className="hub__list">
          {cards.map((card, index) => (
            <Project key={card.key} card={card} role={roles.get(card.key) ?? 'viewer'} index={index} />
          ))}
        </div>
      ) : null}
    </section>
  )
}
