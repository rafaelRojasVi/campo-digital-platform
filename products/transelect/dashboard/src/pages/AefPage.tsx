/**
 * `/transelec/seguimiento-aef` — the AEF tracking block, as its own reading section.
 *
 * The 09-Sept-2026 workbook added five columns to `Resumen`: `AEF`, `Quien
 * solicita`, `Fecha solicitud`, `Fecha corta` and `Fecha termino`. They are
 * recorded per row (per área de corta), and sparsely: in that workbook 23 of
 * 729 rows carry an AEF value and 19 a requester, and PMFs with an AEF row
 * usually also have rows without one.
 *
 * So this page counts rows, never PMFs-by-association:
 *
 *  - every figure is "N of M rows", and PMF coverage is shown as an explicit
 *    per-PMF ratio with partial coverage called out;
 *  - a blank value is shown as blank on its own row; nothing is filled down
 *    or borrowed from a sibling row;
 *  - AEF values are grouped by their literal spelling only — the source does
 *    not define what each value means, so neither does this page;
 *  - date-order inconsistencies are flagged for review, and the dates are
 *    shown exactly as the workbook has them.
 *
 * When the published version's workbook had no AEF columns, the page says so
 * rather than reporting zero AEF rows, which would be a claim about rows the
 * source never described.
 */
import { useCallback, useState } from 'react'
import { type ResumenRow, type TranselecAef, getAef } from '../api'
import { RowDetailDrawer } from '../components/RowDetailDrawer'
import { AlertBanner, LoadingBlock, StateBlock } from '../components/StateViews'
import { StatusPill } from '../components/StatusPill'
import { cell, formatDate, formatInteger } from '../format'
import { chronologyFlagsOf, chronologyLabel } from '../lib/aef'
import { activeFilterChips, withoutChip } from '../lib/filterUrl'
import { useReads, type FilterController } from '../lib/useFilters'
import { Link, ROUTES } from '../router'
import { Chip, SectionHeader, StatStrip } from '../ui/Primitives'

function ofTotal(part: number, total: number): string {
  return `${formatInteger(part)} de ${formatInteger(total)}`
}

