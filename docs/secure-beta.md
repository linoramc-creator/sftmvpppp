# Beta con perfiles privados

## Acceso y administración

- Entrada: `https://sftmvpppp.vercel.app/`.
- Administración: `https://sftmvpppp.vercel.app/admin`.
- Acceso sin contraseña, mediante enlace enviado al e-mail. Supabase debe mantener la confirmación de correo activada y las sesiones anónimas desactivadas.
- Solo el e-mail **verificado** `linoramc@gmail.com` recibe administración. No se aceptan roles enviados por el navegador ni en metadatos editables del usuario.
- El administrador puede ver registros, e-mails, solicitudes, informes completados, número de guardados, activos analizados y estado de cada solicitud; puede revocar y restaurar accesos. La actividad se registra en el servidor.
- La revocación bloquea nuevas consultas y lecturas de informes incluso con un JWT aún vigente. La interfaz comprueba el acceso cada minuto. No borra información ya descargada ni puede retirar una respuesta ya enviada.

## Datos y límites

`beta_profiles`, `beta_reports`, `beta_usage`, `beta_rate_buckets` y `beta_admin_audit` tienen RLS. Las escrituras se realizan mediante operaciones autorizadas en Edge; las lecturas directas de informes solo permiten los del usuario activo. Las funciones privilegiadas no son ejecutables por usuarios ni por la clave anónima.

- 20 informes solicitados por cuenta y día UTC; 200 para toda la beta.
- Un informe simultáneo por cuenta. Una reserva sin finalizar expira tras diez minutos.
- Hasta 100 operaciones costosas por usuario/día y 1.000 globales; incluyen informes, noticias, negocio y ficha ETF.
- 60 peticiones por minuto y 2.000 diarias por cuenta.
- Hasta 100 informes guardados; máximo 500 KB por informe. El listado descarga solo metadatos; el contenido se recupera al abrirlo.
- Los límites se reservan atómicamente en Postgres, compartidos entre instancias; fallos y cancelaciones también consumen cupo. No son una garantía de gasto monetario exacto.
- Las reservas fallidas antiguas se cierran cuando el usuario pide otro informe. No se cuentan como completadas.

Los antiguos informes locales no se mezclan con los de los testers. El administrador dispone de una importación explícita desde su navegador; el original local se retira únicamente después de guardarlo correctamente en la cuenta.

## Medidas aplicadas

Validación de identidad con el servidor Auth en cada llamada, comprobación de revocación, tamaños y formatos de entrada limitados, CORS restringido, errores técnicos ocultos, CSP, protección contra inserción en iframes y redirecciones de acceso limitadas al dominio de producción. Las claves de proveedores y la clave de servicio permanecen en el backend. `verify_jwt=false` se conserva para compatibilidad con las claves de firma modernas: **no significa acceso público**, ya que el handler valida el usuario con Auth antes de cualquier proveedor o consulta de pago.

Actualizadas dependencias, eliminada la librería PDF sin uso y dos clientes antiguos sin uso que pretendían consultar proveedores con claves VITE. El constructor HTML de impresión escapa también el nombre del activo. Los paneles de terminal y administrador se cargan bajo demanda tras iniciar sesión.

## Correo: requisito de activación

En la revisión del 16/09/2026 **no había SMTP propio configurado**. El servicio de correo por defecto de Supabase solo sirve para las direcciones autorizadas del equipo y no habilita una beta abierta. Se necesita configurar un remitente y credenciales SMTP en Authentication → Emails → SMTP Settings. No se deben incluir esas credenciales en GitHub, variables VITE ni conversaciones.

La URL de sitio y redirección se ha configurado a `https://sftmvpppp.vercel.app/`. No desactivar la confirmación del e-mail para resolver un fallo de entrega: permitiría suplantar direcciones y no sustituye el envío del enlace.

Antes de invitar testers, probar registro, recepción y apertura del enlace con un correo externo al equipo. Hasta completar esa configuración y prueba, el registro externo **no está listo**, aunque el código y los despliegues estén completos.

## Validación

`node --test tests/beta-security.test.ts tests/editorial.test.ts tests/market-panels.test.ts`; tests de frontend; TypeScript frontend y backend; build; `npm audit`; asesores de seguridad Supabase. `tests/beta-database.sql` comprueba RLS, aislamiento, revocación, cuotas y administración dentro de una transacción que se revierte. Las pruebas reales de API usan cuentas temporales, no envían correos y eliminan las cuentas al terminar.

Las comprobaciones reducen los riesgos identificados; no equivalen a una garantía de ausencia de vulnerabilidades ni sustituyen la monitorización durante la beta.
