# Visor del Patrimonio Degenfeld — resumen para Campo Digital

Fecha: 2026-08-30

Ya existe una primera aplicación visual del patrimonio, que se abre en el
navegador y muestra la base entregada (`Gdb_Degenfeld2026_mv`: 1.568
polígonos, 13 predios, 10.422,61 ha) tal como viene en la fuente.

## Qué permite hacer hoy

- **Ver el patrimonio completo en un mapa** sobre imagen satelital, con los
  polígonos coloreados por Uso 2026 (o por Uso 2024, especie, predio,
  comparación 2024→2026, o evidencia de calidad) y una leyenda con hectáreas
  y número de polígonos por clase. En la vista general aparece el nombre de
  cada predio.
- **Superficie por especie** (desde el 18 de octubre de 2026): en
  «Colorear por», la opción **Especie** pinta el mapa por especie y la
  leyenda suma las hectáreas de cada una para los polígonos filtrados (por
  ejemplo, solo un predio). También hay un filtro **Especie**. La especie se
  lee del código 2026 (Pi06 = pino radiata de 2006); las plantaciones mixtas
  se muestran juntas, sin repartir la superficie, y Al, Se, Ci y Ss aparecen
  «por confirmar» hasta que Campo Digital confirme su nombre.
- **Buscar y filtrar**: por predio, uso, especie, rodal, código, descripción, y
  combinar filtros. El mapa, la tabla y el total (polígonos y hectáreas) se
  actualizan juntos.
- **Inspeccionar cada polígono**: clic en el mapa o en la tabla abre una
  ficha con usos 2024/2026, códigos, descripción, superficie (la de la
  fuente y la calculada desde la geometría), validez de la geometría y los
  14 campos originales del shapefile.
- **Revisar qué cambió entre los campos 2024 y 2026**: 1 cambio de clase de
  uso (ENSAYO → PLANTACION) y 72 cambios de código detallado, con los pares
  más frecuentes (p. ej. `En11 → Pi26`) y un botón para verlos en el mapa.
  *Importante:* mostramos solo que los valores difieren en la base; no
  afirmamos que sea gestión realizada ni avance, porque el significado de
  los códigos aún no está confirmado.
- **Revisar la evidencia de calidad de datos**: geometrías inválidas (7),
  rodales en blanco (143), pares predio/rodal repetidos (32), etc., con su
  explicación y acceso directo en el mapa. Son observaciones de la fuente,
  no errores corregidos por el sistema.
- **Exportar a CSV** la tabla filtrada (se abre directo en Excel).
- **Ajustar la opacidad** de los polígonos para ver la imagen satelital de
  fondo; bajo 50 % el borde toma el color del uso, así no se pierden los
  límites entre usos.
- **Agregar a un informe** (desde el 18 de octubre de 2026): en la ficha de un
  rodal, o con un filtro puesto, el botón «Agregar a un informe» lleva esos
  polígonos a un informe en borrador (o crea uno) y abre el editor con ellos
  ya pegados. Ahí se dividen y se envían a revisión. La antigua «Simular
  ajuste» del mapa se quitó: no guardaba nada y repetía lo que hace el editor.
- **Revisión de la base**: abajo del mapa, la pestaña «Revisión de la base»
  reúne la versión, la capa de origen, el sistema de coordenadas, los
  indicadores y los casos de calidad de datos. El panel empieza cerrado para
  que el mapa tenga más espacio.
- **Herramientas del mapa** (18 de octubre de 2026): al acercarse, cada rodal
  muestra su número y código; **Mayús + clic** agrega rodales a la selección y
  **Mayús + arrastrar** elige todos los de un área, con la suma de hectáreas
  por especie; **Medir** da distancias y áreas; **Mi ubicación** muestra en
  qué rodal está el teléfono (pide permiso y no guarda la ubicación); abajo a
  la izquierda se ven las coordenadas UTM del cursor; **Ctrl + / Ctrl −**
  acercan y alejan el mapa.
- **Ayudas en pantalla**: los términos menos obvios (Evidencia, Sup_ha vs.
  geometría, huella del contenido, etc.) tienen un pequeño `?` que los
  explica al pasar el mouse.

## Qué NO hace todavía (a propósito)

- No permite editar ni crear solicitudes de planes de manejo (esperamos tus
  respuestas sobre ese flujo).
- No usa el año de plantación del código (`Pi06` y `Pi26` cuentan los dos
  como pino radiata).
- No declara esta base como "la vigente": la etiqueta dice "última ingesta"
  porque es lo único comprobable.
- No repara geometrías ni corrige los datos observados.

## Cómo abrirlo

En el repositorio: `make forestry-dev` (levanta base de datos, carga la
instantánea si hace falta y abre el navegador). `make forestry-stop` lo
detiene.

Las preguntas abiertas que definirán los próximos pasos siguen en
[preguntas-campo-digital.md](preguntas-campo-digital.md).

## Documentación relacionada

[Registro técnico del visor (inglés)](../dashboard-v1.md) ·
[Producto Forestal](../../README.md)