function CountTable({
  caption,
  blankLabel,
  entries,
  testId,
}: {
  caption: string
  blankLabel: string
  entries: TranselecAef['por_aef']
  testId: string
}) {
  return (
    <div className="stack-tight">
      <h3>{caption}</h3>
      <div className="tablewrap short">
        <table data-testid={testId}>
          <thead>
            <tr>
              <th scope="col">Valor en la planilla</th>
              <th scope="col" className="numeric">
                Filas
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.label ?? '__blank__'}>
                <td>{entry.label ?? <span className="aef-empty">{blankLabel}</span>}</td>
                <td className="numeric">{formatInteger(entry.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function AefPage({
  filterController,
  sourceFields = null,
}: {
  filterController: FilterController
  sourceFields?: readonly string[] | null
}) {
  const { filters, replaceFilters } = filterController
  const key = JSON.stringify(filters)
  const [openRow, setOpenRow] = useState<ResumenRow | null>(null)

  const { data, loading, failure } = useReads<TranselecAef>(
    useCallback(
      () => getAef(filters),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [key],
    ),
    [key],
  )

  const chips = activeFilterChips(filters)

  if (failure && !data) {
    return (
      <div className="page">
        <StateBlock view={failure} />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="page">
        <LoadingBlock label="Cargando el seguimiento AEF…" shape="rows" lines={5} />
      </div>
    )
  }

  if (data.source_fields.length === 0) {
    return (
      <div className="page enter">
        <SectionHeader title="Seguimiento AEF" />
        <StateBlock
          view={{
            kind: 'empty',
            title: 'Esta versión no incluye columnas AEF',
            message:
              'La planilla publicada no tiene las columnas AEF, Quién solicita ni las fechas de solicitud, corta y término. Aparecerán aquí cuando se publique una planilla que las incluya.',
          }}
        />
      </div>
    )
  }

  const missingColumns = 5 - data.source_fields.length

  return (
    <div className="page enter" aria-busy={loading}>
      <SectionHeader
        title="Seguimiento AEF"
        basis="por fila"
        meta="AEF, solicitante y fechas tal como vienen en cada fila de la hoja «Resumen»."
      />

      {chips.length > 0 && (
        <div className="active-filters no-print" style={{ paddingBottom: 'var(--s-5)' }}>
          <span className="eyebrow">Alcance filtrado</span>
          {chips.map((chip) => (
            <Chip
              key={chip.key}
              onRemove={() => replaceFilters(withoutChip(filters, chip))}
              removeLabel={`Quitar el filtro ${chip.label}: ${chip.value}`}
            >
              {chip.label}: {chip.value}
            </Chip>
          ))}
        </div>
      )}

      <AlertBanner tone="info" title="Registro por fila, no por PMF">
        La planilla registra el AEF en cada área de corta. Una fila sin AEF se muestra vacía: el
        valor de otra fila del mismo PMF no se le aplica.
        {missingColumns > 0 &&
          ` La planilla publicada no incluye ${missingColumns === 1 ? 'una' : missingColumns} de las cinco columnas de seguimiento.`}
      </AlertBanner>

      <StatStrip
        testId="aef-kpis"
        items={[
          {
            id: 'aef-rows',
            label: 'Filas con AEF',
            value: ofTotal(data.rows_with_aef, data.row_count),
            sub: 'filas del alcance',
          },
          {
            id: 'aef-pmf',
            label: 'PMF con alguna fila con AEF',
            value: ofTotal(data.pmf_with_aef, data.pmf_count),
            sub: `${formatInteger(data.pmf_with_partial_aef)} con AEF solo en parte de sus filas`,
          },
          {
            id: 'aef-requester',
            label: 'Filas con solicitante',
            value: ofTotal(data.rows_with_quien_solicita, data.rows_with_any_tracking),
            sub: 'de las filas con seguimiento',
          },
          {
            id: 'aef-chronology',
            label: 'Fechas a revisar',
            value: formatInteger(data.rows_with_chronology_warning),
            sub: 'filas con fechas en orden inconsistente',
          },
        ]}
      />

      {data.rows.length === 0 ? (
        <section className="ruled" style={{ marginTop: 'var(--s-6)' }}>
          <p className="empty" data-testid="aef-empty">
            No hay filas con seguimiento AEF en el alcance seleccionado.
            {chips.length > 0 && ' Quite un filtro para ampliar el alcance.'}
          </p>
        </section>
      ) : (
        <>
          <section className="ruled" aria-labelledby="aef-rows-title" style={{ marginTop: 'var(--s-6)' }}>
            <div className="table-toolbar">
              <div className="result-count">
                <h2 id="aef-rows-title" className="eyebrow">
                  Filas con seguimiento
                </h2>
                <span data-testid="aef-rows-total">
                  <b>{formatInteger(data.rows_with_any_tracking)}</b> filas
                </span>
              </div>
            </div>
            <div className="tablewrap">
              <table className="rows-table">
                <thead>
                  <tr>
                    <th scope="col" className="numeric">
                      Fila
                    </th>
                    <th scope="col">PMF</th>
                    <th scope="col">Área corta</th>
                    <th scope="col">Estado resumido</th>
                    <th scope="col">AEF</th>
                    <th scope="col">Quién solicita</th>
                    <th scope="col">Fecha solicitud</th>
                    <th scope="col">Fecha corta</th>
                    <th scope="col">Fecha término</th>
                    <th scope="col">Revisión</th>
                  </tr>
                </thead>
                <tbody data-testid="aef-rows">
                  {data.rows.map((row) => (
                    <tr
                      key={row.source_row_number}
                      tabIndex={0}
                      data-testid={`aef-row-${row.source_row_number}`}
                      onClick={() => setOpenRow(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setOpenRow(row)
                        }
                      }}
                    >
                      <td className="numeric">{row.source_row_number}</td>
                      <td>
                        <b>{row.pmf}</b>
                      </td>
                      <td>{cell(row.numero_area_corta)}</td>
                      <td>
                        <StatusPill value={row.estado_resumido} />
                      </td>
                      <td>{cell(row.aef) || <span className="aef-empty">Sin AEF</span>}</td>
                      <td>
                        {cell(row.quien_solicita) || (
                          <span className="aef-empty">Sin solicitante</span>
                        )}
                      </td>
                      <td>{formatDate(row.fecha_solicitud) || <span className="aef-empty">—</span>}</td>
                      <td>{formatDate(row.fecha_corta) || <span className="aef-empty">—</span>}</td>
                      <td>{formatDate(row.fecha_termino) || <span className="aef-empty">—</span>}</td>
                      <td>
                        {chronologyFlagsOf(row).map((flag) => (
                          <span className="flag" key={flag}>
                            {chronologyLabel(flag)}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Las fechas se muestran tal como vienen en la planilla; una fecha marcada para revisar
              no se corrige aquí. Para verlas junto al resto de las filas, use el{' '}
              <Link to={ROUTES.explorador}>Explorador</Link> con el filtro AEF.
            </p>
          </section>

          <section className="ruled split-two" style={{ marginTop: 'var(--s-6)' }}>
            <CountTable
              caption="Filas por valor de AEF"
              blankLabel="Sin AEF"
              entries={data.por_aef}
              testId="aef-by-value"
            />
            <CountTable
              caption="Filas por solicitante"
              blankLabel="Sin solicitante"
              entries={data.por_solicitante}
              testId="aef-by-requester"
            />
          </section>

          <section className="ruled stack-tight" style={{ marginTop: 'var(--s-6)' }}>
            <h3>Cobertura por PMF</h3>
            <p className="hint">
              Cuántas filas de cada PMF tienen AEF. Una cobertura parcial significa que el PMF tiene
              filas sin registro AEF en la planilla.
            </p>
            <div className="tablewrap short">
              <table data-testid="aef-coverage">
                <thead>
                  <tr>
                    <th scope="col">PMF</th>
                    <th scope="col" className="numeric">
                      Filas con AEF
                    </th>
                    <th scope="col" className="numeric">
                      Filas del PMF
                    </th>
                    <th scope="col">Cobertura</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pmf_coverage.map((entry) => (
                    <tr key={entry.pmf}>
                      <td>
                        <b>{entry.pmf}</b>
                      </td>
                      <td className="numeric">{formatInteger(entry.rows_with_aef)}</td>
                      <td className="numeric">{formatInteger(entry.total_rows)}</td>
                      <td>
                        {entry.rows_with_aef === entry.total_rows ? (
                          'Todas las filas'
                        ) : (
                          <span className="flag">Parcial</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {openRow && (
        <RowDetailDrawer
          row={openRow}
          onClose={() => setOpenRow(null)}
          sourceFields={sourceFields}
        />
      )}
    </div>
  )
}
