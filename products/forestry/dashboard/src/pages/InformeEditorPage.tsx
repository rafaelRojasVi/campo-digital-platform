/**
 * One management report: the editor (operator, admin; borrador or
 * cambios_solicitados), the review (admin; enviado) and the read-only view
 * (everyone else). Layout A of the design: toolbar, map, report panel.
 *
 * The report's base snapshot is shown, not necessarily the published one.
 * Edits stay in an immutable draft with undo/redo until «Guardar»;
 * «Enviar a revisión» saves first.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, canUpload, fetchFeatureCollection, mutationMessage } from '../api.ts'
import { ConfirmDialog } from '../components/ConfirmDialog.tsx'
import { Header } from '../components/Header.tsx'
import { Notice } from '../components/PageShell.tsx'
import { ReportMap, type ChoosePiece, type MapMode } from '../components/ReportMap.tsx'
import { ConafCard } from '../components/ConafCard.tsx'
import { ReportStatusChip } from '../components/ReportStatusChip.tsx'
import { normalizeSolicitud } from '../lib/conafEstado.ts'
import { createHistory, recordHistory, redoHistory, undoHistory, type History } from '../lib/history.ts'
import { describeChanges } from '../lib/reportChanges.ts'
import {
  EDITABLE_ATTRIBUTES,
  applySplit,
  draftFromDetail,
  draftSummary,
  featureCode,
  pasteSources,
  removeSources,
  setAttribute,
  toSaveFeatures,
  toggleInReport,
  type DraftFeature,
  type ReportDraft,
} from '../lib/reportDraft.ts'
import { multiPolygonAreaSquareMeters } from '../lib/draftGeometry.ts'
import { SPLIT_MESSAGES, interiorPoint, lineCrosses, splitByPolyline, type Coordinates, type Position } from '../lib/splitGeometry.ts'
import {
  TYPE_LABELS,
  updateReport,
  duplicateReport,
  deleteReport,
  exportUrl,
  fetchReport,
  isEditableStatus,
  saveReportFeatures,
  transitionReport,
  type ReportDetail,
  type ReportWarning,
} from '../reportsApi.ts'
import { ROUTES, navigate, onLinkClick, reportPath, setLeaveGuard } from '../router.ts'
import type { FeatureCollection, ForestryRole } from '../types.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CLIPBOARD_KEY = 'rodales.informes.portapapeles'

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; detail: ReportDetail; base: FeatureCollection }

interface Clipboard {
  base_snapshot_id: number
  ordinals: number[]
}

interface Pending {
  pieces: { featureKey: string; coordinates: Coordinates[] }[]
  managed: Set<string>
}

function readClipboard(): Clipboard | null {
  try {
    const raw = window.sessionStorage.getItem(CLIPBOARD_KEY)
    return raw === null ? null : (JSON.parse(raw) as Clipboard)
  } catch {
    return null
  }
}

function writeClipboard(clipboard: Clipboard): void {
  try {
    window.sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(clipboard))
  } catch {
    // Storage blocked: copy/paste still works inside this page.
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function InformeEditorPage({ role, reportId }: { role: ForestryRole; reportId: number | null }) {
  // Root remounts this page per ?informe=, so the id never changes here.
  const [load, setLoad] = useState<Load>(
    reportId === null ? { status: 'missing' } : { status: 'loading' },
  )
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (reportId === null) return
    let cancelled = false
    fetchReport(reportId)
      .then(async (detail) => {
        const base = await fetchFeatureCollection(detail.report.base_snapshot_id)
        if (!cancelled) setLoad({ status: 'ready', detail, base })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setLoad(error instanceof ApiError && error.status === 404 ? { status: 'missing' } : { status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [reportId, nonce])

  const reload = useCallback(() => {
    setLoad({ status: 'loading' })
    setNonce((n) => n + 1)
  }, [])

  return (
    <div className="page-app report-app">
      <Header active={ROUTES.informe} role={role} />
      {load.status === 'loading' ? <p className="page__busy report-app__status">Cargando informe…</p> : null}
      {load.status === 'missing' ? (
        <div className="report-app__status">
          <Notice tone="warn" title="No se encontró el informe.">
            <a href={ROUTES.informes} onClick={(event) => onLinkClick(event, ROUTES.informes)}>
              Volver a Informes
            </a>
          </Notice>
        </div>
      ) : null}
      {load.status === 'error' ? (
        <div className="report-app__status">
          <Notice tone="error" title="No fue posible cargar el informe.">
            <button type="button" className="button button--ghost" onClick={reload}>
              Reintentar
            </button>
          </Notice>
        </div>
      ) : null}
      {load.status === 'ready' ? (
        <Editor key={`${load.detail.report.report_id}-${load.detail.report.revision}-${nonce}`} role={role} detail={load.detail} base={load.base} onReload={reload} />
      ) : null}
    </div>
  )
}

function Editor({
  role,
  detail,
  base,
  onReload,
}: {
  role: ForestryRole
  detail: ReportDetail
  base: FeatureCollection
  onReload: () => void
}) {
  const report = detail.report
  const editable = canUpload(role) && isEditableStatus(report.status)
  const reviewing = role === 'admin' && report.status === 'enviado'

  const [initialDraft] = useState<ReportDraft>(() => draftFromDetail(detail))
  const [draft, setDraft] = useState<ReportDraft>(initialDraft)
  // The last draft the server accepted; anything else is unsaved, including
  // edits made while a save was in flight.
  const [savedDraft, setSavedDraft] = useState<ReportDraft>(initialDraft)
  const dirty = draft !== savedDraft
  // The current draft for async callbacks (save/submit) that outlive a render.
  const draftRef = useRef(draft)
  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  const [history, setHistory] = useState<History<ReportDraft>>(createHistory)
  const [revision, setRevision] = useState(report.revision)
  // The CONAF number is saved on its own (PATCH of the header), so it never
  // touches the polygon draft or its unsaved state.
  const [conafNumero, setConafNumero] = useState<string | null>(report.conaf_solicitud)
  const [conafInput, setConafInput] = useState(report.conaf_solicitud ?? '')
  const [conafError, setConafError] = useState<string | null>(null)
  const [conafBusy, setConafBusy] = useState(false)
  const [mode, setMode] = useState<MapMode>(editable ? 'select' : 'view')
  const [selectedOrdinals, setSelectedOrdinals] = useState<Set<number>>(new Set())
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [linePoints, setLinePoints] = useState<Position[]>([])
  const [pending, setPending] = useState<Pending | null>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'success' | 'warn' | 'error'; text: string; stale?: boolean } | null>(null)
  const [warnings, setWarnings] = useState<ReportWarning[]>([])
  const [busy, setBusy] = useState(false)
  const [showBase, setShowBase] = useState(false)
  const [dialog, setDialog] = useState<'approve' | 'changes' | 'archive' | 'delete' | null>(null)
  const [note, setNote] = useState('')
  const [onlyMarked, setOnlyMarked] = useState(false)
  // ReportMap fits the view when it mounts (the editor remounts per revision).
  const fitNonce = 0

  const baseByOrdinal = useMemo(
    () => new Map(base.features.map((feature) => [feature.properties.feature_ordinal, feature])),
    [base],
  )
  const sourceValues = useMemo(() => {
    const values = new Map<number, Record<string, string | null>>()
    for (const source of detail.sources) {
      values.set(source.source_feature_ordinal, Object.fromEntries(
        Object.entries(source.attributes).map(([key, value]) => [key, value === null ? null : String(value)]),
      ))
    }
    for (const feature of base.features) {
      if (values.has(feature.properties.feature_ordinal)) continue
      const p = feature.properties
      values.set(p.feature_ordinal, {
        n_rodal: p.n_rodal, cod_uso: p.cod_uso, uso_2024: p.uso_2024, desc_uso: p.desc_uso,
        uso_2026: p.uso_2026, cod_uso_2026: p.cod_uso_2026, n_rodal_te: null,
      })
    }
    return values
  }, [detail.sources, base])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    // In-app links and Back do not unload the page; the router asks this guard.
    setLeaveGuard(() => window.confirm('Hay cambios sin guardar. ¿Salir de todos modos?'))
    return () => {
      window.removeEventListener('beforeunload', warn)
      setLeaveGuard(null)
    }
  }, [dirty])

  const change = useCallback(
    (next: ReportDraft) => {
      setHistory((current) => recordHistory(current, draft))
      setDraft(next)
    },
    [draft],
  )

  const undo = useCallback(() => {
    const step = undoHistory(history, draft)
    if (step === null) return
    setHistory(step.history)
    setDraft(step.value)
  }, [history, draft])

  const redo = useCallback(() => {
    const step = redoHistory(history, draft)
    if (step === null) return
    setHistory(step.history)
    setDraft(step.value)
  }, [history, draft])

  // --- Selection, copy, paste -------------------------------------------------

  const onBaseClick = useCallback((ordinal: number, additive: boolean) => {
    setSelectedOrdinals((current) => {
      const next = new Set(additive ? current : [])
      if (current.has(ordinal) && additive) next.delete(ordinal)
      else next.add(ordinal)
      return next
    })
  }, [])

  const onFeatureClick = useCallback((key: string, additive: boolean) => {
    setSelectedKeys((current) => {
      const next = new Set(additive ? current : [])
      if (current.has(key) && additive) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const copy = useCallback(() => {
    const ordinals = [...selectedOrdinals]
    writeClipboard({ base_snapshot_id: report.base_snapshot_id, ordinals })
    setMessage({ tone: 'info', text: `${plural(ordinals.length, 'polígono copiado', 'polígonos copiados')}. Use «Pegar al informe».` })
  }, [selectedOrdinals, report.base_snapshot_id])

  const paste = useCallback(() => {
    const clipboard = readClipboard()
    if (clipboard === null || clipboard.ordinals.length === 0) {
      setMessage({ tone: 'warn', text: 'No hay polígonos copiados. Seleccione rodales en el mapa y use «Copiar».' })
      return
    }
    if (clipboard.base_snapshot_id !== report.base_snapshot_id) {
      setMessage({ tone: 'warn', text: 'Los polígonos copiados son de otra versión de la base.' })
      return
    }
    const sources = clipboard.ordinals.flatMap((ordinal) => {
      const feature = baseByOrdinal.get(ordinal)
      if (feature === undefined) return []
      const p = feature.properties
      return [{
        ordinal,
        attributes: {
          objectid: p.source_objectid, nom_predio: p.nom_predio, n_rodal: p.n_rodal, cod_uso: p.cod_uso,
          uso_2024: p.uso_2024, desc_uso: p.desc_uso, uso_2026: p.uso_2026, cod_uso_2026: p.cod_uso_2026,
          sup_ha: p.sup_ha, cod_predial: p.cod_predial,
        },
        coordinates: feature.geometry.coordinates,
      }]
    })
    const result = pasteSources(draft, sources)
    if (result.added > 0) change(result.draft)
    setSelectedOrdinals(new Set())
    setMessage({
      tone: result.skipped > 0 ? 'warn' : 'info',
      text:
        result.skipped > 0
          ? `${plural(result.added, 'polígono agregado', 'polígonos agregados')}; ${plural(result.skipped, 'ya estaba', 'ya estaban')} en el informe.`
          : `${plural(result.added, 'polígono agregado', 'polígonos agregados')} al informe.`,
    })
  }, [draft, change, report.base_snapshot_id, baseByOrdinal])

  const removeSelected = useCallback(() => {
    const ordinals = draft.features.filter((f) => selectedKeys.has(f.key)).map((f) => f.source_feature_ordinal)
    if (ordinals.length === 0) return
    change(removeSources(draft, ordinals))
    setSelectedKeys(new Set())
  }, [draft, selectedKeys, change])

  // --- Split -------------------------------------------------------------------

  const startSplit = useCallback(() => {
    setMode('split')
    setLinePoints([])
    setPending(null)
    setMessage(null)
  }, [])

  const cancelSplit = useCallback(() => {
    setMode('select')
    setLinePoints([])
    setPending(null)
  }, [])

  const finishLine = useCallback(() => {
    if (linePoints.length < 2) {
      setMessage({ tone: 'warn', text: SPLIT_MESSAGES.too_short })
      return
    }
    const targets = draft.features.filter(
      (feature) =>
        (selectedKeys.size === 0 || selectedKeys.has(feature.key)) && lineCrosses(feature.coordinates, linePoints),
    )
    if (targets.length === 0) {
      setMessage({ tone: 'warn', text: draft.features.length === 0 ? 'Primero pegue el rodal al informe.' : SPLIT_MESSAGES.not_crossing })
      return
    }
    const pieces: Pending['pieces'] = []
    for (const feature of targets) {
      const result = splitByPolyline(feature.coordinates, linePoints)
      if (!result.ok) {
        if (result.reason === 'not_crossing' && targets.length > 1) continue
        const name = `Rodal ${featureCode(feature) ?? 'sin número'}`
        const hint = targets.length > 1 ? ' Seleccione solo el rodal que quiere dividir.' : ''
        setMessage({ tone: 'warn', text: `${name}: ${SPLIT_MESSAGES[result.reason]}${hint}` })
        return
      }
      pieces.push({ featureKey: feature.key, coordinates: result.pieces })
    }
    if (pieces.length === 0) {
      setMessage({ tone: 'warn', text: SPLIT_MESSAGES.not_crossing })
      return
    }
    setPending({ pieces, managed: new Set() })
    setMode('choose')
    setLinePoints([])
    setMessage(null)
  }, [linePoints, draft, selectedKeys])

  const choosePieces = useMemo((): ChoosePiece[] => {
    if (pending === null) return []
    let letter = 0
    return pending.pieces.flatMap((group) =>
      group.coordinates.map((coordinates, index) => {
        const letterLabel = String.fromCharCode(65 + letter)
        letter += 1
        const hectares = ha.format(multiPolygonAreaSquareMeters(coordinates) / 10_000)
        return {
          featureKey: group.featureKey,
          index,
          coordinates,
          label: `${letterLabel} · ${hectares} ha`,
          labelAt: interiorPoint(coordinates),
          managed: pending.managed.has(`${group.featureKey}:${index}`),
        }
      }),
    )
  }, [pending])

  const onPieceClick = useCallback((featureKey: string, index: number) => {
    setPending((current) => {
      if (current === null) return current
      const managed = new Set(current.managed)
      const id = `${featureKey}:${index}`
      if (managed.has(id)) managed.delete(id)
      else managed.add(id)
      return { ...current, managed }
    })
  }, [])

  const confirmPieces = useCallback(
    (keepNone: boolean) => {
      if (pending === null) return
      if (!keepNone && pending.managed.size === 0) {
        setMessage({ tone: 'warn', text: 'Toque al menos una parte, o use «Ninguna por ahora».' })
        return
      }
      let next = draft
      let count = 0
      for (const group of pending.pieces) {
        const managed = keepNone
          ? []
          : group.coordinates.map((_, index) => index).filter((index) => pending.managed.has(`${group.featureKey}:${index}`))
        // A rodal the line also crossed but where no part was chosen stays whole.
        if (!keepNone && managed.length === 0) continue
        next = applySplit(next, group.featureKey, group.coordinates, managed)
        count += 1
      }
      change(next)
      setPending(null)
      setMode('select')
      setSelectedKeys(new Set())
      setMessage({ tone: 'success', text: `${plural(count, 'rodal dividido', 'rodales divididos')}.` })
    },
    [pending, draft, change],
  )

  // --- Keyboard ----------------------------------------------------------------

  useEffect(() => {
    if (!editable) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (mode !== 'split') return
      if (event.key === 'Enter') finishLine()
      else if (event.key === 'Backspace') setLinePoints((points) => points.slice(0, -1))
      else if (event.key === 'Escape') cancelSplit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editable, mode, undo, redo, finishLine, cancelSplit])

  // --- Save, submit, review -----------------------------------------------------

  const fail = useCallback((error: unknown, fallback: string) => {
    const stale = error instanceof ApiError && error.reason === 'stale_revision'
    let text = mutationMessage(error, fallback)
    const ordinal = error instanceof ApiError ? error.sourceFeatureOrdinal : null
    if (ordinal !== null) {
      // Point at the rodal the server refused.
      const culprits = draftRef.current.features.filter((f) => f.source_feature_ordinal === ordinal)
      const first = culprits[0]
      if (first !== undefined) {
        text = `Rodal ${featureCode(first) ?? 'sin número'}: ${text}`
        setSelectedKeys(new Set(culprits.map((f) => f.key)))
      }
    }
    setMessage({ tone: 'error', text, stale })
  }, [])

  const saveConaf = useCallback(async () => {
    const trimmed = conafInput.trim()
    const normalized = trimmed === '' ? null : normalizeSolicitud(trimmed)
    if (trimmed !== '' && normalized === null) {
      setConafError('Use el N.º de CONAF: dígitos (hasta 9) o el formato 12/345-6/24.')
      return
    }
    setConafBusy(true)
    try {
      const result = await updateReport(report.report_id, revision, { conaf_solicitud: normalized })
      setRevision(result.revision)
      setConafNumero(normalized)
      setConafInput(normalized ?? '')
    } catch (error) {
      setConafError(mutationMessage(error, 'No fue posible guardar el N.º.'))
    } finally {
      setConafBusy(false)
    }
  }, [conafInput, report.report_id, revision])

  const save = useCallback(async (): Promise<number | null> => {
    setBusy(true)
    const sent = draft
    try {
      const result = await saveReportFeatures(report.report_id, revision, toSaveFeatures(sent))
      setRevision(result.revision)
      setWarnings(result.warnings)
      setSavedDraft(sent)
      setMessage({ tone: 'success', text: 'Informe guardado.' })
      return result.revision
    } catch (error) {
      fail(error, 'No fue posible guardar el informe.')
      return null
    } finally {
      setBusy(false)
    }
  }, [report.report_id, revision, draft, fail])

  const submit = useCallback(async () => {
    const before = draftRef.current
    const saved = dirty ? await save() : revision
    if (saved === null) return
    if (draftRef.current !== before) {
      setMessage({ tone: 'warn', text: 'Hay cambios nuevos sin guardar. Guárdelos antes de enviar.' })
      return
    }
    setBusy(true)
    try {
      await transitionReport(report.report_id, 'submit', saved)
      onReload()
    } catch (error) {
      fail(error, 'No fue posible enviar el informe.')
      setBusy(false)
    }
  }, [dirty, save, revision, report.report_id, onReload, fail])

  const decide = useCallback(
    async (action: 'approve' | 'request-changes' | 'archive', text?: string) => {
      setBusy(true)
      try {
        await transitionReport(report.report_id, action, revision, text)
        setDialog(null)
        onReload()
      } catch (error) {
        fail(error, 'No fue posible completar la acción.')
        setBusy(false)
        setDialog(null)
      }
    },
    [report.report_id, revision, onReload, fail],
  )

  const duplicate = useCallback(async () => {
    setBusy(true)
    try {
      navigate(reportPath(await duplicateReport(report.report_id)))
    } catch (error) {
      fail(error, 'No fue posible duplicar el informe.')
      setBusy(false)
    }
  }, [report.report_id, fail])

  const remove = useCallback(async () => {
    setBusy(true)
    try {
      await deleteReport(report.report_id)
      navigate(ROUTES.informes)
    } catch (error) {
      fail(error, 'No fue posible borrar el borrador.')
      setBusy(false)
      setDialog(null)
    }
  }, [report.report_id, fail])

  // --- Derived ------------------------------------------------------------------

  const summary = draftSummary(draft)
  const changes = useMemo(() => describeChanges(draft.features, detail.sources), [draft.features, detail.sources])
  const latestChangeNote = [...detail.notes].reverse().find((n) => n.kind === 'cambios_solicitados')
  const showNotes = canUpload(role)
  // The number arrives after approval and never touches polygons (server rule).
  const conafEditable = canUpload(role) && report.status !== 'archivado'
  const overlay = useMemo(
    () => (showBase ? detail.sources.map((s) => ({ ordinal: s.source_feature_ordinal, coordinates: s.geometry.coordinates })) : []),
    [showBase, detail.sources],
  )
  const hint =
    mode === 'split'
      ? 'Haga clic para cada quiebre; empiece y termine fuera del rodal. «Terminar línea», doble clic o Enter para cortar.'
      : mode === 'choose'
        ? 'Toque cada parte que se maneja (puede elegir varias) y luego «Listo».'
        : editable
          ? 'Seleccione rodales en el mapa y use «Copiar» y «Pegar al informe». Mayús + clic agrega a la selección.'
          : null

  return (
    <div className="report-editor">
      {editable ? (
        <div className="report-toolbar" role="toolbar" aria-label="Herramientas del informe">
          <button type="button" className={`report-tool${mode === 'select' ? ' report-tool--on' : ''}`} aria-pressed={mode === 'select'} onClick={cancelSplit}>Seleccionar</button>
          <button type="button" className="report-tool" onClick={copy} disabled={selectedOrdinals.size === 0}>Copiar</button>
          <button type="button" className="report-tool" onClick={paste}>Pegar al informe</button>
          <button type="button" className={`report-tool${mode === 'split' || mode === 'choose' ? ' report-tool--on' : ''}`} aria-pressed={mode === 'split'} onClick={startSplit} disabled={draft.features.length === 0}>Dividir con línea</button>
          <button type="button" className="report-tool" onClick={removeSelected} disabled={selectedKeys.size === 0}>Quitar del informe</button>
          <span className="report-toolbar__sep" aria-hidden="true" />
          <button type="button" className="report-tool" onClick={undo} disabled={history.past.length === 0}>Deshacer</button>
          <button type="button" className="report-tool" onClick={redo} disabled={history.future.length === 0}>Rehacer</button>
        </div>
      ) : null}

      <div className="report-editor__body">
        <div className="report-editor__map">
          <ReportMap
            base={base}
            features={draft.features}
            mode={mode}
            selectedOrdinals={selectedOrdinals}
            selectedKeys={selectedKeys}
            linePoints={linePoints}
            choosePieces={choosePieces}
            overlay={overlay}
            onBaseClick={onBaseClick}
            onFeatureClick={onFeatureClick}
            onLinePoint={(point) => setLinePoints((points) => [...points, point])}
            onFinishLine={finishLine}
            onPieceClick={onPieceClick}
            fitNonce={fitNonce}
          />
          {mode === 'split' ? (
            <div className="report-sheet">
              <span>{plural(linePoints.length, 'punto', 'puntos')}</span>
              <button type="button" className="button button--ghost" onClick={() => setLinePoints((p) => p.slice(0, -1))} disabled={linePoints.length === 0}>Quitar último punto</button>
              <button type="button" className="button button--ghost" onClick={cancelSplit}>Cancelar</button>
              <button type="button" className="button" onClick={finishLine}>Terminar línea</button>
            </div>
          ) : null}
          {mode === 'choose' ? (
            <div className="report-sheet">
              <strong>Toca la parte que se cosecha.</strong>
              <button type="button" className="button button--ghost" onClick={() => confirmPieces(true)}>Ninguna por ahora</button>
              <button type="button" className="button button--ghost" onClick={cancelSplit}>Cancelar</button>
              <button type="button" className="button" onClick={() => confirmPieces(false)}>Listo</button>
            </div>
          ) : null}
        </div>

        <aside className="report-panel" aria-label="Informe">
          <div className="report-panel__head">
            <a className="report-panel__back" href={ROUTES.informes} onClick={(event) => onLinkClick(event, ROUTES.informes)}>← Informes</a>
            <h2 className="report-panel__title">{report.name}</h2>
            <p className="report-panel__meta">
              {`${TYPE_LABELS[report.report_type]} · ${report.report_month} · `}
              <ReportStatusChip status={report.status} />
            </p>
          </div>

          {showNotes && latestChangeNote !== undefined && report.status === 'cambios_solicitados' ? (
            <Notice tone="warn" title={`${latestChangeNote.author_display_name} pidió cambios`}>
              <p>{latestChangeNote.body}</p>
            </Notice>
          ) : null}

          {message !== null ? (
            <Notice tone={message.tone}>
              <p>{message.text}</p>
              {message.stale ? (
                <button type="button" className="button button--ghost" onClick={onReload}>Recargar</button>
              ) : null}
            </Notice>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="report-warnings">
              {warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`}>{warning.message}</li>
              ))}
            </ul>
          ) : null}

          {hint !== null ? <p className="report-hint">{hint}</p> : null}

          {reviewing ? (
            <section className="report-section" aria-label="Cambios del informe">
              <h3 className="report-section__title">Cambios</h3>
              <ul className="report-changes">
                {changes.map((item) => (
                  <li key={item.ordinal}>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                  </li>
                ))}
              </ul>
              <label className="report-check">
                <input type="checkbox" checked={showBase} onChange={(event) => setShowBase(event.target.checked)} />
                Mostrar base original
              </label>
            </section>
          ) : null}

          {editable && draft.features.length === 0 ? (
            <ol className="report-steps">
              <li>Seleccione rodales en el mapa.</li>
              <li>Use «Copiar» y luego «Pegar al informe».</li>
              <li>Divida con una línea si solo se maneja una parte.</li>
            </ol>
          ) : null}

          <ul className="report-features">
            {draft.features.map((feature) => (
              <FeatureRow
                key={feature.key}
                feature={feature}
                editable={editable}
                selected={selectedKeys.has(feature.key)}
                baseValues={sourceValues.get(feature.source_feature_ordinal) ?? {}}
                onSelect={() => onFeatureClick(feature.key, false)}
                onToggle={() => change(toggleInReport(draft, feature.key))}
                onEdit={(name, value, baseValue) => change(setAttribute(draft, feature.key, name, value, baseValue))}
              />
            ))}
          </ul>

          <p className="report-total">
            <span>{`${plural(summary.count, 'polígono', 'polígonos')} · ${summary.managedCount} en el área de manejo`}</span>
            {summary.managedCount > 0 ? <span>{` · ${ha.format(summary.managedHa)} ha`}</span> : null}
          </p>

          <div className="report-actions">
            {editable ? (
              <>
                <button type="button" className="button button--ghost" onClick={() => void save()} disabled={busy || conafBusy || !dirty}>Guardar</button>
                <button type="button" className="button" onClick={() => void submit()} disabled={busy || conafBusy || summary.managedCount === 0}>Enviar a revisión</button>
              </>
            ) : null}
            {reviewing ? (
              <>
                <button type="button" className="button button--ghost" onClick={() => setDialog('changes')} disabled={busy}>Pedir cambios</button>
                <button type="button" className="button" onClick={() => setDialog('approve')} disabled={busy}>Aprobar</button>
              </>
            ) : null}
            {canUpload(role) && report.status !== 'archivado' ? (
              <button type="button" className="button button--ghost" onClick={() => void duplicate()} disabled={busy || dirty} title={dirty ? 'Guarde los cambios antes de duplicar.' : undefined}>Duplicar como borrador</button>
            ) : null}
            {role === 'admin' && report.status !== 'archivado' && report.status !== 'borrador' ? (
              <button type="button" className="button button--ghost" onClick={() => setDialog('archive')} disabled={busy}>Archivar</button>
            ) : null}
            {editable && report.status === 'borrador' && report.submitted_at === null ? (
              <button type="button" className="button button--ghost report-actions__danger" onClick={() => setDialog('delete')} disabled={busy}>Borrar borrador</button>
            ) : null}
          </div>

          <section className="report-section report-conaf" aria-labelledby="report-conaf-title">
            <h3 id="report-conaf-title" className="report-section__title">Estado en CONAF</h3>
            {conafEditable ? (
              <form
                className="report-conaf__form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveConaf()
                }}
              >
                <label className="report-form__field" htmlFor="report-conaf">
                  <span>N.º solicitud CONAF</span>
                  <input
                    id="report-conaf"
                    inputMode="numeric"
                    maxLength={9}
                    value={conafInput}
                    aria-invalid={conafError !== null}
                    aria-describedby={conafError !== null ? 'report-conaf-error' : undefined}
                    onChange={(event) => {
                      setConafInput(event.target.value)
                      setConafError(null)
                    }}
                  />
                </label>
                <button
                  type="submit"
                  className="button button--ghost"
                  disabled={conafBusy || busy || conafInput.trim() === (conafNumero ?? '')}
                >
                  {conafBusy ? 'Guardando…' : 'Guardar N.º'}
                </button>
                {conafError !== null ? (
                  <span id="report-conaf-error" className="report-form__error">{conafError}</span>
                ) : null}
              </form>
            ) : (
              <p className="muted">{conafNumero === null ? 'Sin N.º de solicitud CONAF.' : `N.º ${conafNumero}`}</p>
            )}
            {conafNumero !== null ? <ConafCard key={conafNumero} numero={conafNumero} /> : null}
          </section>

          <section className="report-section" aria-label="Exportar">
            <h3 className="report-section__title">Exportar</h3>
            {dirty ? <p className="muted">Guarde los cambios antes de exportar.</p> : null}
            <label className="report-check">
              <input type="checkbox" checked={onlyMarked} onChange={(event) => setOnlyMarked(event.target.checked)} />
              Solo áreas de manejo
            </label>
            <div className="report-export">
              {(['shp', 'gpkg', 'csv'] as const).map((format) => (
                <a
                  key={format}
                  className={`button button--ghost${dirty ? ' is-disabled' : ''}`}
                  aria-disabled={dirty}
                  href={dirty ? undefined : exportUrl(report.report_id, format, onlyMarked ? 'marked' : 'all')}
                >
                  {format === 'shp' ? 'Shapefile (.zip)' : format === 'gpkg' ? 'GeoPackage (.gpkg)' : 'CSV'}
                </a>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {dialog === 'approve' ? (
        <ConfirmDialog title="Aprobar informe" confirmLabel="Aprobar" busy={busy} onConfirm={() => void decide('approve')} onCancel={() => setDialog(null)}>
          <p>{`«${report.name}» quedará aprobado y fijo. Para cambiarlo después habrá que duplicarlo.`}</p>
        </ConfirmDialog>
      ) : null}
      {dialog === 'archive' ? (
        <ConfirmDialog title="Archivar informe" confirmLabel="Archivar" busy={busy} onConfirm={() => void decide('archive')} onCancel={() => setDialog(null)}>
          <p>El informe dejará de aparecer como activo. Su nombre quedará libre.</p>
        </ConfirmDialog>
      ) : null}
      {dialog === 'delete' ? (
        <ConfirmDialog title="Borrar borrador" confirmLabel="Borrar" busy={busy} onConfirm={() => void remove()} onCancel={() => setDialog(null)}>
          <p>Se borrará este borrador y sus polígonos. No se puede deshacer.</p>
        </ConfirmDialog>
      ) : null}
      {dialog === 'changes' ? (
        <div className="dialog-backdrop" role="presentation" onClick={busy ? undefined : () => setDialog(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="changes-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="changes-title" className="dialog__title">Pedir cambios</h2>
            <div className="dialog__body report-form">
              <label className="report-form__field">
                <span>Qué hay que cambiar</span>
                <textarea id="changes-note" rows={4} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            </div>
            <div className="dialog__actions">
              <button type="button" className="button button--ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</button>
              <button type="button" className="button" onClick={() => void decide('request-changes', note.trim())} disabled={busy || note.trim() === ''}>Enviar nota</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FeatureRow({
  feature,
  editable,
  selected,
  baseValues,
  onSelect,
  onToggle,
  onEdit,
}: {
  feature: DraftFeature
  editable: boolean
  selected: boolean
  baseValues: Record<string, string | null>
  onSelect: () => void
  onToggle: () => void
  onEdit: (name: string, value: string, baseValue: string | null) => void
}) {
  const [fieldError, setFieldError] = useState<string | null>(null)
  const code = featureCode(feature) ?? 'Sin rodal'
  const use = feature.attributes.cod_uso === null || feature.attributes.cod_uso === undefined ? '' : ` · ${String(feature.attributes.cod_uso)}`
  return (
    <li className={`report-feature${feature.in_report ? ' report-feature--managed' : ''}${selected ? ' report-feature--selected' : ''}`}>
      <button type="button" className="report-feature__main" onClick={onSelect} aria-expanded={selected}>
        <span>{`${code}${use}`}</span>
        <span className="report-feature__ha">{`${ha.format(Number(feature.attributes.sup_ha ?? 0))} ha`}</span>
      </button>
      <label className="report-check">
        <input type="checkbox" checked={feature.in_report} disabled={!editable} onChange={onToggle} />
        {`Área de manejo · ${code}`}
      </label>
      {selected && editable ? (
        <div className="report-feature__fields">
          {EDITABLE_ATTRIBUTES.map((attribute) => {
            const raw = feature.attributes[attribute.key]
            const value = raw === null || raw === undefined ? '' : String(raw)
            return (
              <label key={attribute.key} className="report-form__field">
                <span>{attribute.label}</span>
                <input
                  // Keyed on the value: undo/redo replaces the shown text.
                  key={`${attribute.key}:${value}`}
                  defaultValue={value}
                  aria-invalid={fieldError === attribute.key}
                  onBlur={(event) => {
                    const typed = event.target.value
                    if (new TextEncoder().encode(typed.trim()).length > attribute.bytes) {
                      setFieldError(attribute.key)
                      return
                    }
                    setFieldError(null)
                    if (typed.trim() !== value) onEdit(attribute.key, typed, baseValues[attribute.key] ?? null)
                  }}
                />
                {fieldError === attribute.key ? (
                  <span className="report-form__error">Texto demasiado largo para este campo.</span>
                ) : null}
              </label>
            )
          })}
        </div>
      ) : null}
    </li>
  )
}
