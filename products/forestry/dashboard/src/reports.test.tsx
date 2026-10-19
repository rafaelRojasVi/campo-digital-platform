import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from './api.ts'
import Root from './Root.tsx'
import { reportParam, reportPath } from './router.ts'
import { readClipboard, writeClipboard } from './lib/reportClipboard.ts'
import { AddToReportDialog } from './components/AddToReportDialog.tsx'

vi.mock('./api.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api.ts')>()
  return { ...original, fetchForestryRole: vi.fn(), fetchFeatureCollection: vi.fn() }
})
vi.mock('./App.tsx', () => ({ default: () => <p>mapa-stub</p> }))
vi.mock('./pages/InformesPage.tsx', () => ({ InformesPage: () => <p>informes-stub</p> }))
vi.mock('./pages/InformeEditorPage.tsx', () => ({
  InformeEditorPage: ({ reportId }: { reportId: number | null }) => <p>editor-stub {reportId}</p>,
}))

const api = vi.mocked(await import('./api.ts'))

beforeEach(() => {
  vi.clearAllMocks()
  api.fetchForestryRole.mockResolvedValue('operator')
})

afterEach(() => {
  window.history.replaceState(null, '', '/rodales/')
})

describe('report routes', () => {
  it('parses and builds the editor link', () => {
    expect(reportParam(new URLSearchParams('informe=12'))).toBe(12)
    expect(reportParam(new URLSearchParams('informe=x'))).toBeNull()
    expect(reportPath(12)).toBe('/rodales/informes/editar?informe=12')
  })

  it('routes /rodales/informes to the list', async () => {
    window.history.replaceState(null, '', '/rodales/informes')
    render(<Root />)
    expect(await screen.findByText('informes-stub')).toBeInTheDocument()
  })

  it('routes the editor with its report id', async () => {
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=5')
    render(<Root />)
    expect(await screen.findByText('editor-stub 5')).toBeInTheDocument()
  })
})

vi.mock('./reportsApi.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./reportsApi.ts')>()
  return {
    ...original,
    fetchReports: vi.fn(),
    createReport: vi.fn(),
    fetchReport: vi.fn(),
    saveReportFeatures: vi.fn(),
    transitionReport: vi.fn(),
    updateReport: vi.fn(),
    duplicateReport: vi.fn(),
    deleteReport: vi.fn(),
    fetchConafSolicitud: vi.fn(),
    fetchConafSolicitudes: vi.fn(),
    refreshConafSolicitud: vi.fn(),
  }
})

const reportsApi = vi.mocked(await import('./reportsApi.ts'))
const { InformesPage: RealInformesPage } = await vi.importActual<
  typeof import('./pages/InformesPage.tsx')
>('./pages/InformesPage.tsx')

function listedReport(overrides: Partial<import('./reportsApi.ts').Report> = {}) {
  return {
    report_id: 7,
    name: 'Cosecha pino enero 2027',
    report_type: 'cosecha' as const,
    report_month: '2027-01',
    status: 'enviado' as const,
    base_snapshot_id: 3,
    revision: 3,
    created_by_display_name: 'Marco',
    created_at: '2026-10-15T10:00:00Z',
    updated_at: '2026-10-15T10:00:00Z',
    submitted_at: '2026-10-15T10:00:00Z',
    decided_at: null,
    decided_by_display_name: null,
    feature_count: 2,
    managed_feature_count: 1,
    managed_area_ha: 4.05,
    conaf_solicitud: null,
    ...overrides,
  }
}

