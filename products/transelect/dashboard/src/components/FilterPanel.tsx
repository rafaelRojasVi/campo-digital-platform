/**
 * TR-FUNC-017-023 — the filter panel.
 *
 * Free-text search (017) is OR'd across all 30 contract fields server-side;
 * the five multi-selects (018-022) are AND'd with each other and OR'd
 * within themselves. Every read endpoint takes the same filter contract, so
 * the KPI row, both donuts, the status hero, the owner-status table, the
 * pending zone, the report and the detail table can never disagree about
 * what "the current view" means.
 *
 * `Limpiar` (023) is the same `resetFilters()` code path as the pending
 * zone's `Volver al total` button — one function, two UI entry points.
 */
import type { RefObject } from 'react'
import type { TranselecFilterState } from '../api'
import { MultiSelectField } from './MultiSelectField'

export interface FilterOptions {
  estado_resumido: string[]
  empresa: string[]
  pas: string[]
  sector: string[]
  tipo_propietario: string[]
}

export const EMPTY_FILTER_OPTIONS: FilterOptions = {
  estado_resumido: [],
  empresa: [],
  pas: [],
  sector: [],
  tipo_propietario: [],
}

export function FilterPanel({
  filters,
  options,
  optionsLoading,
  searchPlaceholder,
  searchRef,
  empresaRef,
  empresaOpenSignal,
  onChange,
  onReset,
  onExportCsv,
  onPrint,
  disabled,
}: {
  filters: TranselecFilterState
  options: FilterOptions
  optionsLoading: boolean
  searchPlaceholder: string
  searchRef?: RefObject<HTMLInputElement | null>
  empresaRef?: RefObject<HTMLButtonElement | null>
  empresaOpenSignal?: number
  onChange: (next: TranselecFilterState) => void
  onReset: () => void
  onExportCsv: () => void
  onPrint: () => void
  disabled?: boolean
}) {
  const set = <K extends keyof TranselecFilterState>(key: K, value: TranselecFilterState[K]) =>
    onChange({ ...filters, [key]: value })

  return (
    <aside className="panel filters no-print" aria-label="Filtros">
      <h2>Filtros</h2>

      <div className="field">
        <label htmlFor="filter-search">Búsqueda general</label>
        <input
          id="filter-search"
          type="search"
          ref={searchRef}
          placeholder={searchPlaceholder}
          value={filters.q}
          onChange={(event) => set('q', event.target.value)}
        />
        <p className="hint">
          Busca el término en cualquiera de los 30 campos de la planilla, sin distinguir
          mayúsculas.
        </p>
      </div>

      <MultiSelectField
        label="Estado resumido"
        options={options.estado_resumido}
        selected={filters.estado_resumido}
        onChange={(next) => set('estado_resumido', next)}
      />
      <MultiSelectField
        label="Empresa"
        options={options.empresa}
        selected={filters.empresa}
        onChange={(next) => set('empresa', next)}
        triggerRef={empresaRef}
        openSignal={empresaOpenSignal}
      />
      <MultiSelectField
        label="PAS"
        options={options.pas}
        selected={filters.pas}
        onChange={(next) => set('pas', next)}
      />
      <MultiSelectField
        label="Sector"
        options={options.sector}
        selected={filters.sector}
        onChange={(next) => set('sector', next)}
      />
      <MultiSelectField
        label="Tipo de propietario"
        options={options.tipo_propietario}
        selected={filters.tipo_propietario}
        onChange={(next) => set('tipo_propietario', next)}
      />

      {optionsLoading && (
        <p className="hint" role="status">
          Cargando las opciones de filtro de la versión activa…
        </p>
      )}

      <div className="btns">
        <button type="button" className="btn alt" onClick={onReset}>
          Limpiar
        </button>
        <button type="button" className="btn teal" onClick={onExportCsv} disabled={disabled}>
          Exportar CSV
        </button>
        <button type="button" className="btn" onClick={onPrint}>
          Imprimir / PDF
        </button>
      </div>

      <p className="hint">
        Las métricas se recalculan con los filtros. La superficie se suma por área de corta;
        predios, roles y PMF se cuentan sin duplicados.
      </p>
    </aside>
  )
}
