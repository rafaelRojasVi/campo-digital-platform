# Visor del Patrimonio Degenfeld — resumen para Campo Digital

Fecha: 2026-08-30

Ya existe una primera aplicación visual del patrimonio, que se abre en el
navegador y muestra la base entregada (`Gdb_Degenfeld2026_mv`: 1.568
polígonos, 13 predios, 10.422,61 ha) tal como viene en la fuente.

## Qué permite hacer hoy

- **Ver el patrimonio completo en un mapa** sobre OpenStreetMap, con los
  polígonos coloreados por Uso 2026 (o por Uso 2024, predio, comparación
  2024→2026, o evidencia de calidad) y una leyenda con hectáreas y número de
  polígonos por clase.
- **Buscar y filtrar**: por predio, uso, rodal, código, descripción, y
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
- **Simular un ajuste de límite** de un polígono (mover puntos, reducir
  puntos o cortar con una línea recta) y ver el área resultante. Es solo una
  simulación en pantalla: no se guarda. Desde el 2026-10-15 el corte también
  funciona en polígonos con varias partes, con huecos o con bordes muy
  irregulares (antes estaba desactivado en ~200 polígonos). La línea debe
  empezar y terminar fuera del polígono; solo se cortan las partes que
  cruza, y si atraviesa un hueco, este queda como una entrada en ambos lados.
- **Ayudas en pantalla**: los términos menos obvios (Evidencia, Sup_ha vs.
  geometría, huella del contenido, etc.) tienen un pequeño `?` que los
  explica al pasar el mouse.

## Qué NO hace todavía (a propósito)

- No permite editar ni crear solicitudes de planes de manejo (esperamos tus
  respuestas sobre ese flujo).
- No interpreta los códigos (`Pi06`, `En11`…) como especie/año: los muestra
  tal cual hasta confirmar el vocabulario.
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