describe('Informes list', () => {
  it('shows reports with status, managed hectares and the pending count', async () => {
    reportsApi.fetchReports.mockResolvedValue({ reports: [listedReport()], pending_review_count: 1 })
    render(<RealInformesPage role="admin" />)
    expect(await screen.findByText('Cosecha pino enero 2027')).toBeInTheDocument()
    expect(screen.getByText('Enviado')).toBeInTheDocument()
    expect(screen.getByText('4,05 ha')).toBeInTheDocument()
    expect(screen.getByText('Pendientes de revisión: 1')).toBeInTheDocument()
  })

  it('creates a report and opens it', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReports.mockResolvedValue({ reports: [], pending_review_count: 0 })
    reportsApi.createReport.mockResolvedValue(9)
    render(<RealInformesPage role="operator" />)
    await user.click(await screen.findByRole('button', { name: 'Nuevo informe' }))
    await user.type(screen.getByLabelText('Nombre'), 'Raleo Purretrun')
    await user.selectOptions(screen.getByLabelText('Tipo'), 'manejo')
    await user.clear(screen.getByLabelText('Mes'))
    await user.type(screen.getByLabelText('Mes'), '2026-12')
    await user.click(screen.getByRole('button', { name: 'Crear informe' }))
    expect(reportsApi.createReport).toHaveBeenCalledWith('Raleo Purretrun', 'manejo', '2026-12')
    expect(window.location.pathname + window.location.search).toBe(
      '/rodales/informes/editar?informe=9',
    )
  })

  it('offers no «Nuevo informe» to a viewer and explains the empty list', async () => {
    reportsApi.fetchReports.mockResolvedValue({ reports: [], pending_review_count: 0 })
    render(<RealInformesPage role="viewer" />)
    expect(await screen.findByText('Aún no hay informes aprobados.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo informe' })).not.toBeInTheDocument()
  })
})

vi.mock('./components/PrintMap.tsx', () => ({
  PRINT_MANAGED: '#e8a33d',
  PRINT_OTHER: '#2f9e6a',
  PrintMap: ({ features }: { features: unknown[] }) => <p>mapa-impresion {features.length}</p>,
}))
vi.mock('./components/ReportMap.tsx', () => ({
  ReportMap: (props: {
    base: { features: { properties: { feature_ordinal: number } }[] }
    onBaseClick: (ordinal: number, additive: boolean) => void
    onLinePoint: (point: [number, number]) => void
    onFinishLine: () => void
    onPieceClick: (key: string, index: number) => void
    choosePieces: { featureKey: string; index: number; label: string }[]
  }) => (
    <div>
      {props.base.features.map((feature) => (
        <button
          key={feature.properties.feature_ordinal}
          type="button"
          onClick={() => props.onBaseClick(feature.properties.feature_ordinal, false)}
        >
          {`base-${feature.properties.feature_ordinal}`}
        </button>
      ))}
      <button type="button" onClick={() => props.onLinePoint([60, -10])}>punto-1</button>
      <button type="button" onClick={() => props.onLinePoint([60, 110])}>punto-2</button>
      <button type="button" onClick={() => props.onLinePoint([60, 210])}>punto-3</button>
      <button type="button" onClick={() => props.onFinishLine()}>terminar</button>
      {props.choosePieces.map((piece) => (
        <button
          key={`${piece.featureKey}-${piece.index}`}
          type="button"
          onClick={() => props.onPieceClick(piece.featureKey, piece.index)}
        >
          {`pieza-${piece.label}`}
        </button>
      ))}
    </div>
  ),
}))

const { InformeEditorPage: RealEditor } = await vi.importActual<
  typeof import('./pages/InformeEditorPage.tsx')
>('./pages/InformeEditorPage.tsx')

const SQUARE = [[[[0, 0], [0, 100], [100, 100], [100, 0], [0, 0]]]]

function baseCollection() {
  return {
    type: 'FeatureCollection' as const,
    shapefile_snapshot_id: 3,
    storage_srid: 32718,
    feature_count: 1,
    features: [
      {
        type: 'Feature' as const,
        properties: {
          feature_ordinal: 1,
          source_objectid: 11,
          cod_predial: 'PU1',
          nom_predio: 'Purretrun',
          n_rodal: '17',
          cod_uso: 'Pi06',
          uso_2024: null,
          desc_uso: null,
          uso_2026: null,
          cod_uso_2026: null,
          sup_ha: 1,
          geometry_is_valid: true,
          geometry_area_source_units: 10000,
          quality_flags: [],
        },
        geometry: { type: 'MultiPolygon' as const, coordinates: SQUARE },
      },
    ],
  }
}

