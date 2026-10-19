# Transelec — revisión del panel (2026-10-18)

Nota para Campo Digital. El detalle técnico, en inglés, está en
[Dashboard review pass](../design/2026-10-18-dashboard-review-pass.md).

No cambió ninguna cifra ni regla de la planilla: solo cómo se presenta y
qué tan rápido carga.

## Qué cambia

- **«Abrir Oficina Virtual CONAF» abre la solicitud correcta.** El «N Ingreso»
  de la planilla sí es el número que acepta la consulta pública de CONAF
  (por ejemplo `12/345-6/24`). La columna «Estado CONAF» está activa; los
  PMF aprobados en la planilla que CONAF muestra denegados aparecen como
  «Revisar» (ver [Estado CONAF](2026-10-16-estado-conaf.md)).
- **Estado se puede filtrar.** Un clic en un grupo o un paso de las barras
  (por ejemplo «En evaluación») deja en la tabla solo esos PMF; además hay
  un buscador por PMF o N.º de ingreso. La tabla se desplaza por dentro con
  el encabezado fijo, y la página pasó de unos 12.000 px de alto a unos 1.400.
- **El Explorador carga más liviano.** Antes descargaba todas las filas dos
  veces al abrir; ahora una, y comprimida.
- **El Resumen muestra primero lo que hay que atender**: «Requiere atención»
  y «Cola de trabajo» quedan justo bajo las tarjetas de estado. Se quitó una
  barra repetida y las notas largas de reforestación pasaron a «Cómo se
  calcula».
