import type { TranselecFilterOptions } from '../api'
import { CloseIcon, SearchIcon } from './icons'
import { MultiSelectField } from '../MultiSelectField'

interface FilterPanelProps {
  search: string
  onSearchChange: (value: string) => void
  filters: TranselecFilterOptions | null
  status: string[]
  onStatusChange: (next: string[]) => void
  sector: string[]
  onSectorChange: (next: string[]) => void
  empresa: string[]
  onEmpresaChange: (next: string[]) => void
  pas: string[]
  onPasChange: (next: string[]) => void
  tipoPropietario: string[]
  onTipoPropietarioChange: (next: string[]) => void
  filtersActive: boolean
  onClearFilters: () => void
}

export function FilterPanel({
  search,
  onSearchChange,
  filters,
  status,
  onStatusChange,
  sector,
  onSectorChange,
  empresa,
  onEmpresaChange,
  pas,
  onPasChange,
  tipoPropietario,
  onTipoPropietarioChange,
  filtersActive,
  onClearFilters,
}: FilterPanelProps) {
  const activeDimensions =
    (search.trim() ? 1 : 0) +
    (status.length ? 1 : 0) +
    (sector.length ? 1 : 0) +
    (empresa.length ? 1 : 0) +
    (pas.length ? 1 : 0) +
    (tipoPropietario.length ? 1 : 0)

  return (
    <aside className="panel filter-rail no-print" aria-label="Filtros operativos">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Filtros</span>
          <h2>Búsqueda operativa</h2>
        </div>
        {activeDimensions > 0 && (
          <span className="filter-active-badge">{activeDimensions}</span>
        )}
      </div>

      <label className="search-field search-field-primary">
        <SearchIcon />
        <input
          type="search"
          placeholder="Buscar por PMF, predio o rol"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Limpiar búsqueda"
          >
            <CloseIcon />
          </button>
        )}
      </label>

      <div className="filter-rail-fields">
        <span className="filter-rail-fields-label">Filtrar por</span>
        <MultiSelectField
          label="Estado resumido"
          options={filters?.statuses ?? []}
          selected={status}
          onChange={onStatusChange}
        />
        <MultiSelectField
          label="Sector"
          options={filters?.sectors ?? []}
          selected={sector}
          onChange={onSectorChange}
        />
        <MultiSelectField
          label="Empresa"
          options={filters?.empresas ?? []}
          selected={empresa}
          onChange={onEmpresaChange}
        />
        <MultiSelectField
          label="PAS"
          options={filters?.pas ?? []}
          selected={pas}
          onChange={onPasChange}
        />
        <MultiSelectField
          label="Tipo de propietario"
          options={filters?.tipos_propietario ?? []}
          selected={tipoPropietario}
          onChange={onTipoPropietarioChange}
          placeholderAll="Todos"
        />
      </div>

      <button
        type="button"
        className="clear-filters full-width"
        onClick={onClearFilters}
        disabled={!filtersActive}
      >
        Limpiar filtros
      </button>
    </aside>
  )
}
