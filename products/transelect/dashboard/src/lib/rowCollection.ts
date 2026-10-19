/**
 * Bounded, cursor-following collection of every row in one filter state.
 *
 * Two things need the whole row set rather than one page:
 *
 *  - the five multi-select filters' option lists (TR-FUNC-018-022), which
 *    must offer every distinct value in the active version, not just the
 *    values that happen to appear on page one;
 *  - the "90 días" consultation (TR-FUNC-031), whose predicate is not
 *    expressible in the read API's filter contract.
 *
 * The read API deliberately exposes no "distinct values" endpoint, and this
 * task does not change the API. Paging `/transelec/pmfs` is therefore how
 * both are obtained: once per active version for the options, and on demand
 * for the 90-day consultation. `maxPages` keeps that bounded — this walks a
 * cursor, so an unbounded loop is the failure mode worth guarding against,
 * not a large workbook.
 */

import type { ApiResult, ResumenRow, TranselecFilterState, TranselecRowsPage } from '../api'
import { MULTISELECT_FIELDS, listRows } from '../api'

export type PageFetcher = (
  filters: TranselecFilterState,
  options: { cursor?: string | null; limit?: number },
) => Promise<ApiResult<TranselecRowsPage>>

export interface CollectOptions {
  limit?: number
  maxPages?: number
  fetchPage?: PageFetcher
}

export type CollectResult =
  | { ok: true; rows: ResumenRow[]; truncated: boolean }
  | { ok: false; status: number; error: string }

// The Explorador's filter options and the web-edit suggestions both walk
// every row on arrival (about 1.4 MB for 729 rows). A walk already in progress
// for the same filters is shared instead of started twice; once it settles the
// next call walks again, so a web edit is never hidden behind a stale copy.
const inFlight = new WeakMap<PageFetcher, Map<string, Promise<CollectResult>>>()

export function collectAllRows(
  filters: TranselecFilterState,
  { limit = 200, maxPages = 60, fetchPage = listRows }: CollectOptions = {},
): Promise<CollectResult> {
  const key = JSON.stringify([filters, limit, maxPages])
  let walks = inFlight.get(fetchPage)
  if (walks === undefined) {
    walks = new Map()
    inFlight.set(fetchPage, walks)
  }
  const running = walks.get(key)
  if (running !== undefined) return running
  const walk = walkAllRows(filters, limit, maxPages, fetchPage).finally(() => walks.delete(key))
  walks.set(key, walk)
  return walk
}

async function walkAllRows(
  filters: TranselecFilterState,
  limit: number,
  maxPages: number,
  fetchPage: PageFetcher,
): Promise<CollectResult> {
  const rows: ResumenRow[] = []
  let cursor: string | null = null

  for (let page = 0; page < maxPages; page += 1) {
    const result: ApiResult<TranselecRowsPage> = await fetchPage(filters, { cursor, limit })
    if (!result.ok) return { ok: false, status: result.status, error: result.error }

    rows.push(...result.data.items)
    if (!result.data.has_more || !result.data.next_cursor) {
      return { ok: true, rows, truncated: false }
    }
    cursor = result.data.next_cursor
  }

  // Reached only if the active version is larger than maxPages * limit rows.
  // Reported rather than hidden — a silent cap is the exact defect
  // TR-FUNC-039 exists to remove.
  return { ok: true, rows, truncated: true }
}

export type DerivedFilterOptions = Record<(typeof OPTION_FIELDS)[number], string[]>

const OPTION_FIELDS = MULTISELECT_FIELDS

/** Distinct, non-blank, Spanish-collated values per filterable field. */
export function deriveFilterOptions(rows: readonly ResumenRow[]): DerivedFilterOptions {
  const options = Object.fromEntries(
    OPTION_FIELDS.map((field) => {
      const values = new Set<string>()
      for (const row of rows) {
        const value = (row[field] ?? '').trim()
        if (value !== '') values.add(value)
      }
      return [field, [...values].sort((a, b) => a.localeCompare(b, 'es'))]
    }),
  )
  return options as DerivedFilterOptions
}
