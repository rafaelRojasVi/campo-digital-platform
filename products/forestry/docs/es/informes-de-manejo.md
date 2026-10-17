# Rodales: informes de manejo

Fecha: 2026-10-16. Estado: **listo para revisión, no publicado en la
plataforma**. Nada cambió todavía en el Rodales que ven los usuarios.

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

1. En **Informes**, use **Nuevo informe**: nombre, tipo (Cosecha, Manejo,
   Reforestación, Plantación u Otro) y mes.
2. En el mapa, haga clic en los rodales (Mayús + clic para elegir varios),
   use **Copiar** y luego **Pegar al informe**.
3. Si solo se maneja una parte de un rodal, use **Dividir con línea**: un
   clic por cada quiebre, empezando y terminando fuera del rodal, y
   **Terminar línea**. Toque la parte que se cosecha y **Listo**. Esa parte
   recibe un código nuevo (por ejemplo 766-1) y queda marcada como área de
   manejo; el resto mantiene el código original.
4. **Deshacer** y **Rehacer** sirven para cualquier paso.
5. **Guardar** y luego **Enviar a revisión**.
6. Si Javier pide cambios, la nota aparece arriba del informe. Se corrige y
   se vuelve a enviar.
7. Un informe aprobado queda fijo. Para cambiarlo, use **Duplicar como
   borrador**.

## Exportar

Desde el informe: **Shapefile (.zip)**, **GeoPackage (.gpkg)** o **CSV**,
con la opción **Solo áreas de manejo**. El archivo trae los 14 campos de la
base y además EN_INFORME, INFORME, TIPO, FECHA, ESTADO y OID_ORIGEN (el
OBJECTID del rodal original). Las filas cambiadas en la web llevan
Editada = wb.

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
