# Acceso personal por código

La entrada habitual requiere un código privado generado en el navegador con
128 bits aleatorios. No se guarda el código en texto claro: el servidor conserva
un HMAC con `ACCESS_CODE_PEPPER`, secreto exclusivo de Supabase Functions.
El código equivale a una credencial; el usuario debe guardarlo antes de entrar.

## Activación y cuentas existentes

En la pantalla pública, elegir **Activar mi código**, verificar el e-mail y la
contraseña actuales una sola vez, generar el código y confirmar que se ha
guardado. La identidad, informes, listas y rol de administrador se conservan.
La contraseña anterior se retira y las sesiones anteriores quedan invalidadas.
Después se entra exclusivamente con el código, también el administrador.
Las cuentas nuevas eligen nombre y e-mail y generan su código al registrarse.

**Mi código** permite sustituirlo desde una sesión válida; el cambio revoca
el código y las sesiones anteriores. No se puede consultar un código guardado.
Si se interrumpe la activación después de guardarlo, el acceso con ese mismo
código permite finalizarla. La recuperación de un código perdido requiere
intervención del propietario; no existe recuperación por e-mail automática.

## Sesiones y aislamiento

Supabase Auth mantiene la identidad y emite sus tokens normales. La verificación
de un enlace de acceso ocurre únicamente en el servidor y no envía correos ni
devuelve enlaces u OTP al cliente. Cada sesión necesita además un permiso por
`session_id`, usuario y versión del código, con un máximo de doce horas.
Las peticiones interactivas y las políticas RLS comprueban ese permiso.
Un JWT antiguo o una entrada directa con contraseña no obtiene acceso.

El navegador conserva la sesión sólo en memoria: al abrir o recargar la página
se solicita de nuevo el código. La bienvenida existente sigue esperando a que
el feed indique que ha terminado. Los trabajos programados conservan su
autenticación propia y no dependen de un navegador abierto.

Hay límites globales, por origen de conexión y por credencial; los intentos
rechazados también incrementan los contadores. Los RPC de códigos y sesiones
son exclusivos del servidor. Nunca registrar códigos, tokens ni claves.

## Publicación

1. Configurar `ACCESS_CODE_PEPPER` una sola vez con al menos 32 caracteres
   aleatorios. No reemplazarlo al volver a desplegar: invalidaría los códigos.
2. Aplicar `202611220001_analytics_catalog.sql` y
   `202611220002_personal_access_codes.sql`.
3. Publicar `terminal-access`, `analyze-ticker`, `daily-brief` y `options-data`,
   y la interfaz de `Terminal_Export`.
4. Verificar registro, activación de cuenta anterior, aislamiento RLS,
   sustitución y revocación con cuentas temporales; conservar el administrador.
5. El propietario activa su propio código en la interfaz. El despliegue no
   crea ni conoce su código personal.
