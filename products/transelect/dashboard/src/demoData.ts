// products/transelect/dashboard/src/demoData.ts
//
// Fully synthetic PMF/predio tracking rows. No PMF id, predio id, empresa,
// or role name here corresponds to a real Transelec workbook row. See
// docs/adr/ADR-008-hosted-demo-data-v1.md.
export interface DemoResumenRow {
  sourceRowNumber: number
  pmf: string
  provisionalPredioId: string | null
  estado: string
  estadoResumido: string
  superficieCorta: number | null
  numeroIngreso: string | null
  fechaIngreso: string | null
  rol: string | null
  empresa: string
  sector: string
  tramite: string | null
  tipoPropietario: string
  pas: string
  tipoRechazo: string | null
  numeroAreaCorta: string | null
}

const EMPRESAS = ['Empresa Demo Uno', 'Empresa Demo Dos', 'Empresa Demo Tres'] as const
const SECTORES = ['Sector Norte', 'Sector Centro', 'Sector Sur'] as const
const PAS_VALUES = ['PAS Ambiental', 'PAS Forestal'] as const

function row(
  n: number,
  pmf: string,
  predio: string,
  estadoResumido: string,
  overrides: Partial<DemoResumenRow> = {},
): DemoResumenRow {
  return {
    sourceRowNumber: n,
    pmf,
    provisionalPredioId: predio,
    estado: estadoResumido,
    estadoResumido,
    superficieCorta: null,
    numeroIngreso: `ING-DEMO-${String(n).padStart(3, '0')}`,
    fechaIngreso: '2026-07-01',
    rol: `ROL-DEMO-${String(n).padStart(3, '0')}`,
    empresa: EMPRESAS[n % EMPRESAS.length],
    sector: SECTORES[n % SECTORES.length],
    tramite: 'Corta',
    tipoPropietario: n % 3 === 0 ? 'Empresa' : 'Particular',
    pas: PAS_VALUES[n % PAS_VALUES.length],
    tipoRechazo: estadoResumido === 'Rechazado' ? 'Antecedentes incompletos (demo)' : null,
    numeroAreaCorta: `AC-${String(n).padStart(2, '0')}`,
    ...overrides,
  }
}

export const DEMO_ROWS: DemoResumenRow[] = [
  row(1, 'PMF-DEMO-01', 'PRED-DEMO-001', 'Aprobado', { superficieCorta: 4.2 }),
  row(2, 'PMF-DEMO-01', 'PRED-DEMO-001', 'Aprobado', { superficieCorta: 1.8, numeroAreaCorta: 'AC-02b' }),
  row(3, 'PMF-DEMO-01', 'PRED-DEMO-002', 'En tramitación', { superficieCorta: 3.1 }),
  row(4, 'PMF-DEMO-02', 'PRED-DEMO-003', 'Aprobado', { superficieCorta: 6.5 }),
  row(5, 'PMF-DEMO-02', 'PRED-DEMO-004', 'Ingresado', { superficieCorta: 2.4 }),
  row(6, 'PMF-DEMO-02', 'PRED-DEMO-004', 'Ingresado', { superficieCorta: 2.0, numeroAreaCorta: 'AC-06b' }),
  row(7, 'PMF-DEMO-03', 'PRED-DEMO-005', 'Rechazado', { superficieCorta: 1.1 }),
  row(8, 'PMF-DEMO-03', 'PRED-DEMO-006', 'Aprobado', { superficieCorta: 5.3 }),
  row(9, 'PMF-DEMO-03', 'PRED-DEMO-007', 'En tramitación', { superficieCorta: 3.9 }),
  row(10, 'PMF-DEMO-04', 'PRED-DEMO-008', 'Aprobado', { superficieCorta: 2.7 }),
  row(11, 'PMF-DEMO-04', 'PRED-DEMO-009', 'Aprobado', { superficieCorta: 4.4 }),
  row(12, 'PMF-DEMO-04', 'PRED-DEMO-010', 'Ingresado', { superficieCorta: 1.6 }),
  row(13, 'PMF-DEMO-05', 'PRED-DEMO-011', 'En tramitación', { superficieCorta: 2.2 }),
  row(14, 'PMF-DEMO-05', 'PRED-DEMO-012', 'Aprobado', { superficieCorta: 3.3 }),
  row(15, 'PMF-DEMO-06', 'PRED-DEMO-013', 'Rechazado', { superficieCorta: 0.9 }),
  row(16, 'PMF-DEMO-06', 'PRED-DEMO-014', 'Aprobado', { superficieCorta: 5.0 }),
  row(17, 'PMF-DEMO-06', 'PRED-DEMO-014', 'Aprobado', { superficieCorta: 1.5, numeroAreaCorta: 'AC-17b' }),
  row(18, 'PMF-DEMO-06', 'PRED-DEMO-015', 'Ingresado', { superficieCorta: 2.9 }),
]