function reportDetail(overrides: Partial<import('./reportsApi.ts').Report> = {}, withFeature = false) {
  return {
    report: listedReport({ status: 'borrador', revision: 1, feature_count: 0, ...overrides }),
    features: withFeature
      ? [
          {
            position: 1,
            source_feature_ordinal: 1,
            in_report: true,
            geometry_changed: false,
            attributes: { objectid: 11, n_rodal: '17', sup_ha: 1 },
            geometry: { type: 'MultiPolygon' as const, coordinates: SQUARE },
          },
        ]
      : [],
    sources: withFeature
      ? [
          {
            source_feature_ordinal: 1,
            attributes: { objectid: 11, n_rodal: '17', sup_ha: 1 },
            geometry: { type: 'MultiPolygon' as const, coordinates: SQUARE },
            is_valid: true,
          },
        ]
      : [],
    notes: [
      {
        kind: 'cambios_solicitados' as const,
        body: 'Saca el rodal 18.',
        author_display_name: 'Javier',
        created_at: '2026-10-15T12:00:00Z',
      },
    ],
    srid: 32718,
    published_snapshot_id: 3,
  }
}

describe('Informe editor', () => {
  beforeEach(() => {
    api.fetchFeatureCollection.mockResolvedValue(baseCollection())
    window.sessionStorage.clear()
  })

  it('copies a base polygon, pastes it and saves it without geometry', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail())
    reportsApi.saveReportFeatures.mockResolvedValue({ revision: 2, feature_count: 1, warnings: [] })
    render(<RealEditor role="operator" reportId={7} />)

    await user.click(await screen.findByRole('button', { name: 'base-1' }))
    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    await user.click(screen.getByRole('button', { name: 'Pegar al informe' }))
    expect(screen.getByText('1 polígono · 0 en el área de manejo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(reportsApi.saveReportFeatures).toHaveBeenCalledWith(7, 1, [
      { source_feature_ordinal: 1, in_report: false, attributes: {}, geometry: null },
    ])
    expect(await screen.findByText('Informe guardado.')).toBeInTheDocument()
  })

  it('splits with a line, marks the harvested piece and names it 17-1', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)

    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'punto-2' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    expect(screen.getByText('Toca la parte que se cosecha.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^pieza-A/ }))
    await user.click(screen.getByRole('button', { name: 'Listo' }))

    expect(screen.getByText('2 polígonos · 1 en el área de manejo')).toBeInTheDocument()
    expect(screen.getByText(/^17-1/)).toBeInTheDocument()
  })

  it('explains a line that does not cross the rodal and keeps drawing', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    expect(screen.getByText('Haga clic en al menos dos puntos para dibujar la línea.')).toBeInTheDocument()
  })

  it('undo restores the report before the split', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'punto-2' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    await user.click(screen.getByRole('button', { name: /^pieza-A/ }))
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    await user.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(screen.getByText('1 polígono · 1 en el área de manejo')).toBeInTheDocument()
  })

  it('submits after saving unsaved changes', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport
      .mockResolvedValueOnce(reportDetail({}, true))
      .mockResolvedValueOnce(reportDetail({ status: 'enviado', revision: 3 }, true))
    reportsApi.saveReportFeatures.mockResolvedValue({ revision: 2, feature_count: 1, warnings: [] })
    reportsApi.transitionReport.mockResolvedValue({ report_id: 7, status: 'enviado', revision: 3 })
    render(<RealEditor role="operator" reportId={7} />)

    // Unmark and mark again: an unsaved change that keeps a managed polygon.
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Enviar a revisión' }))

    expect(reportsApi.saveReportFeatures).toHaveBeenCalledWith(7, 1, expect.any(Array))
    expect(reportsApi.transitionReport).toHaveBeenCalledWith(7, 'submit', 2)
  })

  it('keeps the draft when a save fails and shows the server message', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.saveReportFeatures.mockRejectedValue(
      new ApiError(422, 'x', 'Dos polígonos del informe se superponen.', 'overlap', 1),
    )
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Rodal 17: Dos polígonos del informe se superponen.')).toBeInTheDocument()
    expect(screen.getByText('1 polígono · 0 en el área de manejo')).toBeInTheDocument()
  })

  it('offers reload on stale_revision', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.saveReportFeatures.mockRejectedValue(
      new ApiError(409, 'x', 'Otra persona guardó cambios en este informe; recárguelo.', 'stale_revision'),
    )
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('button', { name: 'Recargar' })).toBeInTheDocument()
  })

  it('lets an admin review: change list, then request changes with a note', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'enviado', revision: 3 }, true))
    reportsApi.transitionReport.mockResolvedValue({
      report_id: 7,
      status: 'cambios_solicitados',
      revision: 4,
    })
    render(<RealEditor role="admin" reportId={7} />)

    expect(await screen.findByText('Rodal 17 agregado completo')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pedir cambios' }))
    const send = screen.getByRole('button', { name: 'Enviar nota' })
    expect(send).toBeDisabled()
    await user.type(screen.getByLabelText('Qué hay que cambiar'), 'Saca el rodal 18.')
    await user.click(send)
    expect(reportsApi.transitionReport).toHaveBeenCalledWith(7, 'request-changes', 3, 'Saca el rodal 18.')
  })

  it('shows the returned note to the editor', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'cambios_solicitados', revision: 4 }, true))
    render(<RealEditor role="operator" reportId={7} />)
    expect(await screen.findByText('Saca el rodal 18.')).toBeInTheDocument()
  })

  it('is read-only for a viewer and hides review notes', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'aprobado', revision: 5 }, true))
    render(<RealEditor role="viewer" reportId={7} />)
    expect(await screen.findByRole('link', { name: 'Shapefile (.zip)' })).toHaveAttribute(
      'href',
      '/api/forestry/reports/7/export?format=shp&scope=all',
    )
    expect(screen.queryByRole('button', { name: 'Dividir con línea' })).not.toBeInTheDocument()
    expect(screen.queryByText('Saca el rodal 18.')).not.toBeInTheDocument()
  })
})

