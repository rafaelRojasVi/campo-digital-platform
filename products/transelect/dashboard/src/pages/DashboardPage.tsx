/**
 * `/transelec` — the main dashboard.
 *
 * Section order follows the design doc's own page structure:
 * header (041) -> notice (042) -> filters (017-023) -> KPI row (001-008) ->
 * status hero (011) -> donuts (009-010) -> reforestación chips (012) ->
 * owner-status table (013) -> quick actions (024-031) -> pending zone
 * (007/032/033) -> report panel (034-036) -> detail table with real
 * pagination (039) -> quality panel (014-016) -> provenance footer (043/046).
 *
 * Filter consistency (TR-FUNC-017) is structural here, not a convention:
 * summary, pending, owner-status, report and the first page of rows are
 * fetched together for one filter state and committed to state in a single
 * update, so the KPI row, both donuts, the hero, the owner table and the
 * detail table can never render values from two different filter states.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_FILTERS,
  type ResumenRow,
  type TranselecFilterState,
  type TranselecOwnerStatus,
  type TranselecPending,
  type TranselecReport,
  type TranselecSummary,
  exportCsvUrl,
  getOwnerStatus,
  getPending,
  getReport,
  getSummary,
  listRows,
  observedServerNow,
} from '../api'
import { ApprovalDonuts } from '../components/ApprovalDonuts'
import { FilterPanel, EMPTY_FILTER_OPTIONS, type FilterOptions } from '../components/FilterPanel'
import { KpiRow } from '../components/KpiRow'
import { NoticeBanner } from '../components/NoticeBanner'
import { OverduePanel } from '../components/OverduePanel'
import { OwnerStatusTable } from '../components/OwnerStatusTable'
import { PendingZone } from '../components/PendingZone'
import { Pagination } from '../components/Pagination'
import { ProvenanceFooter } from '../components/ProvenanceFooter'
import { QualityPanel } from '../components/QualityPanel'
import { QuickActions, type QuickActionType } from '../components/QuickActions'
import { ReforestationChips } from '../components/ReforestationChips'
import { ReportPanel } from '../components/ReportPanel'
import { RowsTable } from '../components/RowsTable'
import { StatusHero } from '../components/StatusHero'
import { AlertBanner, LoadingBlock, StateBlock } from '../components/StateViews'
import { classifyFailure, type ApiFailure } from '../lib/apiState'
import { selectOverdueRows } from '../lib/overdue'
import { collectAllRows, deriveFilterOptions } from '../lib/rowCollection'
import type { TranselecActiveImport } from '../api'
import { Link, ROUTES } from '../router'

const DEFAULT_SEARCH_PLACEHOLDER = 'PMF, rol, ingreso, predio…'
const LOOKUP_SEARCH_PLACEHOLDER = 'Escriba el N.º de ingreso para ver su PMF, rol y predio'
const EASEMENT_VALUE = 'Servidumbre firmada'
const FILTER_DEBOUNCE_MS = 250
const DEFAULT_PAGE_SIZE = 25

interface DashboardData {
  summary: TranselecSummary
  pending: TranselecPending
  ownerStatus: TranselecOwnerStatus
  report: TranselecReport
  rows: ResumenRow[]
  rowsTotal: number
  rowsHasMore: boolean
  rowsCursor: string | null
}

export function DashboardPage({
  activeImport,
  canPublish,
}: {
  activeImport: TranselecActiveImport | null
  canPublish: boolean
}) {
  const [filters, setFilters] = useState<TranselecFilterState>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<TranselecFilterState>(EMPTY_FILTERS)

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failure, setFailure] = useState<ApiFailure | null>(null)

  const [options, setOptions] = useState<FilterOptions>(EMPTY_FILTER_OPTIONS)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [optionsTruncated, setOptionsTruncated] = useState(false)

  const [pageIndex, setPageIndex] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [rowsLoading, setRowsLoading] = useState(false)
  const cursorStack = useRef<(string | null)[]>([null])

  const [searchPlaceholder, setSearchPlaceholder] = useState(DEFAULT_SEARCH_PLACEHOLDER)
  const [pendingFocused, setPendingFocused] = useState(false)
  const [empresaOpenSignal, setEmpresaOpenSignal] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const empresaRef = useRef<HTMLButtonElement>(null)

  const [overdueOpen, setOverdueOpen] = useState(false)
  const [overdueRows, setOverdueRows] = useState<ResumenRow[]>([])
  const [overdueLoading, setOverdueLoading] = useState(false)
  const [overdueError, setOverdueError] = useState<string | null>(null)
  const [overdueReference, setOverdueReference] = useState<Date | null>(null)

  const requestId = useRef(0)

  // Debounce the filter state into the applied state so a burst of typing
  // produces one consistent fetch rather than one per keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setAppliedFilters(filters), FILTER_DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [filters])

  // The one place the dashboard's numbers are loaded. Everything the page
  // renders for a filter state is fetched here and committed together.
  useEffect(() => {
    const id = ++requestId.current
    let cancelled = false
    setLoading(true)
    cursorStack.current = [null]
    setPageIndex(0)

    void Promise.all([
      getSummary(appliedFilters),
      getPending(appliedFilters),
      getOwnerStatus(appliedFilters),
      getReport(appliedFilters),
      listRows(appliedFilters, { cursor: null, limit: pageSize }),
    ]).then(([summary, pending, ownerStatus, report, rows]) => {
      if (cancelled || id !== requestId.current) return

      const firstFailure = [summary, pending, ownerStatus, report, rows].find(
        (result) => !result.ok,
      )
      if (firstFailure && !firstFailure.ok) {
        setFailure({ status: firstFailure.status, error: firstFailure.error })
        setData(null)
        setLoading(false)
        return
      }

      if (summary.ok && pending.ok && ownerStatus.ok && report.ok && rows.ok) {
        setFailure(null)
        // Page 0's cursor is null; page 1's is whatever this response carries.
        cursorStack.current = [null, rows.data.next_cursor]
        setData({
          summary: summary.data,
          pending: pending.data,
          ownerStatus: ownerStatus.data,
          report: report.data,
          rows: rows.data.items,
          rowsTotal: rows.data.total_count,
          rowsHasMore: rows.data.has_more,
          rowsCursor: rows.data.next_cursor,
        })
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [appliedFilters, pageSize])

  // Filter option lists come from the active version's full row set: the
  // read API exposes no distinct-values endpoint and this task does not
  // change the API. Loaded once per active version, never per filter change.
  useEffect(() => {
    let cancelled = false
    setOptionsLoading(true)

    void collectAllRows(EMPTY_FILTERS).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setOptions(deriveFilterOptions(result.rows))
        setOptionsTruncated(result.truncated)
      }
      setOptionsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [activeImport?.import_id])

  const goToPage = useCallback(
    async (targetIndex: number) => {
      const cursor = cursorStack.current[targetIndex] ?? null
      setRowsLoading(true)
      const result = await listRows(appliedFilters, { cursor, limit: pageSize })
      setRowsLoading(false)
      if (!result.ok) {
        setFailure({ status: result.status, error: result.error })
        return
      }
      cursorStack.current[targetIndex + 1] = result.data.next_cursor
      setPageIndex(targetIndex)
      setData((current) =>
        current
          ? {
              ...current,
              rows: result.data.items,
              rowsTotal: result.data.total_count,
              rowsHasMore: result.data.has_more,
              rowsCursor: result.data.next_cursor,
            }
          : current,
      )
    },
    [appliedFilters, pageSize],
  )

  const resetFilters = useCallback(() => {
    setFilters(EMPTY_FILTERS)
    setSearchPlaceholder(DEFAULT_SEARCH_PLACEHOLDER)
    setPendingFocused(false)
    setOverdueOpen(false)
  }, [])

  const showPending = useCallback(() => {
    // `showPending()` in the source resets the filters first, then scrolls to
    // the pending zone. The pending zone is already the pending-only view of
    // the current scope, computed server-side under pending_priority_legacy.
    setFilters(EMPTY_FILTERS)
    setSearchPlaceholder(DEFAULT_SEARCH_PLACEHOLDER)
    setOverdueOpen(false)
    setPendingFocused(true)
    window.requestAnimationFrame(() => {
      document.getElementById('pendingzone')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const runOverdueConsultation = useCallback(async (target: TranselecFilterState) => {
    setOverdueOpen(true)
    setOverdueLoading(true)
    setOverdueError(null)
    setOverdueRows([])

    const reference = observedServerNow() ?? new Date()
    setOverdueReference(reference)

    const result = await collectAllRows(target)
    setOverdueLoading(false)
    if (!result.ok) {
      setOverdueError(classifyFailure(result).message)
      return
    }
    setOverdueRows(selectOverdueRows(result.rows, reference))
  }, [])

  const handleQuick = useCallback(
    (type: QuickActionType) => {
      // Every quick action in the source starts from a clean filter state.
      const base = EMPTY_FILTERS
      setSearchPlaceholder(DEFAULT_SEARCH_PLACEHOLDER)
      setPendingFocused(false)
      if (type !== 'overdue') setOverdueOpen(false)

      switch (type) {
        case 'pending':
          showPending()
          return
        case 'lookup':
          setFilters(base)
          setSearchPlaceholder(LOOKUP_SEARCH_PLACEHOLDER)
          window.requestAnimationFrame(() => searchRef.current?.focus())
          return
        case 'easement': {
          const match =
            options.tipo_propietario.find(
              (option) => option.toLocaleLowerCase('es-CL') === EASEMENT_VALUE.toLowerCase(),
            ) ?? EASEMENT_VALUE
          setFilters({ ...base, tipo_propietario: [match] })
          return
        }
        case 'surface':
          setFilters(base)
          window.requestAnimationFrame(() => {
            document.getElementById('kpis')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          })
          return
        case 'rejected':
          setFilters({ ...base, q: 'rechaz' })
          return
        case 'legal':
          setFilters({ ...base, q: 'legal' })
          return
        case 'company':
          setFilters(base)
          setEmpresaOpenSignal((value) => value + 1)
          window.requestAnimationFrame(() => empresaRef.current?.focus())
          return
        case 'overdue':
          setFilters(base)
          void runOverdueConsultation(base)
          return
      }
    },
    [options.tipo_propietario, runOverdueConsultation, showPending],
  )

  const downloadCsv = useCallback(() => {
    const anchor = document.createElement('a')
    anchor.href = exportCsvUrl(appliedFilters)
    anchor.rel = 'noopener'
    anchor.click()
  }, [appliedFilters])

  const failureView = useMemo(() => (failure ? classifyFailure(failure) : null), [failure])

  if (failureView && !data) {
    return (
      <div className="shell">
        <StateBlock view={failureView}>
          {failureView.kind === 'empty' && canPublish && (
            <Link to={ROUTES.importar} className="btn">
              Importar planilla
            </Link>
          )}
        </StateBlock>
      </div>
    )
  }

  return (
    <div className="shell">
      <NoticeBanner />

      {failureView && data && (
        <AlertBanner title={failureView.title}>{failureView.message}</AlertBanner>
      )}
      {optionsTruncated && (
        <AlertBanner tone="warn" title="Opciones de filtro incompletas">
          La versión activa tiene más filas de las que esta página recorre para construir las
          listas de filtros. Los filtros siguen aplicándose en el servidor sobre el total.
        </AlertBanner>
      )}

      <div className="grid">
        <FilterPanel
          filters={filters}
          options={options}
          optionsLoading={optionsLoading}
          searchPlaceholder={searchPlaceholder}
          searchRef={searchRef}
          empresaRef={empresaRef}
          empresaOpenSignal={empresaOpenSignal}
          onChange={setFilters}
          onReset={resetFilters}
          onExportCsv={downloadCsv}
          onPrint={() => window.print()}
          disabled={!data}
        />

        <main className="main">
          {!data && loading && (
            <section className="panel section">
              <LoadingBlock label="Cargando el alcance seleccionado…" lines={6} />
            </section>
          )}

          {data && (
            <>
              <KpiRow summary={data.summary} />
              <StatusHero summary={data.summary} />
              <ApprovalDonuts summary={data.summary} />
              <ReforestationChips predios={data.summary.predios_reforestacion} />
              <OwnerStatusTable ownerStatus={data.ownerStatus} />
              <QuickActions onQuick={handleQuick} />

              {overdueOpen && (
                <OverduePanel
                  rows={overdueRows}
                  reference={overdueReference}
                  loading={overdueLoading}
                  error={overdueError}
                  onClose={() => setOverdueOpen(false)}
                />
              )}

              <PendingZone
                pending={data.pending}
                focused={pendingFocused}
                onShowPending={showPending}
                onReset={resetFilters}
              />

              <ReportPanel report={data.report} />

              <section className="panel section" aria-labelledby="rows-title">
                <RowsTable
                  rows={data.rows}
                  totalCount={data.rowsTotal}
                  loading={rowsLoading || loading}
                />
                <Pagination
                  pageIndex={pageIndex}
                  pageSize={pageSize}
                  pageRows={data.rows.length}
                  totalCount={data.rowsTotal}
                  hasMore={data.rowsHasMore}
                  loading={rowsLoading || loading}
                  onPrev={() => void goToPage(Math.max(0, pageIndex - 1))}
                  onNext={() => void goToPage(pageIndex + 1)}
                  onPageSizeChange={setPageSize}
                />
              </section>

              <QualityPanel summary={data.summary} />
            </>
          )}

          <ProvenanceFooter activeImport={activeImport} />
        </main>
      </div>
    </div>
  )
}
