# Rodales: informes de manejo

Fecha: 2026-10-19 (actualización). Estado: **en producción desde 2026-10-17;
fecha exacta desde 2026-10-19**.

## Qué es un informe

Un informe de manejo es una capa con nombre (por ejemplo «Cosecha pino enero
2027») que reúne los rodales que se van a cosechar, manejar o reforestar.
Se arma en la web, se revisa y, una vez aprobado, se exporta para enviarlo
a Campo Digital junto con la planilla Excel del Plan de Manejo.

La base maestra **no cambia**: se sigue editando en ArcMap. El informe
guarda su propia copia de los rodales.

## Quién hace qué

- **Operador (Marco):** crea el informe, elige rodales, los divide si solo
  se maneja una parte y lo envía a revisión.
- **Administrador (Javier):** revisa los cambios, aprueba o pide cambios
  con una nota.
- **Visualizadores (dueños):** ven los informes aprobados y pueden
  exportarlos. No ven las notas de revisión.

## Paso a paso

Desde el 19 de octubre de 2026 el informe es **una tabla a la izquierda y el
mapa a la derecha**, sin pestañas ni «selección». Arriba, tres tarjetas con
ícono muestran el avance (Rodales, Planificación, Exportar) y se marcan con
un ✓ al completarse; tocarlas lleva a esa parte. Javier pidió que fuera lo
más simple posible; los «?» explican cada parte.

1. En **Informes**, use **Nuevo informe**: nombre, tipo (Cosecha, Manejo,
   Reforestación, Plantación u Otro) y fecha exacta (día, mes y año).
   Los informes anteriores al 2026-10-19 solo tienen mes; se les puede
   asignar una fecha exacta editando el encabezado del informe.
2. **Un clic en un rodal del mapa lo agrega** al informe (en naranjo) y
   aparece «Rodal 1208 agregado · Deshacer». También se puede buscar por
   número («Buscar rodal», arriba del mapa).
3. **Un clic en un rodal naranjo abre su tarjeta**: **Dividir**, **Sacar del
   informe** y **Editar datos**. Así un rodal ya planificado no se saca por
   un clic distraído. Otro clic, o un clic fuera, la cierra.
4. **Dividir:** un clic por cada quiebre, empezando y terminando fuera del
   rodal, y **Terminar línea**. Toque la parte que se maneja y **Listo**. Esa
   parte recibe un código nuevo (por ejemplo 766-1); la otra queda como
   **«Resto»**, fuera del área de manejo (su tarjeta tiene **Incluir**).
5. En la **tabla**, una fila por rodal: sector, especie(s) a reforestar y
   densidad (ver más abajo). Tocar el número de un rodal lo muestra en el
   mapa.
6. **Excel de cosecha** está arriba del panel; los otros formatos, el N.º de
   CONAF, duplicar y borrar están en **«Otros formatos, CONAF y más»**.
7. **Guardar** y **Enviar a revisión** están siempre abajo del panel, que
   indica si hay cambios sin guardar. **Deshacer** y **Rehacer** están arriba
   del mapa.
8. Si Javier pide cambios, la nota aparece arriba del informe. Se corrige y
   se vuelve a enviar.
9. Un informe aprobado queda fijo. Para cambiarlo, use **Duplicar como
   borrador**.

## Desde el mapa

En **Mapa**, la ficha de un rodal tiene **Agregar a un informe**; con un filtro
puesto (por ejemplo, una especie en un predio), el panel de filtros ofrece
agregar todos los polígonos filtrados (hasta 300). Se elige un informe en
borrador o se crea uno nuevo, y el editor se abre con esos polígonos ya
pegados y sin guardar.

## Exportar

Desde el informe: **Shapefile (.zip)**, **GeoPackage (.gpkg)** o **CSV**,
con la opción **Solo áreas de manejo**. El archivo trae los 14 campos de la
base y además EN_INFORME, INFORME, TIPO, FECHA, ESTADO y OID_ORIGEN (el
OBJECTID del rodal original). Las filas cambiadas en la web llevan
Editada = wb.

