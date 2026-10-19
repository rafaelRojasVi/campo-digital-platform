# Transelec — Estado CONAF dentro del panel (2026-10-16)

Nota para Campo Digital, Javier y Marianne. El detalle técnico, en inglés,
está en [Estado CONAF](../../../../docs/platform/conaf-estado.md).

## Activo desde el 18 de octubre

Del 17 al 18 de octubre estuvo oculto por un error nuestro: la plataforma
solo consultaba números de puros dígitos, y los «N Ingreso» de la planilla
llevan barras (`12/345-6/24`). La consulta pública de CONAF sí los acepta:
`12/345-6/24` responde APROBADA, con la superficie del PMF. Ahora se
consultan tal como vienen en la planilla; si una celda trae el ingreso y el
reingreso juntos, se usa el más reciente. Los números de 8 dígitos que
empiezan con 10 (unos pocos PMF) no existen en esa consulta: queda por
saber qué son.

## Qué cambia

Hasta ahora el panel solo enlazaba a la consulta pública de CONAF. Ahora la
plataforma **lee esa misma página** y muestra el estado real de la
solicitud dentro del panel:

- **Página Estado:** una columna **«Estado CONAF»** con el estado
  (Aprobada, En evaluación, Rechazada, No vigente u Otro estado), siempre
  con texto y no solo con color.
- **Detalle de un PMF:** una sección **«Estado en CONAF»** con tipo de
  solicitud, superficie, fecha de ingreso y de resolución, el botón
  **«Actualizar desde CONAF»** y el enlace **«Ver en CONAF ↗»**.
- **«Cambió»** aparece cuando el estado cambió en los últimos 7 días.
- **«Sin actualizar»** aparece cuando CONAF no respondió y se muestra el
  último dato conocido.

## De dónde sale el número

Se usa el **N Ingreso** de la planilla (el segundo ingreso si existe). Los
valores que no son solo dígitos, como `n/n-n/n`, aparecen como «Sin N.º
consultable». La plataforma completa con ceros a seis dígitos, porque CONAF
responde otra solicitud si falta el cero inicial.

Si CONAF responde **otra** solicitud, el panel no muestra sus datos: avisa
«CONAF respondió otra solicitud (…); revise el número».

## Cada cuánto se actualiza

- Cada noche, después de las 03:00, la plataforma consulta los números de
  la planilla activa, uno por segundo.
- Al abrir el detalle de un PMF se vuelve a consultar si el dato tiene más
  de 12 horas.
- «Actualizar desde CONAF» consulta en el momento. Si se presiona de nuevo
  antes de un minuto, se muestra el resultado recién obtenido.

## Lo que no hace

- No descarga resoluciones ni informes: eso está detrás de la ClaveÚnica
  del titular, y la plataforma nunca usa la ClaveÚnica de nadie.
- No envía correos; los cambios se ven en el panel.

## Pregunta abierta

¿El **N Ingreso** de la planilla es el **N.º de solicitud** de CONAF? Si
no lo es, la columna mostrará avisos de «otra solicitud» o «no encuentra»
y habrá que indicar de dónde sacar el número correcto.
