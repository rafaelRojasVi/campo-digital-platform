# Transelec — inicio de sesión con Google Workspace (2026-09-17)

Documento de colaboración para Campo Digital y Javier. Explica cómo se
entrará al tablero de Transelec cuando esté en línea, qué debe configurar
Javier en Google Cloud, y qué falta todavía para poder decir que funciona.

La versión técnica completa está en
`docs/adr/ADR-010-google-workspace-sign-in-for-transelec.md` (inglés), y los
pasos exactos de la consola en
`docs/platform/google-workspace-oauth-handoff.md` (inglés).

## Qué cambió y por qué

Hasta ahora la plataforma iba a usar cuentas Microsoft. En septiembre quedó
establecido que **no existe un directorio Microsoft de Campo Digital**: la
carpeta compartida es un OneDrive personal, no una organización de Microsoft
365, y crear una exige un registro en Azure con verificación de tarjeta.

Campo Digital **sí** tiene Google Workspace en el dominio `campodigital.cl`.
Para el piloto de Transelec conviene más un proveedor de identidad que ya
existe que uno mejor en teoría y bloqueado en la práctica.

Entonces: **el tablero de Transelec se entrará con «Continuar con Google»**,
usando las cuentas `@campodigital.cl`. Microsoft sigue implementado y
disponible para los otros productos (LiDAR y Gestión Predial Forestal); no se
eliminó nada de ese lado.

## Cómo se ve para quien entra

1. La persona abre el tablero y ve un solo botón: **Continuar con Google**.
2. Google le pide elegir su cuenta `@campodigital.cl`.
3. Vuelve al tablero y ve lo que sus permisos le permiten ver.

No hay contraseña propia de Campo Digital que recordar, ni usuarios creados a
mano. Los botones de demostración («entrar como administrador», «ver como
Javier») **no existen** en la versión publicada: están eliminados del archivo
que se despliega, no solamente ocultos.

Si en algún entorno falta la configuración de Google, la pantalla lo dice con
claridad y se detiene. Nunca cae de vuelta a un acceso de demostración.

## Entrar no es tener permiso

Esto es importante y es deliberado:

> Una cuenta válida de `campodigital.cl` que no tenga permiso sobre Transelec
> inicia sesión correctamente y, aun así, **no ve el seguimiento**: el
> servidor le responde «no autorizado» (403).

Autenticarse responde *quién es usted*. Autorizar responde *qué puede hacer*,
y eso lo decide el permiso que tenga su cuenta sobre el producto Transelec.
Son dos pasos distintos y siguen siéndolo.

Tampoco basta con que el correo termine en `@campodigital.cl`: el servidor
exige que Google afirme, dentro del token firmado, que la cuenta pertenece al
Workspace de `campodigital.cl`. Una dirección que sólo *parece* del dominio no
entra.

## Cómo se reparten los permisos al principio

1. **El primer administrador.** Se configura una única dirección de correo
   que, al iniciar sesión por primera vez, recibe el rol de administrador
   **sólo sobre Transelec**. Nunca sobre LiDAR ni sobre Forestal. Es por una
   sola vez: si más adelante se le baja el rol, volver a entrar no se lo
   devuelve.
2. **El resto del equipo.** Los agrega ese administrador, por correo, desde la
   plataforma. Con una condición práctica: **cada persona debe haber iniciado
   sesión al menos una vez antes** de que se le pueda asignar un permiso,
   porque su cuenta en la plataforma recién existe desde ese momento.

   Es decir, el orden real es: la persona entra una vez (y verá un mensaje de
   «sin permisos»), y después el administrador le asigna el rol —
   `viewer` para consultar el tablero, `operator` o `admin` para además
   importar planillas y publicar o restaurar versiones.

## Qué debe configurar Javier

En la consola de Google Cloud, en un proyecto del dominio `campodigital.cl`.
El detalle exacto está en `docs/platform/google-workspace-oauth-handoff.md`;
el resumen:

1. **Pantalla de consentimiento OAuth**, de tipo **Interno** (sólo cuentas
   `campodigital.cl`). Permisos solicitados: únicamente `openid`, `email` y
   `profile`. Nada más — esta aplicación no lee Drive, ni correo, ni
   calendario.
2. **Cliente OAuth de tipo «Aplicación web»**, con la **URI de retorno**
   exacta:
   - `http://localhost:8000/auth/google/callback` (desarrollo local; ya es
     definitiva y se puede agregar ahora).
   - `https://<dominio-definitivo>/auth/google/callback` — **esta no se puede
     cerrar todavía**, porque depende de qué dominio público se elija para el
     piloto (ver `2026-09-16-alternativas-alojamiento-piloto.md`). Debe
     coincidir carácter por carácter; si difiere, Google rechaza el ingreso.
3. Entregar por un canal seguro (no correo ni chat en texto plano):
   - el **ID de cliente**;
   - el **secreto de cliente**.
4. Decidir **cuál dirección `@campodigital.cl`** será el primer administrador
   de Transelec.

## Qué falta para poder decir que funciona

**Todavía no se ha probado contra Google.** Todo lo implementado está
verificado con pruebas automáticas, incluidas pruebas criptográficas reales
con tokens firmados localmente (firma correcta e incorrecta, clave
desconocida, token vencido, dominio equivocado, correo no verificado, y más).
Pero ninguna de esas pruebas habla con Google.

Para confirmarlo hace falta, y aún no ocurre:

- el cliente OAuth creado por Javier (los dos valores del punto 3);
- el dominio público definitivo, que fija la URI de retorno;
- **una prueba real de inicio de sesión** con una cuenta `@campodigital.cl`,
  que es lo único que puede confirmar que el dominio llega como se espera y
  que el primer administrador recibe el rol correcto.

Hasta que esa prueba se haga, «el acceso con Google funciona» es una
expectativa bien fundamentada, no un hecho confirmado.

## Documentación relacionada

[Alternativas de alojamiento del piloto](2026-09-16-alternativas-alojamiento-piloto.md) ·
[Estado de los planes de manejo](2026-09-15-estado-planes-de-manejo.md) ·
[ADR-010 — Google Workspace sign-in (inglés)](../../../../docs/adr/ADR-010-google-workspace-sign-in-for-transelec.md) ·
[Pasos en Google Cloud (inglés)](../../../../docs/platform/google-workspace-oauth-handoff.md)
