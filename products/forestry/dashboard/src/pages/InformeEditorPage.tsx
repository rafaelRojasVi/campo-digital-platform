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
import { Hint } from '../components/Hint.tsx'
import { Icon } from '../components/report/Icon.tsx'
import { PlanificacionTable } from '../components/report/PlanificacionTable.tsx'
import { RodalCard } from '../components/report/RodalCard.tsx'
import { ReportProgress } from '../components/report/ReportProgress.tsx'
import { ReportStatusChip } from '../components/ReportStatusChip.tsx'
import { normalizeSolicitud } from '../lib/conafEstado.ts'
import { createHistory, recordHistory, redoHistory, undoHistory, type History } from '../lib/history.ts'
import { describeChanges } from '../lib/reportChanges.ts'
import {
  applySplit,
  draftFromDetail,
  draftSummary,
  featureCode,
  pasteSources,
  removeSources,
  setAttribute,
  setPlanningFields,
  toSaveFeatures,
  toggleInReport,
  type PasteSource,
  type ReportDraft,
} from '../lib/reportDraft.ts'
import { multiPolygonAreaSquareMeters } from '../lib/draftGeometry.ts'
import { SPLIT_MESSAGES, interiorPoint, lineCrosses, splitByPolyline, type Coordinates, type Position } from '../lib/splitGeometry.ts'
import {
  TYPE_LABELS,
  formatReportDate,
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
import { ROUTES, navigate, onLinkClick, printPath, reportPath, setLeaveGuard } from '../router.ts'
import type { FeatureCollection, ForestryRole } from '../types.ts'
import { PASTE_PARAM, readClipboard } from '../lib/reportClipboard.ts'

const ha = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'error' }
  | { status: 'ready'; detail: ReportDetail; base: FeatureCollection; pasteOnArrival: boolean }

interface Pending {
  pieces: { featureKey: string; coordinates: Coordinates[] }[]
  managed: Set<string>
}

type Message = { tone: 'info' | 'success' | 'warn' | 'error'; text: string; stale?: boolean }

/** Paste the clipboard into a draft: the new draft (null when nothing was added) and what to tell. */
function pasteClipboard(
  draft: ReportDraft,
  baseSnapshotId: number,
  baseByOrdinal: Map<number, FeatureCollection['features'][number]>,
): { draft: ReportDraft | null; message: Message } {
  const clipboard = readClipboard()
  if (clipboard === null || clipboard.ordinals.length === 0) {
    return { draft: null, message: { tone: 'warn', text: 'No hay polígonos copiados. Seleccione rodales en el mapa y use «Copiar».' } }
  }
  if (clipboard.base_snapshot_id !== baseSnapshotId) {
    return { draft: null, message: { tone: 'warn', text: 'Los polígonos copiados son de otra versión de la base.' } }
  }
  return addSources(draft, sourcesFor(clipboard.ordinals, baseByOrdinal))
}

/** Base polygons as rodales to add to a report. */
function sourcesFor(
  ordinals: Iterable<number>,
  baseByOrdinal: Map<number, FeatureCollection['features'][number]>,
): PasteSource[] {
  return [...ordinals].flatMap((ordinal) => {
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
}

/** Add rodales to the draft (null when nothing new) and what to tell. */
function addSources(draft: ReportDraft, sources: PasteSource[]): { draft: ReportDraft | null; message: Message } {
  const result = pasteSources(draft, sources)
  const added = plural(result.added, 'rodal agregado', 'rodales agregados')
  return {
    draft: result.added > 0 ? result.draft : null,
    message: {
      tone: result.skipped > 0 ? 'warn' : 'success',
      text:
        result.added === 0
          ? `${result.skipped === 1 ? 'Ese rodal ya estaba' : 'Esos rodales ya estaban'} en el informe.`
          : result.skipped > 0
            ? `${added}; ${plural(result.skipped, 'ya estaba', 'ya estaban')} en el informe.`
            : `${added} al área de manejo.`,
    },
  }
}

/**
 * «Agregar a un informe» on the map opens the editor with ?pegar=1. Read it
 * once and drop it from the URL, so a reload does not paste again.
 */
function takePasteRequest(): boolean {
  const url = new URL(window.location.href)
  if (url.searchParams.get(PASTE_PARAM) !== '1') return false
  url.searchParams.delete(PASTE_PARAM)
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  return true
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
        if (!cancelled) setLoad({ status: 'ready', detail, base, pasteOnArrival: takePasteRequest() })
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
        <Editor key={`${load.detail.report.report_id}-${load.detail.report.revision}-${nonce}`} role={role} detail={load.detail} base={load.base} pasteOnArrival={load.pasteOnArrival} onReload={reload} />
      ) : null}
    </div>
  )
}

