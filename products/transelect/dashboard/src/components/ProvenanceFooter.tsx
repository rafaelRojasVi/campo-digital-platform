/**
 * TR-FUNC-043 (pie de página / cita de fuente) and TR-FUNC-046 (vigencia).
 *
 * The source dashboards end with a static string naming a filename. This
 * footer replaces that with the active version's real provenance — content
 * hash, byte size, contract and parser version, projected row counts, who
 * validated it and who published it, and when — read from
 * `GET /transelec/imports/active`, which takes its publish actor and
 * timestamp from `transelec_publish_event` rather than from the import row.
 *
 * The source's three factual claims about ingestion scope are kept, because
 * they are still true of this pipeline: only the `Resumen` sheet is
 * projected, the historical sheets are not merged, and nothing here writes
 * back to the origin workbook.
 */
import type { TranselecActiveImport } from '../api'
import { formatBytes, formatDateTime, formatInteger, formatNumber, shortHash } from '../format'

export function ProvenanceFooter({ activeImport }: { activeImport: TranselecActiveImport | null }) {
  return (
    <footer className="foot" data-testid="provenance-footer">
      {activeImport ? (
        <>
          <b>Procedencia de los datos mostrados</b>
          <dl>
            <dt>Versión activa</dt>
            <dd>
              #{activeImport.import_id} · publicada {formatDateTime(activeImport.published_at)}
              {activeImport.published_by_display_name
                ? ` por ${activeImport.published_by_display_name}`
                : ''}
              {activeImport.published_event_type === 'restore'
                ? ' (restauración de una versión anterior)'
                : ''}
            </dd>
            <dt>Archivo de origen</dt>
            <dd>
              {activeImport.filename ?? 'Sin nombre registrado'} · {formatBytes(activeImport.byte_size)}
            </dd>
            <dt>Huella SHA-256</dt>
            <dd>
              <code>{shortHash(activeImport.sha256)}…</code>
            </dd>
            <dt>Contrato / parser</dt>
            <dd>
              {activeImport.schema_contract_version} · {activeImport.parser_version}
            </dd>
            <dt>Validada</dt>
            <dd>{formatDateTime(activeImport.validated_at)}</dd>
            <dt>Contenido proyectado</dt>
            <dd>
              {formatInteger(activeImport.business_rows)} filas ·{' '}
              {formatInteger(activeImport.distinct_pmf)} PMF ·{' '}
              {formatInteger(activeImport.distinct_provisional_predio_ids)} identificadores
              prediales · {formatNumber(activeImport.surface_total)} ha
            </dd>
          </dl>
        </>
      ) : (
        <p>Sin versión publicada: todavía no hay procedencia que citar.</p>
      )}
      <p>
        Fuente: hoja «Resumen» de la planilla maestra publicada. Las hojas históricas no se suman
        para evitar duplicidad y la hoja «Pendientes» no se cruza automáticamente. Esta aplicación
        lee la proyección publicada en la base de datos y nunca modifica la planilla de origen.
      </p>
      <p>
        Las marcas de Campo Digital y Transelec se muestran como identificación textual
        provisional: los logotipos originales no se reutilizan mientras no exista autorización
        expresa sobre esos archivos.
      </p>
    </footer>
  )
}
