# Brief diario

Piloto privado para la cuenta administradora existente, vinculada por UUID.
La hora inicial es 07:00 de Europe/Madrid, editable en BRIEF. Se prepara cinco
minutos antes y se intenta entregar a la hora elegida, todos los días. pg_cron consulta la hora local, de modo que el cambio de horario
no exige modificar una expresión UTC. Hay una segunda comprobación de
generación dos minutos antes y de entrega tres y diez minutos después.
Se contemplan las ediciones de ayer, hoy y mañana para respetar horarios
cercanos a medianoche. En horas duplicadas de otoño se usa la segunda
ocurrencia; en una hora inexistente de primavera se avanza al tramo siguiente.

El brief recoge noticias desde las 00:00 del día anterior hasta el corte de
información. Cotizaciones completas, variaciones de 1/5/21 sesiones, tendencia
por medias 20/50, volatilidad realizada de 5/20 sesiones, volumen relativo y
retroceso del histórico disponible se calculan en código. Se separan los
precios de sesión aún abierta. Los futuros continuos se identifican como tales.
La curva 2/5/10/20 años solo se dibuja si sus fechas coinciden.

Una llamada acotada a Gemini 3 Flash (`gemini-3-flash-preview`, razonamiento mínimo) redacta el resumen y el cierre geopolítico a partir de los datos reunidos;
se deduplican artículos y se excluyen imágenes e históricos del contexto de IA. El máximo de salida es 4.600 tokens. Las evidencias se contrastan con los identificadores suministrados. Si falla,
se conserva una lectura determinista y los datos, sin inventar análisis.
La edición se guarda por usuario/fecha y no se regenera al volver a abrirla.
Las reclamaciones atómicas evitan trabajos paralelos; máximo tres intentos
para cada edición diaria. Las pruebas se guardan por separado, con un UUID
de petición para reintentos idempotentes y un máximo de cinco al día.
Generar una prueba no envía correo: ese envío es una acción independiente.
El trabajo continúa en servidor aunque se cambie de apartado.

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

## Presentación y seguimiento

Plantilla editorial propia: Georgia para lectura y titulares, Consolas para
cifras, grises, azul marino y verde de la terminal. Los gráficos web y los PNG
de correo comparten la misma paleta. No se cargan fuentes externas en el correo.
La lista aparece antes del detalle general, con resumen comparativo, rendimiento,
riesgo, actividad, niveles, comentario y noticias. Añade ATR de 14 sesiones,
rango de 20 sesiones, medias ajustadas y diferencia de rentabilidad frente a SPY.
La correlación exige veinte rendimientos alineados en ambas fechas del intervalo;
una fecha de cierre diferente deja la comparación sin dato.

El horario y las pruebas validan la identidad administradora en cada petición;
no hay activación para otros usuarios ni flags confiados al navegador.

## Publicación

La migración `202610120003_brief_preferences_and_trials.sql` debe aplicarse antes
de publicar esta versión de `daily-brief`. El despliegue normal usa Supabase CLI.
El 12 de octubre, su endpoint de despliegue devolvió un error interno incluso
con una función mínima. La publicación se completó mediante la API oficial
`PATCH /v1/projects/{ref}/functions/daily-brief`, enviando `body` con el módulo
compilado como ESM (esbuild, plataforma neutral, destino es2022, `npm:*` y
`node:*` externos) y `verify_jwt:false`. La función conserva su validación
manual de sesión e identidad. La credencial de gestión se lee solo dentro
del proceso; no se incluye en el bundle ni en los registros.

## Edición compacta (13 de octubre de 2026)

Los 19 activos generales y la curva del Tesoro se distribuyen en dos láminas
de diez recuadros: índices, ETF y volatilidad; materias primas, divisas, Bitcoin
y renta fija. La watchlist conserva su detalle independiente. Los saltos A4
reservan una página para cada lámina; el correo muestra los mismos bloques y
en móvil se apilan para conservar la lectura. Las fotos geopolíticas miden
146 x 98 píxeles en escritorio y 88 x 64 en móvil.

El cierre internacional reúne hechos políticos, posibles canales de transmisión
y riesgos de las noticias del informe. Se valida que cite evidencias suministradas
y, cuando existen noticias políticas, al menos una de ellas. Para archivos
anteriores sin este campo se utiliza el contenido ya guardado, sin llamar a IA.
Se distinguen titulares intradiarios, fechas de cierre y consecuencias hipotéticas.

Solo una respuesta explícita 404, 429 o de indisponibilidad del servicio permite
intentar Gemini 2.5 Flash como reserva. Un timeout o JSON inválido no dispara
otra generación. Se guarda el modelo realmente utilizado y el uso de tokens.
El coste estimado aplica las tarifas estándar de texto consultadas el 13/10/2026:
3 Flash, 0,50 USD de entrada y 3 USD de salida por millón; 2.5 Flash, 0,30 y
2,50 USD. Incluye tokens de razonamiento; excluye APIs, correo, impuestos y
descuentos del plan. No se presenta como facturación real.
Referencia: https://ai.google.dev/gemini-api/docs/pricing.
