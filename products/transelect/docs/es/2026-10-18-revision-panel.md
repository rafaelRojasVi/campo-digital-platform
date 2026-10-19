# Transelec — revisión del panel (2026-10-18)

Nota para Campo Digital. El detalle técnico, en inglés, está en
[Dashboard review pass](../design/2026-10-18-dashboard-review-pass.md).

No cambió ninguna cifra ni regla de la planilla: solo cómo se presenta y
qué tan rápido carga.

## Qué cambia

- **«Abrir Oficina Virtual CONAF» queda oculto por ahora.** El enlace usaba
  el «N Ingreso» de la planilla, que la consulta pública de CONAF no acepta
  (pide el número de 6 dígitos del comprobante de ingreso), así que llevaba
  a «no existe» o a un formulario en blanco. «Copiar N.º» sigue disponible.
  Vuelve cuando se confirme qué número usar.
- **Estado se puede filtrar.** Un clic en un grupo o un paso de las barras
  (por ejemplo «En evaluación 31») deja en la tabla solo esos PMF; además hay
  un buscador por PMF o N.º de ingreso. La tabla se desplaza por dentro con
  el encabezado fijo, y la página pasó de unos 12.000 px de alto a unos 1.400.
- **El Explorador carga más liviano.** Antes descargaba todas las filas dos
  veces al abrir; ahora una, y comprimida.
- **El Resumen muestra primero lo que hay que atender**: «Requiere atención»
  y «Cola de trabajo» quedan justo bajo las tarjetas de estado. Se quitó una
  barra repetida y las notas largas de reforestación pasaron a «Cómo se
  calcula».
