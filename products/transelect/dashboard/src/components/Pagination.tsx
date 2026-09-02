import { numberFormatter } from './format'

const PAGE_SIZE_OPTIONS = [25, 50, 100]

type PageEntry = number | 'ellipsis'

interface PaginationProps {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

function buildPageWindow(current: number, total: number): PageEntry[] {
  const candidates = new Set<number>([1, total, current, current - 1, current + 1])
  const sorted = [...candidates].filter((value) => value >= 1 && value <= total).sort((a, b) => a - b)

  const window: PageEntry[] = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) window.push('ellipsis')
    window.push(value)
  })
  return window
}

export function Pagination({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  if (totalPages <= 1) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalItems)
  const pageWindow = buildPageWindow(page, totalPages)

  return (
    <nav className="pagination no-print" aria-label="Paginación de resultados">
      <div className="pagination-info">
        <span className="pagination-range">
          Mostrando {numberFormatter.format(start)}–{numberFormatter.format(end)} de{' '}
          {numberFormatter.format(totalItems)}
        </span>
        <label className="pagination-size">
          <span>Por página</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="pagination-nav pagination-nav-desktop">
        <button
          type="button"
          className="pagination-step"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <span aria-hidden="true">←</span> Anterior
        </button>

        <div className="pagination-pages">
          {pageWindow.map((entry, index) =>
            entry === 'ellipsis' ? (
              <span className="pagination-ellipsis" key={`ellipsis-${index}`} aria-hidden="true">
                …
              </span>
            ) : (
              <button
                type="button"
                key={entry}
                className={`pagination-page${entry === page ? ' active' : ''}`}
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Página ${entry}`}
                onClick={() => onPageChange(entry)}
              >
                {entry}
              </button>
            ),
          )}
        </div>

        <button
          type="button"
          className="pagination-step"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Siguiente <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="pagination-nav pagination-nav-mobile">
        <button
          type="button"
          className="pagination-step"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Anterior
        </button>
        <span className="pagination-mobile-label">
          Página {page} de {totalPages}
        </span>
        <button
          type="button"
          className="pagination-step"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Siguiente
        </button>
      </div>
    </nav>
  )
}
