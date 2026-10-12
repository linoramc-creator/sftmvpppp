# Brief diario

Piloto privado para la cuenta administradora existente, vinculada por UUID.
Se prepara a las 06:55 y se intenta entregar a las 07:00 de Europe/Madrid,
todos los días. pg_cron consulta la hora local, de modo que el cambio de horario
no exige modificar una expresión UTC. Hay una segunda comprobación de
generación a las 06:58 y de entrega a las 07:03/07:10.

El brief recoge noticias desde las 00:00 del día anterior hasta el corte de
información. Cotizaciones completas, variaciones de 1/5/21 sesiones, tendencia
por medias 20/50, volatilidad realizada de 5/20 sesiones, volumen relativo y
retroceso del histórico disponible se calculan en código. Se separan los
precios de sesión aún abierta. Los futuros continuos se identifican como tales.
La curva 2/5/10/20 años solo se dibuja si sus fechas coinciden.

Una llamada acotada a Gemini redacta el resumen a partir de los datos reunidos;
las evidencias se contrastan con los identificadores suministrados. Si falla,
se conserva una lectura determinista y los datos, sin inventar análisis.
La edición se guarda por usuario/fecha y no se regenera al volver a abrirla.
Las reclamaciones atómicas evitan trabajos paralelos; máximo tres intentos.

La watchlist se sincroniza en servidor con tope de seis activos. La primera
apertura importa la lista existente del navegador y preserva su contenido.
Las tablas y la credencial de cron no se exponen a anon/authenticated.
Cada petición de la interfaz valida la sesión y la identidad administradora;
el destinatario se toma de la cuenta, nunca del cuerpo de la petición.

## Correo

El registro e inicio de sesión siguen sin depender del correo. El brief necesita
un remitente SMTP o Resend configurado aparte. Mientras falte, se genera y archiva
pero su estado es `unavailable`: no se declara enviado.

Para Gmail: activar una contraseña de aplicación en la cuenta y ejecutar
`scripts/configure-brief-email.ps1 -Provider Gmail`. El script solicita la
credencial sin mostrarla y la guarda exclusivamente como secreto de Supabase.
No utilizar la contraseña normal de Google ni pegar credenciales en el chat.
SMTP exige TLS válido (465 o 587); los gráficos se generan localmente como PNG
y se adjuntan mediante CID. No hay servicios públicos de gráficos ni URLs con
datos privados. Resend usa una clave de idempotencia por edición; SMTP usa
reclamación atómica y no reintenta entregas inciertas automáticamente.

Una aceptación SMTP/API no garantiza llegada a bandeja de entrada. Revisar el
resultado real y spam en la prueba. Gmail conectado en Codex no configura por sí
solo el remitente del servidor ni sus credenciales de ejecución diaria.

Referencias: https://supabase.com/docs/guides/functions/schedule-functions,
https://nodemailer.com/smtp, https://resend.com/docs/api-reference/emails/send-email.
