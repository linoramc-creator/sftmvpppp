# Noticias y seguimiento · 15 de octubre de 2026

El feed incluye ocho instrumentos por tarjeta de divisas y materias primas.
Se añaden USD/CHF, USD/CAD, AUD/USD, USD/CNY, plata, trigo y maíz. Los futuros
conservan el precio y la moneda originales; trigo y maíz se muestran en
centavos estadounidenses por bushel, sin convertir el importe en dólares.

Las noticias se presentan dentro de la terminal, sin enlaces de salida ni
etiquetas de proveedores, tanto en feed como en fichas, informes y brief.
Las referencias se conservan en los datos para validar hechos, sin mostrarlas
en la interfaz. Las imágenes siguen siendo recursos externos: retirar los
enlaces no hace secreto su origen técnico.

Los puntos clave se redactan en español mediante una petición Gemini Flash
por selección, con nueve segundos de límite y un máximo de 24 noticias.
Se reutilizan solicitudes concurrentes y resúmenes por artículo durante
48 horas en la instancia; los fallos tienen una caché de 15 minutos.
El feed completo aprovecha también la caché compartida existente entre usuarios.
El brief incorpora los puntos en su generación actual, sin una petición adicional.

Solo se emplean el titular y el extracto disponibles. Se rechazan identificadores
ambiguos, cifras nuevas, enlaces y contenido inválido. Si falta IA o evidencia,
se conserva un extracto o el titular; nunca se inventan detalles para rellenar
puntos. Estas validaciones reducen errores, pero no prueban por sí solas la
exactitud semántica de un resumen generado.

Los resultados empresariales abren la misma ficha de seguimiento que la
watchlist. Sus noticias y las de los informes usan fotografías compactas,
con un máximo habitual de 144 × 96 píxeles en escritorio. Los artículos
permanecen legibles si la portada no está disponible.

La comprobación en producción detectó que la restricción de `beta_feed_cache`
solo admitía las claves de la versión dos. La migración del día permite
versiones acotadas y claves con símbolos de seguimiento; conserva las filas,
RLS y el acceso exclusivo de servicio. Una selección exclusivamente geopolítica
también es un resultado útil para la caché; una caída total no reemplaza datos.
La prueba SQL valida los formatos y los permisos con cambios revertidos.
