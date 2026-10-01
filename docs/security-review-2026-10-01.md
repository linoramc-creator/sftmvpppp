# Revisión de seguridad y estabilidad — 1 de octubre de 2026

## Alcance
Revisión del control de acceso del servidor, rutas y validación de peticiones, cuotas, SQL/RLS y privilegios, identidad administrativa, generación y exportación de informes, enlaces externos, descargas de documentos, cabeceras web, dependencias y patrones de credenciales en los 169 archivos versionados. Pruebas no destructivas en producción con dos cuentas temporales y sus propios informes; eliminadas al terminar.

## Correcciones
- Rechazo de peticiones con operaciones simultáneas. Evita diferencias entre la clasificación de consumo y la operación ejecutada (por ejemplo ETF y calendario en una petición).
- Consultas institucionales con IA incluidas en las cuotas de trabajo costoso.
- Validación explícita de los períodos de correlación.
- Documentos descargados directamente únicamente de los hosts SEC autorizados, sin redirecciones y con lectura limitada. Los demás documentos se extraen mediante el proveedor existente, sin permitir que URLs devueltas por el modelo dirijan peticiones del servidor a infraestructura interna.
- Campos de comparación y correlación inicialmente vacíos; eliminación del rótulo ETF sectoriales.
- Estado de generación accesible, tiempo transcurrido, estados derivados de la recepción real del informe y animaciones que respetan movimiento reducido.
- Acceso y registro renovados, foco visible, estado de espera y botón para mostrar/ocultar contraseña.

## Evidencia
- 24 pruebas automatizadas del servidor superadas; incluyen regresiones de peticiones ambiguas, autorización, límites del cuerpo y validación de datos financieros.
- TypeScript y compilación de producción superados.
- npm audit: cero vulnerabilidades conocidas en las dependencias auditadas en esta fecha.
- Escáner de patrones: no se encontraron claves privadas, credenciales de proveedores con los formatos comprobados ni JWT service_role en los archivos versionados actuales. La clave pública de Supabase es pública por diseño; no concede privilegios administrativos.
- Pruebas en producción: se deniega análisis anónimo, elevación de privilegios, administración y revocación desde una cuenta normal, lectura y borrado de informes ajenos, acceso directo a tablas internas y RPC privilegiados, origen no autorizado, operaciones mezcladas y cuerpos excesivos. Se comprueba también RLS y bloqueo de una sesión revocada.
- Administración vinculada al identificador del propietario en tabla privada; una cuenta no obtiene el rol por declarar un correo.
- Informes y PDF escapan el contenido antes de representarlo como HTML. CSP restringe scripts a la aplicación y prohíbe marcos externos.

## Límites y riesgos residuales
Esta revisión no constituye una certificación ni garantiza ausencia de vulnerabilidades. No incluye pentest exhaustivo de infraestructura de terceros, prueba de carga, dispositivos de usuarios, recuperación de copias ni revisión de todo el historial Git. El escaneo de patrones no detecta cualquier posible formato de secreto.

El registro permanece con e-mail y contraseña sin verificación de propiedad del e-mail, conforme a la decisión del propietario. Esto no permite suplantar una cuenta ya existente ni adquirir administración, pero permite registrar correos ajenos todavía libres. Las cuotas globales limitan consumo, aunque registros abusivos pueden agotar la capacidad diaria. CAPTCHA o invitaciones, MFA administrativo y verificación de correo requieren una decisión posterior; no se han activado silenciosamente.

La sesión persiste en el navegador mediante el SDK de autenticación. Un dispositivo o extensión comprometidos queda fuera de estas protecciones. No compartir claves privadas por chats ni incorporarlas al frontend. Rotar una credencial si se considera expuesta. La recuperación de contraseña por correo sigue dependiendo de la configuración de entrega de correo.