function twoRodales() {
  const detail = reportDetail({}, true)
  const UPPER = [[[[0, 100], [0, 200], [100, 200], [100, 100], [0, 100]]]]
  detail.features.push({
    position: 2,
    source_feature_ordinal: 2,
    in_report: false,
    geometry_changed: false,
    attributes: { objectid: 12, n_rodal: '18', sup_ha: 1 },
    geometry: { type: 'MultiPolygon' as const, coordinates: UPPER },
  })
  detail.sources.push({
    source_feature_ordinal: 2,
    attributes: { objectid: 12, n_rodal: '18', sup_ha: 1 },
    geometry: { type: 'MultiPolygon' as const, coordinates: UPPER },
    is_valid: true,
  })
  return detail
}

describe('Informe editor — review fixes', () => {
  beforeEach(() => {
    api.fetchFeatureCollection.mockResolvedValue(baseCollection())
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=7')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks before leaving with unsaved changes through an in-app link', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('link', { name: '← Informes' }))
    expect(confirm).toHaveBeenCalled()
    expect(window.location.pathname).toBe('/rodales/informes/editar')
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('link', { name: '← Informes' }))
    expect(window.location.pathname).toBe('/rodales/informes')
  })

  it('keeps changes made while a save is in flight as unsaved', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    let finish: (value: { revision: number; feature_count: number; warnings: never[] }) => void = () => {}
    reportsApi.saveReportFeatures.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await user.click(screen.getByRole('checkbox', { name: /Área de manejo/ }))
    finish({ revision: 2, feature_count: 1, warnings: [] })
    expect(await screen.findByText('Informe guardado.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('undo of a field edit shows the previous value again', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: /^17/ }))
    await user.type(screen.getByLabelText('Uso 2026'), 'PLANTACION')
    await user.tab()
    await user.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(screen.getByLabelText('Uso 2026')).toHaveValue('')
  })

  it('a line across two rodales splits only the one with a chosen part', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(twoRodales())
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'punto-3' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    await user.click(screen.getByRole('button', { name: /^pieza-A/ }))
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    expect(screen.getByText('3 polígonos · 1 en el área de manejo')).toBeInTheDocument()
  })

  it('asks for a part when «Listo» is pressed with none chosen', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Dividir con línea' }))
    await user.click(screen.getByRole('button', { name: 'punto-1' }))
    await user.click(screen.getByRole('button', { name: 'punto-2' }))
    await user.click(screen.getByRole('button', { name: 'Terminar línea' }))
    await user.click(screen.getByRole('button', { name: 'Listo' }))
    expect(screen.getByText('Toque al menos una parte, o use «Ninguna por ahora».')).toBeInTheDocument()
    expect(screen.getByText('1 polígono · 1 en el área de manejo')).toBeInTheDocument()
  })

  it('names the rodal of a server error and selects it', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.saveReportFeatures.mockRejectedValue(
      new ApiError(422, 'x', 'Dos polígonos del informe se superponen.', 'overlap', 1),
    )
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Rodal 17: Dos polígonos del informe se superponen.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^17/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('refuses a value longer than its field before saving', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: /^17/ }))
    await user.type(screen.getByLabelText('N_Rodal_te'), '12-A')
    await user.tab()
    expect(screen.getByText('Texto demasiado largo para este campo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('lets an admin archive a report sent back for changes', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'cambios_solicitados', revision: 4 }, true))
    render(<RealEditor role="admin" reportId={7} />)
    expect(await screen.findByRole('button', { name: 'Archivar' })).toBeInTheDocument()
  })
})

