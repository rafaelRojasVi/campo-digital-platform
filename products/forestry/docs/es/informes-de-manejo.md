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

## Lo que falta

- Saber qué significa el campo N_Rodal_te.
- El formato de solicitud de Plan de Manejo de Marco.
- Si gerencia necesita aprobar.

## Documentación relacionada

[Detalle técnico (inglés)](../management-reports-v1.md) ·
[Cargar, revisar y publicar](carga-y-publicacion.md)
