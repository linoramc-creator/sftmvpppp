# Acceso personal por código numérico

Cada usuario elige un código de **cinco dígitos** y entra con su **e-mail y
código**. Se conservan los ceros iniciales. El e-mail identifica la cuenta y
permite que dos usuarios elijan el mismo número sin compartir acceso.

El código nunca se guarda en texto claro: el servidor conserva un HMAC que
incluye e-mail normalizado y código, con `ACCESS_CODE_PEPPER` exclusivo del
servidor. No se envían códigos, enlaces ni OTP por e-mail. Las contraseñas
internas de Supabase siguen siendo aleatorias de 128 bits; nunca son el PIN.
Un PIN corto tiene menos entropía que una contraseña larga; la protección
frente a intentos de adivinación depende de los límites del servidor.

## Activación y sustitución

- Cuenta sin código previo: **Activar mi código**, verificar e-mail y contraseña
  actuales una sola vez, elegir cinco dígitos y repetirlos. Se retira la
  contraseña anterior conservando identidad, informes y permisos.
- Cuenta con el antiguo código largo: **Tengo un código anterior**, verificarlo
  y elegir el código numérico. Esa comprobación sólo permite cambiar el código;
  no abre datos de la terminal. El permiso de migración caduca a los diez minutos.
- Cuenta nueva: **Crear cuenta**, nombre, e-mail, código elegido y confirmación.
- Sesión abierta: **Mi código** permite sustituirlo e invalida las sesiones y
  el código anteriores. El código guardado no se puede consultar.

Si la transición se interrumpe después de guardar el nuevo código, entrar con
el e-mail y ese código permite terminarla. Recuperar un código perdido requiere
intervención del propietario; no se ha añadido recuperación por correo.

## Sesiones y límites

Supabase Auth conserva la identidad. Las peticiones interactivas y RLS exigen
un permiso por usuario, `session_id` y versión del código, de hasta doce horas.
La sesión del navegador sólo vive en memoria: al abrir o recargar la página
se pide el acceso. La bienvenida sigue esperando a que termine el feed.
Los trabajos programados conservan su autenticación independiente.

Se permiten cinco intentos por cuenta cada quince minutos y un máximo de
veinticinco fallidos diarios, además de límites por conexión y globales.
Cambiar el número o la IP no reinicia el límite de cuenta. Un acceso correcto
verificado reinicia el contador corto y descuenta sólo su intento del diario,
para no bloquear a quien entra varias veces correctamente. Los errores no
revelan si el e-mail está registrado.

El formato anterior sólo sirve para migrar. Sus sesiones no conceden acceso
interactivo después de aplicar la migración numérica. Los permisos temporales
usan una versión negativa que nunca satisface las políticas de datos y se
revocan al cambiar el código. Todos los RPC de acceso son exclusivos del servidor.
Nunca registrar códigos, tokens ni claves.

## Publicación

Conservar `ACCESS_CODE_PEPPER`; reemplazarlo invalidaría los códigos existentes.
Aplicar `202611220003_numeric_access_codes.sql` después de las dos migraciones
anteriores del 22 de noviembre. Publicar `terminal-access` y `Terminal_Export`.
Comprobar activación, migración, PIN compartido por dos e-mails, permisos,
rotación y bloqueos con cuentas temporales. No modificar las credenciales del
administrador: el propietario debe elegir su código en la interfaz.