function conafFound(): import('./reportsApi.ts').ConafSolicitud {
  return {
    numero: '090663',
    lookup_status: 'found',
    tipo: 'PLAN DE MANEJO',
    estado: 'EN EVALUACION',
    superficie_ha: 3,
    fecha_ingreso: '2026-09-01',
    fecha_resolucion: null,
    returned_solicitud: null,
    checked_at: new Date().toISOString(),
    found_at: new Date().toISOString(),
    estado_changed_at: null,
    stale: false,
    recently_changed: false,
    conaf_url: 'https://oficinavirtual.conaf.cl/consultas/action.php?nsolicitud=090663',
  }
}

describe('Estado CONAF in Rodales', () => {
  beforeEach(() => {
    api.fetchFeatureCollection.mockResolvedValue(baseCollection())
  })

  it('saves the number without touching the draft', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.updateReport.mockResolvedValue({ report_id: 7, status: 'borrador', revision: 2 })
    reportsApi.fetchConafSolicitud.mockResolvedValue(conafFound())
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.type(screen.getByLabelText('N.º solicitud CONAF'), '90663')
    await user.click(screen.getByRole('button', { name: 'Guardar N.º' }))
    expect(reportsApi.updateReport).toHaveBeenCalledWith(7, 1, { conaf_solicitud: '090663' })
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
    // Saved: nothing new to save until the number changes.
    expect(screen.getByRole('button', { name: 'Guardar N.º' })).toBeDisabled()
    // The unsaved mark is still unsaved.
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('never saves the number and the draft at the same time', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.saveReportFeatures.mockReturnValue(new Promise(() => {}))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.type(screen.getByLabelText('N.º solicitud CONAF'), '90663')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(screen.getByRole('button', { name: 'Guardar N.º' })).toBeDisabled()
  })

  it('blocks the draft buttons while the number is saving', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    reportsApi.updateReport.mockReturnValue(new Promise(() => {}))
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('checkbox', { name: /Área de manejo/ }))
    await user.type(screen.getByLabelText('N.º solicitud CONAF'), '90663')
    await user.click(screen.getByRole('button', { name: 'Guardar N.º' }))
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enviar a revisión' })).toBeDisabled()
  })

  it('offers a retry when CONAF cannot be read at first', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ conaf_solicitud: '090663' }, true))
    reportsApi.fetchConafSolicitud
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce(conafFound())
    render(<RealEditor role="operator" reportId={7} />)
    await user.click(await screen.findByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
  })

  it('lets the number be added to an approved report, not an archived one', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'aprobado', revision: 6 }, true))
    const { unmount } = render(<RealEditor role="operator" reportId={7} />)
    expect(await screen.findByLabelText('N.º solicitud CONAF')).toBeInTheDocument()
    unmount()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'archivado', revision: 7 }, true))
    render(<RealEditor role="admin" reportId={7} />)
    expect(await screen.findByText('Sin N.º de solicitud CONAF.')).toBeInTheDocument()
    expect(screen.queryByLabelText('N.º solicitud CONAF')).not.toBeInTheDocument()
  })

  it('refuses a number CONAF cannot answer before saving', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    await user.type(await screen.findByLabelText('N.º solicitud CONAF'), '12/34')
    await user.click(screen.getByRole('button', { name: 'Guardar N.º' }))
    expect(screen.getByText('Solo dígitos, hasta 9.')).toBeInTheDocument()
    expect(reportsApi.updateReport).not.toHaveBeenCalled()
  })

  it('shows the CONAF column in the list from stored data', async () => {
    reportsApi.fetchReports.mockResolvedValue({
      reports: [listedReport({ conaf_solicitud: '090663' })],
      pending_review_count: 0,
    })
    reportsApi.fetchConafSolicitudes.mockResolvedValue([conafFound()])
    render(<RealInformesPage role="viewer" />)
    expect(await screen.findByText('En evaluación')).toBeInTheDocument()
    expect(screen.getByText('090663')).toBeInTheDocument()
    expect(reportsApi.fetchConafSolicitudes).toHaveBeenCalledWith(['090663'])
  })

  it('flags a number CONAF no longer finds, even over an older reading', async () => {
    reportsApi.fetchReports.mockResolvedValue({
      reports: [
        listedReport({ report_id: 1, name: 'Uno', conaf_solicitud: '090663' }),
        listedReport({ report_id: 2, name: 'Dos', conaf_solicitud: '090664' }),
      ],
      pending_review_count: 0,
    })
    reportsApi.fetchConafSolicitudes.mockResolvedValue([
      { ...conafFound(), lookup_status: 'not_found' },
      { ...conafFound(), numero: '090664', lookup_status: 'mismatch', returned_solicitud: '069025' },
    ])
    render(<RealInformesPage role="viewer" />)
    expect(await screen.findByText('No existe en CONAF')).toBeInTheDocument()
    expect(screen.getByText('Revisar N.º')).toBeInTheDocument()
    expect(screen.queryByText('En evaluación')).not.toBeInTheDocument()
  })

  it('keeps the CONAF section below the report work', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({}, true))
    render(<RealEditor role="operator" reportId={7} />)
    const heading = await screen.findByRole('heading', { name: 'Estado en CONAF' })
    const submit = screen.getByRole('button', { name: 'Enviar a revisión' })
    expect(submit.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('Agregar a un informe (from the map)', () => {
  beforeEach(() => {
    api.fetchFeatureCollection.mockResolvedValue(baseCollection())
    window.sessionStorage.clear()
  })

  it('offers only editable reports of the same base and sends the polygons to the chosen one', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReports.mockResolvedValue({
      reports: [
        listedReport({ report_id: 4, name: 'Raleo Lumaco', status: 'borrador' }),
        listedReport({ report_id: 5, name: 'Cosecha enviada', status: 'enviado' }),
        listedReport({ report_id: 6, name: 'Base antigua', status: 'borrador', base_snapshot_id: 2 }),
      ],
      pending_review_count: 0,
    })
    const onClose = vi.fn()
    render(<AddToReportDialog snapshotId={3} ordinals={[1, 2]} onClose={onClose} />)

    expect(await screen.findByRole('radio', { name: /Raleo Lumaco/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Cosecha enviada/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Base antigua/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Raleo Lumaco/ }))
    await user.click(screen.getByRole('button', { name: 'Agregar 2 polígonos' }))

    expect(readClipboard()).toEqual({ base_snapshot_id: 3, ordinals: [1, 2] })
    expect(window.location.pathname + window.location.search).toBe(
      '/rodales/informes/editar?informe=4&pegar=1',
    )
  })

  it('creates a new report and opens it ready to paste', async () => {
    const user = userEvent.setup()
    reportsApi.fetchReports.mockResolvedValue({ reports: [], pending_review_count: 0 })
    reportsApi.createReport.mockResolvedValue(9)
    render(<AddToReportDialog snapshotId={3} ordinals={[1]} onClose={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Crear un informe nuevo' }))
    await user.type(screen.getByLabelText('Nombre'), 'Cosecha pino 2027')
    await user.click(screen.getByRole('button', { name: 'Crear informe' }))

    expect(readClipboard()).toEqual({ base_snapshot_id: 3, ordinals: [1] })
    expect(window.location.pathname + window.location.search).toBe(
      '/rodales/informes/editar?informe=9&pegar=1',
    )
  })

  it('the editor pastes the copied polygons on arrival and clears the request', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail())
    writeClipboard({ base_snapshot_id: 3, ordinals: [1] })
    window.history.replaceState(null, '', '/rodales/informes/editar?informe=7&pegar=1')
    render(<RealEditor role="operator" reportId={7} />)

    expect(await screen.findByText('1 polígono · 0 en el área de manejo')).toBeInTheDocument()
    expect(screen.getByText('1 polígono agregado al informe.')).toBeInTheDocument()
    expect(window.location.search).toBe('?informe=7')
  })
})

