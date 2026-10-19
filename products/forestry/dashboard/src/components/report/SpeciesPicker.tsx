/**
 * Species to reforest for one rodal: chips, and a field that opens a list
 * grouped as «Usadas en este informe», «Plantaciones» and «Nativas».
 * Typing filters it (accents ignored); a name not on the list is added with
 * «Agregar "…"». A combobox: ↑↓ move, Enter chooses, Esc closes, Backspace
 * on an empty field removes the last species. The list is portalled with
 * fixed positioning so the table's scroll box never clips it.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon.tsx'
import { MAX_REFOREST_SPECIES, REFOREST_GROUPS, fold } from '../../lib/reforestSpecies.ts'

interface Option {
  id: string
  name: string
  custom: boolean
}

interface Group {
  label: string
  options: Option[]
}

const LIST_WIDTH = 260

export function SpeciesPicker({
  label,
  species,
  used,
  onChange,
}: {
  label: string
  species: string[]
  /** Species already used elsewhere in the report, offered first. */
  used: string[]
  onChange: (next: string[]) => void
}) {
  const baseId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<{ left: number; top: number; maxHeight: number } | null>(null)

  const chosen = useMemo(() => new Set(species.map(fold)), [species])
  const full = species.length >= MAX_REFOREST_SPECIES

  const groups = useMemo((): Group[] => {
    const q = fold(query)
    const known = new Set(REFOREST_GROUPS.flatMap((g) => g.names.map(fold)))
    const extra = [...new Set(used)].filter((name) => !known.has(fold(name)))
    const all = [{ label: 'Usadas en este informe', names: extra }, ...REFOREST_GROUPS]
    const result: Group[] = []
    for (const group of all) {
      const options = group.names
        .filter((name) => q === '' || fold(name).includes(q))
        .map((name) => ({ id: `${baseId}-${fold(name).replace(/\s+/g, '-')}`, name, custom: false }))
      if (options.length > 0) result.push({ label: group.label, options })
    }
    const exact = result.some((group) => group.options.some((option) => fold(option.name) === q))
    if (q !== '' && !exact && !chosen.has(q)) {
      result.push({ label: 'Otra especie', options: [{ id: `${baseId}-custom`, name: query.trim(), custom: true }] })
    }
    return result
  }, [query, used, baseId, chosen])

  const flat = groups.flatMap((group) => group.options)
  const current = flat[Math.min(active, flat.length - 1)]

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const down = below >= 220 || below >= above
      const maxHeight = Math.max(160, Math.min(320, down ? below : above))
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - LIST_WIDTH - 8)
      setPosition({ left, top: down ? rect.bottom + 4 : rect.top - 4 - maxHeight, maxHeight })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const choose = (option: Option) => {
    const name = option.name.trim()
    if (name === '') return
    if (chosen.has(fold(name))) {
      onChange(species.filter((item) => fold(item) !== fold(name)))
    } else if (!full) {
      onChange([...species, name])
    }
    setQuery('')
    setActive(0)
    inputRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (flat.length === 0 ? 0 : (index + 1) % flat.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive((index) => (flat.length === 0 ? 0 : (index - 1 + flat.length) % flat.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // Enter never removes: a species already chosen stays (its chip's × removes it).
      if (current !== undefined && !chosen.has(fold(current.name))) choose(current)
      else setQuery('')
    } else if (event.key === 'Escape') {
      if (open) {
        event.stopPropagation()
        setOpen(false)
      }
    } else if (event.key === 'Backspace' && query === '' && species.length > 0) {
      onChange(species.slice(0, -1))
    }
  }

  const listId = `${baseId}-list`

  return (
    <div className="species-picker">
      {species.map((name) => (
        <span key={name} className="plan-chip">
          {name}
          <button
            type="button"
            aria-label={`Quitar ${name}`}
            onClick={() => onChange(species.filter((item) => item !== name))}
          >
            <Icon name="x" size={14} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="plan-table__input species-picker__input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && current !== undefined ? current.id : undefined}
        maxLength={40}
        placeholder={full ? 'Máximo 6' : species.length === 0 ? 'Elegir especie…' : 'Otra…'}
        disabled={full}
        value={query}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          setQuery('')
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />
      {open && position !== null
        ? createPortal(
            <div
              id={listId}
              role="listbox"
              aria-label={`Opciones: ${label}`}
              aria-multiselectable="true"
              className="species-list"
              style={{ left: position.left, top: position.top, maxHeight: position.maxHeight, width: LIST_WIDTH }}
              // Keep focus in the field: a click on an option must not blur it.
              onMouseDown={(event) => event.preventDefault()}
            >
              {flat.length === 0 ? <p className="species-list__empty">Sin coincidencias.</p> : null}
              {groups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <p className="species-list__group" aria-hidden="true">{group.label}</p>
                  {group.options.map((option) => {
                    const isChosen = chosen.has(fold(option.name))
                    const isActive = current?.id === option.id
                    return (
                      <div
                        key={option.id}
                        id={option.id}
                        role="option"
                        aria-selected={isChosen}
                        className={`species-list__option${isActive ? ' species-list__option--active' : ''}${isChosen ? ' species-list__option--chosen' : ''}`}
                        onMouseEnter={() => setActive(flat.indexOf(option))}
                        onClick={() => choose(option)}
                      >
                        <span className="species-list__check" aria-hidden="true">
                          {isChosen ? <Icon name="check" size={16} /> : option.custom ? <Icon name="plus" size={16} /> : null}
                        </span>
                        <span>{option.custom ? `Agregar «${option.name}»` : <Highlight text={option.name} query={query} />}</span>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/** The typed letters in bold inside a species name, accents ignored. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = fold(query)
  if (q === '') return <>{text}</>
  // fold() keeps one character per character once accents are stripped.
  const start = fold(text).indexOf(q)
  if (start < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + q.length)}</mark>
      {text.slice(start + q.length)}
    </>
  )
}
