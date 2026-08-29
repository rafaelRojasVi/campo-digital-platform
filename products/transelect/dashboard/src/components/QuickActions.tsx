import {
  ChartIcon,
  DownloadIcon,
  EraserIcon,
  HistoryIcon,
  PrintIcon,
  SearchIcon,
} from './icons'

interface QuickActionsProps {
  onFocusSearch: () => void
  onReviewStatuses: () => void
  filtersActive: boolean
  onClearFilters: () => void
  onExportCsv: () => void
  exportDisabled: boolean
  onPrint: () => void
  onOpenHistory: () => void
}

export function QuickActions({
  onFocusSearch,
  onReviewStatuses,
  filtersActive,
  onClearFilters,
  onExportCsv,
  exportDisabled,
  onPrint,
  onOpenHistory,
}: QuickActionsProps) {
  const actions = [
    {
      key: 'search',
      icon: <SearchIcon />,
      title: 'Buscar PMF, predio o rol',
      description: 'Va al campo de búsqueda',
      onClick: onFocusSearch,
    },
    {
      key: 'statuses',
      icon: <ChartIcon />,
      title: 'Revisar estados',
      description: 'Va a la distribución por estado resumido',
      onClick: onReviewStatuses,
    },
    {
      key: 'clear',
      icon: <EraserIcon />,
      title: 'Limpiar filtros',
      description: filtersActive ? 'Quita búsqueda y selecciones activas' : 'No hay filtros activos',
      onClick: onClearFilters,
      disabled: !filtersActive,
    },
    {
      key: 'export',
      icon: <DownloadIcon />,
      title: 'Exportar selección',
      description: exportDisabled ? 'No hay resultados para exportar' : 'Descarga el CSV de los PMF filtrados',
      onClick: onExportCsv,
      disabled: exportDisabled,
    },
    {
      key: 'print',
      icon: <PrintIcon />,
      title: 'Imprimir / guardar PDF',
      description: 'Abre la vista de impresión',
      onClick: onPrint,
    },
    {
      key: 'history',
      icon: <HistoryIcon />,
      title: 'Ver historial de fuente',
      description: 'Abre versiones publicadas y restauración',
      onClick: onOpenHistory,
    },
  ]

  return (
    <article className="panel quick-actions-card no-print">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Accesos</span>
          <h2>Consultas rápidas</h2>
        </div>
      </div>

      <div className="quick-actions-grid">
        {actions.map((action) => (
          <button
            type="button"
            key={action.key}
            className="quick-action"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            <span className="quick-action-icon">{action.icon}</span>
            <strong>{action.title}</strong>
            <span>{action.description}</span>
          </button>
        ))}
      </div>
    </article>
  )
}