describe('Imprimir / PDF', () => {
  it('prints the report: header, map, legend and the table with totals', async () => {
    const user = userEvent.setup()
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    reportsApi.fetchReport.mockResolvedValue({
      ...reportDetail({ status: 'aprobado', conaf_solicitud: '090663' }, true),
    })
    const { InformePrintPage } = await import('./pages/InformePrintPage.tsx')
    render(<InformePrintPage reportId={7} />)

    expect(await screen.findByRole('heading', { name: 'Cosecha pino enero 2027' })).toBeInTheDocument()
    expect(screen.getByText(/Aprobado · Solicitud CONAF N.º 090663/)).toBeInTheDocument()
    expect(screen.getByText('mapa-impresion 1')).toBeInTheDocument()
    expect(screen.getByText(/Área de manejo · 1,00 ha/)).toBeInTheDocument()
    expect(screen.getByText('Total (1 polígonos)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Imprimir o guardar como PDF' }))
    expect(print).toHaveBeenCalled()
    print.mockRestore()
  })

  it('links the editor to the printable page once saved', async () => {
    reportsApi.fetchReport.mockResolvedValue(reportDetail({ status: 'aprobado' }, true))
    api.fetchFeatureCollection.mockResolvedValue(baseCollection())
    render(<RealEditor role="viewer" reportId={7} />)
    expect(await screen.findByRole('link', { name: 'Imprimir / PDF' })).toHaveAttribute(
      'href',
      '/rodales/informes/imprimir?informe=7',
    )
  })
})
