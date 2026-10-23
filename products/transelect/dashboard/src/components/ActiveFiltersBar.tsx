/**
 * The shared filters, said out loud under the band on every section that
 * reads them.
 *
 * The filters follow the reader from section to section (they live in the
 * URL), but each page used to mention them only in a small grey «Alcance
 * filtrado» line, so a reader who set «Estado resumido: Aprobado» in the
 * Explorador could open Estado and not notice that every number there was
 * already narrowed. This bar is the one place that says it, in the same
 * spot on every section, with a way out of each filter and of all of them.
 */
import { activeFilterChips, withoutChip } from '../lib/filterUrl'
import type { FilterController } from '../lib/useFilters'
import { Chip } from '../ui/Primitives'

export function ActiveFiltersBar({ filterController }: { filterController: FilterController }) {
  const { filters, replaceFilters, reset } = filterController
  const chips = activeFilterChips(filters)
  if (chips.length === 0) return null

  return (
    <div className="filters-bar no-print" role="region" aria-label="Filtros activos">
      <div className="filters-bar-inner">
        <span className="filters-bar-title">
          <svg className="filters-bar-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8z" />
          </svg>
          {chips.length === 1 ? 'Filtro activo' : `${chips.length} filtros activos`}
          <span className="filters-bar-note">en todas las secciones</span>
        </span>
        <span className="filters-bar-chips">
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              onRemove={() => replaceFilters(withoutChip(filters, chip))}
              removeLabel={`Quitar el filtro ${chip.label}: ${chip.value}`}
            >
              {chip.label}: <b>{chip.value}</b>
            </Chip>
          ))}
        </span>
        <button type="button" className="filters-bar-clear" onClick={reset}>
          Quitar todos
        </button>
      </div>
    </div>
  )
}