**Imprimir / PDF** abre una página con el mapa del informe sobre imagen
satelital (área de manejo en naranja, número de rodal, escala y norte), la
leyenda con hectáreas y la tabla de rodales con totales. Con «Imprimir o
guardar como PDF» el navegador la guarda como PDF, lista para el Plan de
Manejo. Muestra la última versión guardada del informe.

### Excel de cosecha (formato Campo Digital)

El botón **«Excel de cosecha (formato Campo Digital)»** descarga un archivo
`.xlsx` con la tabla de identificación de rodales, en el mismo formato que
usa Campo Digital para el Plan de Manejo.

El libro tiene una hoja **Resumen** (especie, superficie por predio) y una
hoja por cada combinación especie–predio, con sus datos de rodales, cabecera
de dos filas y fila de TOTALES.

**Columnas que se llenan solas:**

| Columna | Fuente |
|---|---|
| Predio | campo `nom_predio` del rodal |
| Sector | lo anotado en «Planificación» |
| Actividad | tipo del informe en minúsculas |
| Rodal | código del rodal (`n_rodal`) |
| Superficie (ha) | superficie total del rodal de origen |
| Superficie corta (ha) | superficie del polígono de manejo (puede ser menor si se dividió) |
| Especie | especie según el código `cod_uso_2026` |
| Año plantación | año de plantación según el código |
| Año corta | año de la fecha del informe |
| Especie a reforestar | lo anotado en «Planificación» (si son varias, unidas con «+») |
| Densidad reforestación | lo anotado en «Planificación», en plantas por hectárea |
| Plan de manejo | «sí» si hay número CONAF, «no» si no hay |

**Columnas que quedan en blanco** (se completan a mano en Excel):
**Pendiente (%)** y **Densidad actual**, porque no están en la base.

La hoja **Resumen** trae también la tabla de **plantación**: superficie por
predio y especie a reforestar, con su porcentaje.

### Planificación por rodal

En la tabla del informe hay una fila por cada rodal del área de manejo:

- **Sector:** texto libre (por ejemplo «La Reina»). Javier explicó que es un
  dato aproximado que no está escrito en ninguna parte; la plataforma sugiere
  los sectores ya usados en el informe.
- **Especie(s) a reforestar:** una o varias; se elige de una lista o se
  escribe y se presiona Enter.
- **Densidad (pl/ha):** un solo número por rodal, el total.

La primera fila, **«Todos»**, sirve para poner el mismo valor en todos los
rodales: se escribe y se presiona **Aplicar a todos**; después se puede
cambiar uno por uno. Hacer clic en una celda sin escribir nada no cambia
nada. Estos datos también salen en el Shapefile, GeoPackage y CSV (campos
SECTOR, ESP_REFOR y DENS_REFOR) y en la revisión de Javier.

## Estado CONAF

En el informe, la sección **«Estado en CONAF»** (al final del panel) tiene
el campo **«N.º solicitud CONAF»**. Escriba el número y presione
**«Guardar N.º»**: se guarda solo el número, sin tocar los polígonos que
esté editando. Operadores y administradores pueden escribirlo o cambiarlo en
cualquier estado salvo archivado, también con el informe ya aprobado (el
número suele existir recién después de aprobar); el informe aprobado sigue
fijo.

Con el número guardado, la plataforma lee la consulta pública de CONAF y
muestra el estado (Aprobada, En evaluación, Rechazada, No vigente u Otro
estado), el tipo de solicitud, la superficie y las fechas. **«Actualizar
desde CONAF»** consulta en el momento; además se actualiza cada noche. La
lista de informes muestra el estado y el número en la columna **CONAF**.

Si CONAF no encuentra el número o responde otra solicitud, el informe lo
avisa y no muestra datos ajenos. Los documentos de CONAF (resoluciones)
siguen en la Oficina Virtual, con la ClaveÚnica del titular.

## Lo que falta

- Saber qué significa el campo N_Rodal_te.
- El formato de solicitud de Plan de Manejo de Marco.
- Si gerencia necesita aprobar.

## Documentación relacionada

[Detalle técnico (inglés)](../management-reports-v1.md) ·
[Cargar, revisar y publicar](carga-y-publicacion.md)
