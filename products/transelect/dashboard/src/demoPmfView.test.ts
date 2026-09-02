// products/transelect/dashboard/src/demoPmfView.test.ts
import { describe, expect, it } from 'vitest'
import { DEMO_ROWS } from './demoData'
import { buildSummary, filterRows, getPmfDetail, listFilterOptions, listPmfs } from './demoPmfView'

describe('demoPmfView (ported from pmf_view.py)', () => {
  it('lists all 6 distinct PMFs sorted', () => {
    const items = listPmfs(DEMO_ROWS)
    expect(items.map((i) => i.pmf)).toEqual([
      'PMF-DEMO-01', 'PMF-DEMO-02', 'PMF-DEMO-03', 'PMF-DEMO-04', 'PMF-DEMO-05', 'PMF-DEMO-06',
    ])
  })

  it('filters rows by multi-select status with OR semantics within the dimension', () => {
    const filtered = filterRows(DEMO_ROWS, { status: ['Aprobado', 'Rechazado'] })
    expect(filtered.every((r) => r.estadoResumido === 'Aprobado' || r.estadoResumido === 'Rechazado')).toBe(true)
  })

  it('combines dimensions with AND semantics', () => {
    const filtered = filterRows(DEMO_ROWS, { status: ['Aprobado'], sector: ['Sector Norte'] })
    expect(filtered.every((r) => r.estadoResumido === 'Aprobado' && r.sector === 'Sector Norte')).toBe(true)
  })

  it('getPmfDetail groups rows by provisional predio id', () => {
    const detail = getPmfDetail(DEMO_ROWS, 'PMF-DEMO-01')
    expect(detail?.predios.map((p) => p.provisionalPredioId)).toEqual(['PRED-DEMO-001', 'PRED-DEMO-002'])
  })

  it('getPmfDetail returns null for an unknown PMF', () => {
    expect(getPmfDetail(DEMO_ROWS, 'does-not-exist')).toBeNull()
  })

  it('buildSummary sums surface and counts distinct PMFs/predios', () => {
    const summary = buildSummary(DEMO_ROWS)
    expect(summary.distinctPmf).toBe(6)
    expect(summary.businessRows).toBe(DEMO_ROWS.length)
  })

  it('listFilterOptions returns the distinct sorted values per dimension', () => {
    const options = listFilterOptions(DEMO_ROWS)
    expect(options.empresas).toEqual(['Empresa Demo Dos', 'Empresa Demo Tres', 'Empresa Demo Uno'])
  })
})
