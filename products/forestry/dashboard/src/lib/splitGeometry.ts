/**
 * «Dividir con línea»: split a rodal with a polyline (QGIS «Dividir objetos
 * espaciales»), in EPSG:32718 metres, with JSTS.
 *
 * The polygon's boundary and the line are noded together, the result is
 * polygonized, and the faces inside the original polygon are the pieces
 * (holes stay holes; untouched parts of a multipart rodal become their own
 * pieces). The server re-checks every piece on save.
 */
import 'jsts/org/locationtech/jts/monkey.js'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js'

export type Coordinates = number[][][][]
export type Position = [number, number]
export type SplitFailure = 'too_short' | 'not_crossing' | 'invalid_source' | 'too_small' | 'unreadable'
export type SplitResult = { ok: true; pieces: Coordinates[] } | { ok: false; reason: SplitFailure }

export const MIN_PIECE_M2 = 1

export const SPLIT_MESSAGES: Record<SplitFailure, string> = {
  too_short: 'Haga clic en al menos dos puntos para dibujar la línea.',
  not_crossing: 'La línea debe cruzar el rodal de lado a lado.',
  invalid_source: 'Esta geometría tiene un error en la base original; corríjanla en ArcMap.',
  too_small: 'Una de las partes es demasiado pequeña (menos de 1 m²). Ajuste la línea.',
  unreadable: 'No se pudo leer la forma del rodal.',
}

const reader = new GeoJSONReader()
const writer = new GeoJSONWriter()

function toCoordinates(geometry: JstsGeometry): Coordinates {
  const written = writer.write(geometry)
  if (written.type === 'Polygon') return [written.coordinates as number[][][]]
  return written.coordinates as Coordinates
}

function readPolygon(coordinates: Coordinates): JstsGeometry {
  return reader.read({ type: 'MultiPolygon', coordinates })
}

export function splitByPolyline(coordinates: Coordinates, line: Position[]): SplitResult {
  if (line.length < 2) return { ok: false, reason: 'too_short' }

  let polygon: JstsGeometry
  let cut: JstsGeometry
  try {
    polygon = readPolygon(coordinates)
    cut = reader.read({ type: 'LineString', coordinates: line })
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  if (!polygon.isValid()) return { ok: false, reason: 'invalid_source' }

  const polygonizer = new Polygonizer()
  polygonizer.add(polygon.getBoundary().union(cut))
  const faces = polygonizer
    .getPolygons()
    .toArray()
    .filter((face) => polygon.contains(face.getInteriorPoint()))

  if (faces.length < 2) return { ok: false, reason: 'not_crossing' }
  if (faces.some((face) => face.getArea() < MIN_PIECE_M2)) return { ok: false, reason: 'too_small' }
  return { ok: true, pieces: faces.map(toCoordinates) }
}

export function unionPieces(pieces: Coordinates[]): Coordinates {
  const [first, ...rest] = pieces.map(readPolygon)
  if (first === undefined) return []
  return toCoordinates(rest.reduce((joined, piece) => joined.union(piece), first))
}

export function lineCrosses(coordinates: Coordinates, line: Position[]): boolean {
  if (line.length < 2) return false
  try {
    return readPolygon(coordinates).intersects(
      reader.read({ type: 'LineString', coordinates: line }),
    )
  } catch {
    return false
  }
}
