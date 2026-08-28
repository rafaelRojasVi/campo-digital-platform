import { useEffect, useMemo, useRef, useState } from 'react'

interface MultiSelectFieldProps {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholderAll?: string
}

export function MultiSelectField({
  label,
  options,
  selected,
  onChange,
  placeholderAll = 'Todos',
}: MultiSelectFieldProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('es-CL')
    if (!needle) return options
    return options.filter((option) =>
      option.toLocaleLowerCase('es-CL').includes(needle),
    )
  }, [options, query])

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((value) => value !== option))
    } else {
      onChange([...selected, option])
    }
  }

  const summary =
    selected.length === 0
      ? placeholderAll
      : selected.length === 1
        ? selected[0]
        : `${selected.length} seleccionados`

  return (
    <div className="multi-select" ref={containerRef}>
      <span className="multi-select-label">{label}</span>
      <button
        type="button"
        className={`multi-select-trigger${selected.length > 0 ? ' has-selection' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={options.length === 0}
      >
        <span>{summary}</span>
      </button>

      {open && (
        <div
          className="multi-select-popover"
          role="group"
          aria-label={label}
        >
          {options.length > 8 && (
            <input
              type="search"
              className="multi-select-search"
              placeholder="Buscar…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoFocus
            />
          )}

          <div className="multi-select-options">
            {filteredOptions.map((option) => (
              <label className="multi-select-option" key={option}>
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggleOption(option)}
                />
                <span>{option}</span>
              </label>
            ))}
            {filteredOptions.length === 0 && (
              <div className="multi-select-empty">Sin coincidencias</div>
            )}
          </div>

          {selected.length > 0 && (
            <button
              type="button"
              className="multi-select-clear"
              onClick={() => onChange([])}
            >
              Limpiar selección
            </button>
          )}
        </div>
      )}
    </div>
  )
}