function Editor({
  role,
  detail,
  base,
  pasteOnArrival,
  onReload,
}: {
  role: ForestryRole
  detail: ReportDetail
  base: FeatureCollection
  pasteOnArrival: boolean
  onReload: () => void
}) {
  const report = detail.report
  const editable = canUpload(role) && isEditableStatus(report.status)
  const reviewing = role === 'admin' && report.status === 'enviado'

  const [initialDraft] = useState<ReportDraft>(() => draftFromDetail(detail))
  // Polygons sent from the map arrive pasted, unsaved.
  const [arrival] = useState(() =>
    pasteOnArrival && editable
      ? pasteClipboard(
          initialDraft,
          report.base_snapshot_id,
          new Map(base.features.map((feature) => [feature.properties.feature_ordinal, feature])),
        )
      : null,
  )
  const [draft, setDraft] = useState<ReportDraft>(arrival?.draft ?? initialDraft)
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
  const [message, setMessage] = useState<Message | null>(arrival?.message ?? null)
  const [warnings, setWarnings] = useState<ReportWarning[]>([])
  const [busy, setBusy] = useState(false)
  const [showBase, setShowBase] = useState(false)
  const [dialog, setDialog] = useState<'approve' | 'changes' | 'archive' | 'delete' | null>(null)
  const [note, setNote] = useState('')
  const [onlyMarked, setOnlyMarked] = useState(false)
  const [focus, setFocus] = useState<{ nonce: number; coordinates: Coordinates[] }>({ nonce: 0, coordinates: [] })
  const [search, setSearch] = useState('')
  // The card over the map: a rodal of the report (by key) or a base rodal
  // found by number (by ordinal). Nothing else is ever «selected».
  const [card, setCard] = useState<{ kind: 'feature'; key: string } | { kind: 'base'; ordinal: number } | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  // «Rodal 1208 agregado · Deshacer» over the map; the nonce restarts its timer.
  const [toast, setToast] = useState<{ text: string; nonce: number } | null>(null)
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

  // --- Map clicks, search, card ------------------------------------------------

  const flyTo = useCallback((coordinates: Coordinates[]) => {
    setFocus((current) => ({ nonce: current.nonce + 1, coordinates }))
  }, [])

  const say = useCallback((text: string) => {
    setToast((current) => ({ text, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  // One click on a base rodal puts it in the report (Javier: «Simple»);
  // «Deshacer» in the toast takes it back out.
  const addOrdinals = useCallback((ordinals: number[]) => {
    const outcome = addSources(draft, sourcesFor(ordinals, baseByOrdinal))
    if (outcome.draft !== null) {
      change(outcome.draft)
      const first = baseByOrdinal.get(ordinals[0] ?? -1)?.properties.n_rodal
      say(ordinals.length === 1 ? `Rodal ${first ?? 'sin número'} agregado` : outcome.message.text)
    } else {
      setMessage(outcome.message)
    }
    setCard(null)
    setSelectedOrdinals(new Set())
  }, [draft, change, baseByOrdinal, say])

  const onBaseClick = useCallback((ordinal: number) => {
    if (!editable) return
    addOrdinals([ordinal])
  }, [editable, addOrdinals])

  // A rodal already in the report opens its card; a second click closes it.
  const onFeatureClick = useCallback((key: string) => {
    setCard((current) => (current?.kind === 'feature' && current.key === key ? null : { kind: 'feature', key }))
  }, [])

  const showFeature = useCallback((key: string) => {
    setCard({ kind: 'feature', key })
    const feature = draft.features.find((f) => f.key === key)
    if (feature !== undefined) flyTo([feature.coordinates])
  }, [draft.features, flyTo])

  // Rodales copied on the main map («Agregar a un informe») and not added yet.
  const clipboard = readClipboard()
  const clipboardKey = clipboard === null ? '' : `${clipboard.base_snapshot_id}:${clipboard.ordinals.join(',')}`
  const copiedCount = useMemo(() => {
    if (clipboard === null || clipboard.base_snapshot_id !== report.base_snapshot_id) return 0
    const present = new Set(draft.features.map((f) => f.source_feature_ordinal))
    return clipboard.ordinals.filter((ordinal) => !present.has(ordinal)).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipboardKey, report.base_snapshot_id, draft.features])

  const paste = useCallback(() => {
    const outcome = pasteClipboard(draft, report.base_snapshot_id, baseByOrdinal)
    if (outcome.draft !== null) change(outcome.draft)
    setMessage(outcome.message)
  }, [draft, change, report.base_snapshot_id, baseByOrdinal])

  // «Buscar rodal»: fly there and open its card (in the report or not).
  const findRodal = useCallback(() => {
    const query = search.trim().toLocaleLowerCase('es')
    if (query === '') return
    const inReport = draft.features.find((f) => (featureCode(f) ?? '').toLocaleLowerCase('es') === query)
    if (inReport !== undefined) {
      setMessage(null)
      showFeature(inReport.key)
      return
    }
    const matches = base.features.filter((f) => (f.properties.n_rodal ?? '').toLocaleLowerCase('es') === query)
    const first = matches[0]
    if (first === undefined) {
      setMessage({ tone: 'warn', text: `No hay un rodal ${search.trim()} en la base.` })
      return
    }
    setMessage(null)
    setSelectedOrdinals(new Set(matches.map((f) => f.properties.feature_ordinal)))
    setCard({ kind: 'base', ordinal: first.properties.feature_ordinal })
    flyTo(matches.map((f) => f.geometry.coordinates))
  }, [search, base.features, draft.features, showFeature, flyTo])

  const removeOne = useCallback((ordinal: number) => {
    const feature = draft.features.find((f) => f.source_feature_ordinal === ordinal)
    change(removeSources(draft, [ordinal]))
    setCard(null)
    setSelectedKeys(new Set())
    say(feature === undefined ? 'Rodal sacado del informe' : `Rodal ${featureCode(feature) ?? 'sin número'} sacado del informe`)
  }, [draft, change, say])

  // --- Split -------------------------------------------------------------------

  const startSplit = useCallback(() => {
    setCard(null)
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
        setCard({ kind: 'feature', key: first.key })
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
  const managed = draft.features.filter((feature) => feature.in_report)
  const cardFeature = card?.kind === 'feature' ? draft.features.find((f) => f.key === card.key) : undefined
  const cardBase = card?.kind === 'base' ? baseByOrdinal.get(card.ordinal) : undefined
  // Highlighted on the map: the rodal in the card, the hovered row, a culprit.
  const highlighted = useMemo(() => {
    const keys = new Set(selectedKeys)
    if (cardFeature !== undefined) keys.add(cardFeature.key)
    if (hoverKey !== null) keys.add(hoverKey)
    return keys
  }, [selectedKeys, cardFeature, hoverKey])
  const exportDisabled = dirty ? 'Guarde los cambios antes de descargar.' : undefined
  const planned = managed.filter(
    (f) => f.sector !== null || (f.reforest_species?.length ?? 0) > 0 || f.reforest_density !== null,
  ).length
  const sent = report.status !== 'borrador' && report.status !== 'cambios_solicitados'
  const goTo = (id: string, open = false) => {
    const target = document.getElementById(id)
    if (target === null) return
    if (open && target instanceof HTMLDetailsElement) target.open = true
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    if (target instanceof HTMLInputElement) target.focus({ preventScroll: true })
  }

  return (
    <div className="report-editor">
      <div className="report-editor__body report-editor__body--table">
        <aside className="report-panel" aria-label="Informe">
          <div className="report-panel__head report-panel__head--row">
            <div>
              <a className="report-panel__back" href={ROUTES.informes} onClick={(event) => onLinkClick(event, ROUTES.informes)}>← Informes</a>
              <h2 className="report-panel__title">{report.name}</h2>
              <p className="report-panel__meta">
                {`${TYPE_LABELS[report.report_type]} · ${formatReportDate(report)} · `}
                <ReportStatusChip status={report.status} />
              </p>
            </div>
            <a
              className={`button export-main${dirty ? ' is-disabled' : ''}`}
              aria-disabled={dirty}
              title={exportDisabled}
              href={dirty ? undefined : exportUrl(report.report_id, 'xlsx', 'all')}
            >
              <Icon name="download" />
              Excel de cosecha
            </a>
          </div>

          <ReportProgress
            parts={[
              {
                id: 'rodales',
                label: 'Rodales',
                icon: 'map',
                status: managed.length === 0 ? 'Clic en el mapa' : `${plural(managed.length, 'rodal', 'rodales')} · ${ha.format(summary.managedHa)} ha`,
                done: managed.length > 0,
                onGo: () => goTo('rodal-search'),
              },
              {
                id: 'planificacion',
                label: 'Planificación',
                icon: 'clipboard',
                status: managed.length === 0 ? 'Sin rodales aún' : `${planned} de ${managed.length}`,
                done: managed.length > 0 && planned === managed.length,
                progress: managed.length === 0 ? undefined : planned / managed.length,
                onGo: () => goTo('report-table'),
              },
              {
                id: 'exportar',
                label: 'Exportar',
                icon: 'file',
                status: sent ? 'Enviado' : 'Excel y envío',
                done: sent,
                onGo: () => goTo('report-more', true),
              },
            ]}
          />

          {showNotes && latestChangeNote !== undefined && report.status === 'cambios_solicitados' ? (
            <Notice tone="warn" title={`${latestChangeNote.author_display_name} pidió cambios`}>
              <p>{latestChangeNote.body}</p>
            </Notice>
          ) : null}

          {message !== null ? (
            <div className="report-message" key={message.text}>
              <Notice tone={message.tone}>
                <p>{message.text}</p>
                {message.stale ? (
                  <button type="button" className="button button--ghost" onClick={onReload}>Recargar</button>
                ) : null}
              </Notice>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <details className="report-warnings">
              <summary>
                {warnings.length === 1 ? '1 aviso al guardar' : `${warnings.length} avisos al guardar`}
                {' (no impiden enviar)'}
              </summary>
              <ul>
                {warnings.map((warning, index) => {
                  // Name the rodal: the server's text says only «este polígono».
                  const rodal = draft.features.find((f) => f.source_feature_ordinal === warning.source_feature_ordinal)
                  const prefix = rodal === undefined ? '' : `Rodal ${featureCode(rodal) ?? 'sin número'}: `
                  return <li key={`${warning.code}-${index}`}>{`${prefix}${warning.message}`}</li>
                })}
              </ul>
            </details>
          ) : null}

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

          {editable && copiedCount > 0 ? (
            <div className="rodal-copied">
              <span>{`${plural(copiedCount, 'rodal copiado', 'rodales copiados')} desde el mapa.`}</span>
              <button type="button" className="button button--ghost button--small" onClick={paste}>
                <Icon name="plus" />
                Agregar
              </button>
            </div>
          ) : null}

          <h3 id="report-table" className="report-section__title report-table__title">
            {'Rodales del informe '}
            <Hint text="Cada fila es un rodal del área de manejo (naranjo en el mapa). Escriba sector, especies a reforestar y densidad como en una planilla: salen en el Excel de cosecha. Toque el número para verlo en el mapa." />
          </h3>
          <PlanificacionTable
            features={draft.features}
            editable={editable}
            activeKey={cardFeature?.key ?? hoverKey}
            onRodal={showFeature}
            onHover={setHoverKey}
            onChange={(keys, fields) => change(setPlanningFields(draft, keys, fields))}
          />

          <details id="report-more" className="more-actions">
            <summary>Otros formatos, CONAF y más</summary>
            <section className="report-section" aria-label="Exportar">
              <h3 className="report-section__title">Descargar</h3>
              {dirty ? <p className="step-note">Guarde los cambios antes de descargar.</p> : null}
              <div className="report-export">
                {(['shp', 'gpkg', 'csv'] as const).map((format) => (
                  <a
                    key={format}
                    className={`button button--ghost button--small${dirty ? ' is-disabled' : ''}`}
                    aria-disabled={dirty}
                    href={dirty ? undefined : exportUrl(report.report_id, format, onlyMarked ? 'marked' : 'all')}
                  >
                    <Icon name="download" size={16} />
                    {format === 'shp' ? 'Shapefile' : format === 'gpkg' ? 'GeoPackage' : 'CSV'}
                  </a>
                ))}
                <a
                  className={`button button--ghost button--small${dirty ? ' is-disabled' : ''}`}
                  aria-disabled={dirty}
                  href={dirty ? undefined : printPath(report.report_id)}
                  target="_blank"
                  rel="noopener"
                >
                  <Icon name="printer" size={16} />
                  Imprimir / PDF
                </a>
              </div>
              <label className="report-check">
                <input type="checkbox" checked={onlyMarked} onChange={(event) => setOnlyMarked(event.target.checked)} />
                {'Shapefile, GeoPackage y CSV: solo el área de manejo '}
                <Hint text="Sin marcar, el archivo incluye también los «Resto» de los rodales divididos, con EN_INFORME = no." />
              </label>
            </section>

            <section className="report-section report-conaf" aria-labelledby="report-conaf-title">
              <h3 id="report-conaf-title" className="report-section__title">
                {'Estado en CONAF '}
                <Hint text="Cuando CONAF entregue el N.º de solicitud, escríbalo aquí: la plataforma consulta su estado cada noche." />
              </h3>
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
                      maxLength={30}
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

            {canUpload(role) && report.status !== 'archivado' ? (
              <section className="report-section" aria-label="Más acciones">
                <div className="report-actions">
                  <button type="button" className="button button--ghost" onClick={() => void duplicate()} disabled={busy || dirty} title={dirty ? 'Guarde los cambios antes de duplicar.' : undefined}>Duplicar como borrador</button>
                  {role === 'admin' && report.status !== 'borrador' ? (
                    <button type="button" className="button button--ghost" onClick={() => setDialog('archive')} disabled={busy}>Archivar</button>
                  ) : null}
                  {editable && report.status === 'borrador' && report.submitted_at === null ? (
                    <button type="button" className="button button--ghost report-actions__danger" onClick={() => setDialog('delete')} disabled={busy}>
                      <Icon name="trash" size={16} />
                      Borrar borrador
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
          </details>

          {editable || reviewing ? (
            <div className={`save-bar${dirty ? ' save-bar--dirty' : ''}`}>
              <span className="save-bar__status" role="status">
                {editable ? (busy ? 'Guardando…' : dirty ? 'Cambios sin guardar' : 'Todo guardado') : 'En revisión'}
              </span>
              <span className="save-bar__buttons">
                {editable ? (
                  <>
                    <button type="button" className="button button--ghost" onClick={() => void submit()} disabled={busy || conafBusy || summary.managedCount === 0}>
                      <Icon name="send" />
                      Enviar a revisión
                    </button>
                    <button type="button" className="button" onClick={() => void save()} disabled={busy || conafBusy || !dirty}>
                      <Icon name="check" />
                      Guardar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="button button--ghost" onClick={() => setDialog('changes')} disabled={busy}>Pedir cambios</button>
                    <button type="button" className="button" onClick={() => setDialog('approve')} disabled={busy}>
                      <Icon name="check" />
                      Aprobar
                    </button>
                  </>
                )}
              </span>
            </div>
          ) : null}
        </aside>

        <div className="report-editor__map">
          <ReportMap
            base={base}
            features={draft.features}
            mode={mode}
            selectedOrdinals={selectedOrdinals}
            selectedKeys={highlighted}
            linePoints={linePoints}
            choosePieces={choosePieces}
            overlay={overlay}
            onBaseClick={onBaseClick}
            onFeatureClick={onFeatureClick}
            onLinePoint={(point) => setLinePoints((points) => [...points, point])}
            onFinishLine={finishLine}
            onPieceClick={onPieceClick}
            onBackgroundClick={() => {
              setCard(null)
              setSelectedOrdinals(new Set())
            }}
            fitNonce={fitNonce}
            focus={focus}
          />

          <div className="map-tools" role="toolbar" aria-label="Herramientas del mapa">
            <form
              className="map-search"
              role="search"
              onSubmit={(event) => {
                event.preventDefault()
                findRodal()
              }}
            >
              <Icon name="search" />
              <label htmlFor="rodal-search" className="sr-only">Buscar rodal por número</label>
              <input
                id="rodal-search"
                type="search"
                inputMode="numeric"
                placeholder="Buscar rodal"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </form>
            {editable ? (
              <>
                <span className="map-tools__sep" aria-hidden="true" />
                <button type="button" className="icon-button" onClick={undo} disabled={history.past.length === 0} aria-label="Deshacer" title="Deshacer (Ctrl+Z)">
                  <Icon name="undo" />
                </button>
                <button type="button" className="icon-button" onClick={redo} disabled={history.future.length === 0} aria-label="Rehacer" title="Rehacer (Ctrl+Mayús+Z)">
                  <Icon name="redo" />
                </button>
              </>
            ) : null}
          </div>

          {editable && mode === 'select' && card === null && toast === null ? (
            <p className="map-hint">
              {draft.features.length === 0
                ? 'Haga clic en un rodal para agregarlo al informe'
                : 'Clic en un rodal: entra al informe · Clic en uno naranjo: ver opciones'}
            </p>
          ) : null}

          {cardFeature !== undefined && mode === 'select' ? (
            <RodalCard
              key={cardFeature.key}
              kind="feature"
              feature={cardFeature}
              editable={editable}
              baseValues={sourceValues.get(cardFeature.source_feature_ordinal) ?? {}}
              onClose={() => setCard(null)}
              onSplit={() => {
                setSelectedKeys(new Set([cardFeature.key]))
                startSplit()
              }}
              onRemove={() => removeOne(cardFeature.source_feature_ordinal)}
              onToggle={() => change(toggleInReport(draft, cardFeature.key))}
              onEdit={(name, value, baseValue) => change(setAttribute(draft, cardFeature.key, name, value, baseValue))}
            />
          ) : null}
          {cardBase !== undefined && mode === 'select' ? (
            <RodalCard
              key={`base-${cardBase.properties.feature_ordinal}`}
              kind="base"
              code={cardBase.properties.n_rodal ?? 'sin número'}
              attributes={{ ...cardBase.properties }}
              editable={editable}
              onClose={() => {
                setCard(null)
                setSelectedOrdinals(new Set())
              }}
              onAdd={() => addOrdinals([...selectedOrdinals])}
            />
          ) : null}

          {toast !== null && mode === 'select' ? (
            <div className="map-toast" role="status" key={toast.nonce}>
              <span>{toast.text}</span>
              {editable && history.past.length > 0 ? (
                <button
                  type="button"
                  className="map-toast__undo"
                  onClick={() => {
                    undo()
                    setToast(null)
                  }}
                >
                  <Icon name="undo" size={16} />
                  Deshacer
                </button>
              ) : null}
            </div>
          ) : null}

          {mode === 'split' ? (
            <div className="report-sheet">
              <span>{`Línea: ${plural(linePoints.length, 'punto', 'puntos')}`}</span>
              <button type="button" className="button button--ghost" onClick={() => setLinePoints((p) => p.slice(0, -1))} disabled={linePoints.length === 0}>Quitar último punto</button>
              <button type="button" className="button button--ghost" onClick={cancelSplit}>Cancelar</button>
              <button type="button" className="button" onClick={finishLine}>
                <Icon name="scissors" />
                Terminar línea
              </button>
            </div>
          ) : null}
          {mode === 'choose' ? (
            <div className="report-sheet">
              <strong>Toque la parte que se maneja.</strong>
              <button type="button" className="button button--ghost" onClick={() => confirmPieces(true)}>Ninguna por ahora</button>
              <button type="button" className="button button--ghost" onClick={cancelSplit}>Cancelar</button>
              <button type="button" className="button" onClick={() => confirmPieces(false)}>
                <Icon name="check" />
                Listo
              </button>
            </div>
          ) : null}
        </div>
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
