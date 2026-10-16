// Minimal types for the JSTS 2.12 modules Rodales uses (the package ships
// none). Methods are added to Geometry by 'jsts/org/locationtech/jts/monkey.js'.
interface JstsGeometry {
  getBoundary(): JstsGeometry
  union(other: JstsGeometry): JstsGeometry
  contains(other: JstsGeometry): boolean
  intersects(other: JstsGeometry): boolean
  getInteriorPoint(): JstsGeometry
  getArea(): number
  isValid(): boolean
}

declare module 'jsts/org/locationtech/jts/monkey.js' {}

declare module 'jsts/org/locationtech/jts/io/GeoJSONReader.js' {
  export default class GeoJSONReader {
    read(geometry: object): JstsGeometry
  }
}

declare module 'jsts/org/locationtech/jts/io/GeoJSONWriter.js' {
  export default class GeoJSONWriter {
    write(geometry: JstsGeometry): { type: string; coordinates: unknown }
  }
}

declare module 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js' {
  export default class Polygonizer {
    add(geometry: JstsGeometry): void
    getPolygons(): { toArray(): JstsGeometry[] }
  }
}
