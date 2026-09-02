/**
 * TR-FUNC-024-031 — the eight "Preguntas frecuentes" quick-action cards.
 *
 * Every card keeps the source's own `type` key and label. Three of them
 * (`lookup`, `surface`, `company`) demonstrably under-deliver on their own
 * question in Javier's dashboards — a lookup that only focuses the search
 * box, a "superficie" card that only scrolls, a "cada empresa" card that
 * only focuses a dropdown. The matrix's disposition for all three is
 * "implement (as designed)": reproduce the current behavior and *tell*
 * Javier what it does and does not do, rather than silently inventing a
 * comparison view or a lookup UI nobody asked for. The sub-labels below say
 * so plainly instead of promising more than the card delivers.
 *
 * `pending` (024) is the same code path as the pending zone's "Ver sólo PMF
 * pendientes" button (032) — one function, several entry points.
 */

export type QuickActionType =
  | 'pending'
  | 'lookup'
  | 'easement'
  | 'surface'
  | 'rejected'
  | 'legal'
  | 'company'
  | 'overdue'

interface QuickActionCard {
  type: QuickActionType
  title: string
  sub: string
}

/**
 * Card copy.
 *
 * `pending` uses v0's wording, not Actualizable's. Actualizable relabelled
 * the same card "¿Qué figura pendiente?" with the sub-label "Usa
 * exclusivamente Estado resumido: Pendiente o Tachado" — but the rule this
 * application actually applies is the ratified `pending_priority_legacy`
 * (blank N.º de ingreso, or a raw `Estado` containing "rechaz"), which is
 * v0's. Shipping Actualizable's wording over v0's rule would describe the
 * numbers incorrectly.
 */
export const QUICK_ACTIONS: QuickActionCard[] = [
  {
    type: 'pending',
    title: '¿Qué falta presentar a CONAF?',
    sub: 'Sin N.º de ingreso o estado vigente con rechazo.',
  },
  {
    type: 'lookup',
    title: '¿A qué PMF corresponde un N.º de ingreso?',
    sub: 'Deja el cursor en la búsqueda general: escriba el número para ver su PMF, rol y predio.',
  },
  {
    type: 'easement',
    title: '¿Cuáles tienen servidumbre?',
    sub: 'Filtra «Servidumbre firmada».',
  },
  {
    // The source's `quick()` calls `resetFilters()` before every branch,
    // `surface` included, so this card does clear the filters on its way to
    // the KPI row — it just does nothing else once it gets there. Saying it
    // leaves the filters alone would describe the opposite of what happens.
    type: 'surface',
    title: '¿Cuál es la superficie de corta?',
    sub: 'Limpia los filtros y lleva al indicador de superficie; no calcula un desglose nuevo.',
  },
  {
    type: 'rejected',
    title: '¿Qué expedientes tienen rechazo?',
    sub: 'Busca «rechaz» en todos los campos, no sólo en Estado.',
  },
  {
    type: 'legal',
    title: '¿Dónde está el principal cuello de botella?',
    sub: 'Busca «legal» en todos los campos, no sólo en Estado.',
  },
  {
    type: 'company',
    title: '¿Cómo avanza cada empresa?',
    sub: 'Abre el filtro Empresa; no existe todavía una tabla comparativa por empresa.',
  },
  {
    type: 'overdue',
    title: '¿Qué ingresos superaron 90 días?',
    sub: 'Lista los ingresos no aprobados cuya fecha «90 días» ya pasó.',
  },
]

export function QuickActions({ onQuick }: { onQuick: (type: QuickActionType) => void }) {
  return (
    <section className="panel section no-print" aria-labelledby="faq-title">
      <h2 id="faq-title">Preguntas frecuentes</h2>
      <div className="questions">
        {QUICK_ACTIONS.map((card) => (
          <button
            type="button"
            className="q"
            key={card.type}
            data-quick={card.type}
            onClick={() => onQuick(card.type)}
          >
            <b>{card.title}</b>
            <span>{card.sub}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
