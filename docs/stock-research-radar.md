# Radar de acciones

Sustituye exclusivamente el calendario lateral de resultados del feed. No cambia las noticias ni los otros recuadros. La paleta sobria del resto de la terminal se activa con `data-terminal-palette="neutral"`; feed, seguimiento y mercado conservan su paleta original y las series de los gráficos mantienen sus colores financieros.

## Selección y alcance

El horizonte de seis meses orienta el seguimiento; no es una previsión de precio ni una promesa de rentabilidad. El radar no llama a Gemini. Selecciona una muestra de acciones estadounidenses líquidas no financieras a partir del screener, si está autorizado, o de posiciones publicadas de fondos. Contrasta un máximo de 18 emisores y publica hasta nueve, con un máximo de dos por sector y una sola clase por emisor. La interfaz muestra seis a la vez y permite explorar la selección mediante filtros locales.

Requiere capitalización y liquidez verificadas, cuatro trimestres comparables con beneficio, caja operativa y caja libre acumulados positivos, crecimiento interanual de ingresos y otra señal verificable: caja libre frente a capitalización, mejora del margen, revisión del BPA o fortaleza relativa frente al fondo sectorial. No interpreta volumen como compras institucionales. Se excluyen bancos y REIT porque las métricas operativas elegidas no son comparables para esos negocios. Los umbrales y límites de cobertura pueden consultarse en el propio radar.

Las rentabilidades sectoriales usan cierres ajustados, moneda compatible y sesiones comunes durante seis meses. Los resultados publicados conservan su período fiscal y moneda. El registro de cotización, la fecha de consulta y una fecha de publicación financiera o de posiciones son conceptos separados; las fechas desconocidas permanecen desconocidas.

## Proveedores y reactivación

EODHD permanece como fuente preferida cuando devuelve datos completos y recientes. La prueba inicial de SPY evita repetir solicitudes de fundamentales denegadas para todo el lote. Cada nueva actualización vuelve a comprobar esa disponibilidad: al reactivar el plan con la misma clave no hay que cambiar el código.

Mientras ese acceso no está disponible, el adaptador reutiliza los lectores existentes de Yahoo para perfiles, composición publicada de fondos, observaciones trimestrales originales y cierres ajustados. Los puntos anuales o acumulados YTD no se convierten en trimestres, ni se mezclan fechas vecinas o monedas diferentes. FMP se consulta únicamente si faltan cuentas verificables; sus rutas están limitadas a perfil, cotización fechada y estados trimestrales y un rechazo se enfría antes de consultar más emisores. Las previsiones o clasificaciones ausentes no se reconstruyen con un modelo.

En la validación del 3 de noviembre de 2026, EODHD identificó la cuenta como gratuita y Massive no autorizó sus ratios financieros. La alternativa devolvió una muestra real con nueve candidatos sin consumir Gemini. No se considera que estos permisos permanezcan invariables.

## Coste, carga y seguridad

`beta_stock_radar_cache` y `beta_stock_radar_job` son privados del servicio. Un bloqueo persistente de tres minutos se adquiere antes de consultar proveedores; los visitantes concurrentes comparten el resultado durante seis horas. El primer acceso inicia un trabajo de fondo y la interfaz espera mediante consultas acotadas. Los fallos tienen una espera de quince minutos y nunca sustituyen una selección útil por datos inventados. Una captura anterior puede conservarse hasta 24 horas con su fecha original mientras se actualiza.

La carga se inicia después de los datos y noticias del feed y no bloquea la bienvenida. Los filtros son locales, no generan nuevas consultas ni nuevos informes. El feed ya no solicita el calendario que sustituye el radar; los lectores de calendario usados por otras funciones se conservan. La sesión y las cuotas se verifican antes de acceder a la caché y el navegador no puede reclamar trabajos ni forzar actualizaciones. Las claves y respuestas de error de los proveedores permanecen en el servidor.
