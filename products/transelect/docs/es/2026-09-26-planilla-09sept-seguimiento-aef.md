# Planilla del 09-sept-2026: seguimiento AEF y revisión de columnas

Documento técnico de referencia (en inglés):
[Source Contract V2](../source-contract-v2.md).

## Qué cambió en la planilla

La hoja «Resumen» de `PlanillaMaestra-CD_09Sept26.xlsx` agregó cinco columnas
al inicio (A–E): **AEF**, **Quien solicita**, **Fecha solicitud**,
**Fecha corta** y **Fecha termino**. Las 30 columnas de siempre se movieron
cinco posiciones a la derecha (ahora F–AI), la columna vacía de separación
pasó de AE a AJ, y desde AK hay tablas resumen/dinámicas propias de la hoja.

La plataforma anterior exigía cada columna en una posición fija, por lo que
rechazaba esta planilla aunque el cambio fuera razonable.

## Qué hace ahora la plataforma

- **Reconoce las columnas por su encabezado**, no por su posición. Tolera
  columnas insertadas, reordenadas o adicionales, y el separador en otra
  posición. Las tablas resumen a la derecha del separador no se leen.
- **Las dos columnas «Carpeta»** se distinguen por sus vecinas: la que está
  junto a «PMF» es la carpeta del PMF; la que está entre «Tramite» y
  «Sector» es la carpeta normalizada. Si una se mueve y ya no se puede
  distinguir, la importación se detiene y pide revisión (o se puede renombrar
  como «Carpeta origen» / «Carpeta normalizada»).
- **Antes de publicar se muestra una revisión**: qué columnas se reconocieron,
  qué se ignoró y qué requiere atención, siempre con fila y columna.
- **Nunca se adivina un dato**: una fecha escrita como texto queda vacía y se
  informa; no se «rellena hacia abajo»; no se corrigen fechas.
- Los problemas graves (falta una columna esencial, una columna ambigua, dos
  columnas con el mismo nombre y valores distintos) **bloquean** la
  importación. Los demás son **advertencias**: la versión se importa, pero
  para publicarla hay que confirmar que se revisaron. Publicar sigue siendo un
  paso explícito y auditado.

## Resultado con la planilla del 09-sept

- Se importan 729 filas con PMF, 159 PMF, 272 identificadores prediales y
  164,63 ha, igual que antes. Las 30 columnas de siempre se leen con los
  mismos valores que con el método anterior.
- AEF, Fecha corta y Fecha termino tienen dato en 23 filas; Quién solicita y
  Fecha solicitud, en 19.
- Advertencias:
  - fila 315: «Fecha corta» anterior a «Fecha solicitud»;
  - fila 375: «Fecha termino» anterior a «Fecha corta»;
  - «Fecha de ingreso» tiene 124 celdas y «90 dias» 63 celdas escritas como
    texto (por ejemplo, fechas en palabras o dos fechas en una misma celda).
    Estas celdas ya quedaban vacías con el método anterior; ahora se informan.

## Cómo se ve en el panel

- Nueva sección **AEF**: cuántas filas tienen AEF, por valor y por
  solicitante, las fechas de cada fila y las fechas a revisar.
- En el **Explorador**, una columna AEF y dos filtros nuevos (AEF y Quién
  solicita). El detalle de cada fila muestra su información AEF.
- Una fila sin AEF se muestra **vacía**, aunque otra fila del mismo PMF tenga
  AEF: la planilla registra el dato por fila y no suponemos que se aplique al
  PMF completo.

## Preguntas para Campo Digital

1. ¿Qué significa AEF y qué significa cada valor («Presentado»,
   «Solicitado, se puede cortar»)?
2. En los 23 casos, el AEF está en la **primera fila** de su PMF y las demás
   filas del PMF están vacías. ¿El AEF se registra una vez por PMF (y aplica a
   todas sus áreas de corta) o por cada área de corta?
3. Todas las «Fecha termino» son el día 1 del mes. ¿Indican solo el mes? Si es
   así, la fila 375 podría no ser un error.
4. ¿Las filas 315 y 375 tienen fechas mal ingresadas?
5. ¿Se pueden ingresar como fecha de Excel las celdas de «Fecha de ingreso» y
   «90 dias» que hoy están escritas como texto?
