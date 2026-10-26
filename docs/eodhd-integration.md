# EODHD: prioridad de datos de MensorTerminal

## Símbolos visibles y metales al contado · 26 de octubre de 2026

El feed presenta símbolos de investigación como SPX, NKY, EURUSD y USDJPY;
los identificadores originales se conservan para peticiones, caché y clics.
Las raíces de futuros (GC, SI, CL, BZ, NQ, etc.) siguen identificadas como
futuros y nunca se renombran como instrumentos al contado. Las parejas de
divisas conservan su dirección, incluidas las referencias USD/base.

El preajuste de materias primas utiliza XAUUSD y XAGUSD al contado. La cuenta
actual permite verificar OHLC diarios de XAUUSD.FOREX y XAGUSD.FOREX, pero las
sondas de cotización e intradía no proporcionaron precios actuales válidos.
Se muestran cierres diarios completados, con fecha original, USD por onza troy
y variación entre cierres de la misma serie; no se inventa una hora intradía.
La lectura diaria se reutiliza durante una hora. Massive se conserva como
respaldo de barras diarias históricas cuando falte la fuente principal.
Las selecciones personalizadas de futuros se mantienen.

Los alias del Tesoro US03MY, US06MY, US01Y, US02Y, US05Y, US10Y y US20Y se
presentan como rendimientos CMT diarios de referencia. No son una cotización
intradía de un bono concreto ni datos obtenidos de TradingView.

Verificación: 21 de octubre de 2026. La cuenta identifica la suscripción como
`trial`, con límite declarado de 100.000 unidades de API al día. No se ha
contratado ni ampliado ningún plan. La cobertura verificada es la de esta clave
en esta fecha; no garantiza derechos permanentes para todos los productos.

## Configuración y seguridad

`EODHD_API_KEY` es un secreto del servidor en Supabase. Nunca debe estar en
variables VITE, Git, navegador, informes ni mensajes de error. El transporte
solo permite el destino HTTPS oficial y rechaza redirecciones y parámetros que
sobrescriban credenciales. Tiene caché limitada, coalescencia de solicitudes,
seis conexiones concurrentes, tiempos de espera y circuitos para 401/402/403/429.
Los endpoints conservan autenticación y presupuestos por usuario existentes.

## Prioridad y cobertura comprobada

- Fundamentales v1.1 de AAPL, SPY y SAP.XETRA: perfil, estados trimestrales,
  valoraciones, consenso agregado, estimaciones y datos de ETF accesibles.
  Una respuesta se reutiliza seis horas para evitar volver a pagar cada bloque.
- Cotizaciones e históricos: acciones, ETF, índices y divisas. Las cotizaciones
  REST de acciones tienen normalmente 15–20 minutos de retraso. Las divisas se
  actualizan aproximadamente cada minuto. No se presenta esto como tiempo real.
- Intradía: 1m/5m/1h; EODHD publica barras finalizadas con demora. Cuando no
  cubren la sesión actual se conservan las fuentes anteriores. Las sesiones
  extendidas siguen requiriendo datos con sesión y fecha verificadas.
- Bonos GBOND: referencias benchmark diarias en EE. UU., Francia, Alemania y
  Reino Unido. Francia: 1/2/5/10 años; resto: 2/5/10/30 años comprobados.
  Curvas par nominales/reales del Tesoro se muestran separadas de benchmark.
  Nunca se empalman series diarias con medias mensuales.
- Tipos oficiales, financiación y CMDI: solo observaciones disponibles, con
  frecuencia y fecha original. FRED sigue cubriendo OAS y crédito privado
  que EODHD no aporta en los conjuntos comprobados.
- Noticias y calendario: EODHD primero; los proveedores anteriores completan
  huecos. El calendario usa `report_date`, conserva el período fiscal aparte
  y excluye resultados ya publicados, incluso cuando el EPS real es cero.
- Opciones: dos sondas limitadas de contratos y EOD devolvieron 403. Se conserva
  la cadena anterior: no se reemplazan datos intradía por históricos EOD.
- Desglose de ingresos: no se ha comprobado un conjunto homogéneo de segmentos
  en este producto. Se conserva la recuperación de documentos y otras fuentes
  cuando falte, sin inventar cifras para rellenar tablas.

La prioridad abarca paneles, informes y datos del Morning Brief. Las fuentes de
respaldo solo completan datos ausentes o productos no comparables/disponibles.
Se conservan moneda de cotización y moneda de estados por separado, unidades,
fechas, ceros reales y huecos. Las posiciones institucionales no se etiquetan
como flujos, órdenes ni recomendaciones de una institución concreta.

## Nuevos bloques

### Fichas del feed y gráficos (21 de octubre de 2026)

- Las referencias laterales usan un contrato compartido de símbolos: S&P 500
  `^GSPC` y VIX `^VIX` en puntos, con IWM y GLD identificados como ETF. Esto
  corrige el fallo que buscaba SPY/VIXY en respuestas de índices auténticos.
- `assetCandles` carga exclusivamente precios y OHLC, sin noticias ni modelos.
  Reutiliza caché y peticiones concurrentes; solicita tres meses horarios,
  dos años diarios y cinco años semanales. El resumen ejecutivo y las fichas
  del feed comparten el gráfico japonés: 4H y un mes por defecto, con tres
  meses cuando la cobertura real lo permite. Nunca deriva 4H de barras diarias.
- EODHD mantiene prioridad. Si falta toda una sesión confirmada en el horario,
  se intenta el respaldo previo; si falla o es más antiguo se conserva el
  histórico disponible con su fecha. Las barras de Massive de sesión extendida
  solo respaldan series insuficientes y no se mezclan con otra fuente o ancla.
- Se ordenan y validan OHLC y volúmenes; los índices/divisas no reciben volumen
  ficticio. Se descartan marcadores planos de cotización añadidos dentro de
  una barra o al cierre; no son otra vela. Las sesiones diarias finalizadas
  dejan de aparecer parciales y se conserva el tramo corto de la sesión de 4H.
- `assetInsights` añade datos estructurados sin generación: doce trimestres de
  ventas, caja y deuda, métricas fechadas y exposición/posiciones de ETF. Las
  cifras financieras se expresan en millones de su moneda de estados; las
  distintas monedas no se unen en una serie.
- Los estudios utilizan cierres ajustados coherentes para acciones/ETF y
  precios para índices/divisas/futuros: calendario mensual, distancia al máximo
  de la muestra y duración en sesiones, eficiencia de tendencia y Sortino con
  objetivo cero. Se exigen muestras mínimas y no se presenta una regularidad
  histórica como probabilidad de subida ni como entrada institucional.
- El perfil breve de negocio se amplía en actividad, clientes y modelo de
  ingresos. Es una tarea auxiliar pequeña y cacheada, independiente de los
  informes finales Pro. La carga ligera del gráfico no espera ese texto ni las
  noticias. Las fichas de índices/ETF conservan una vista separada de la sesión.

### Investigación y fiabilidad (21 de octubre de 2026)

- Los informes finales de acciones, ETF, sectores y comparación usan
  `gemini-3.1-pro-preview`, con razonamiento medio y límites de salida y tiempo.
  No existe degradación silenciosa a Flash. Este último queda reservado para
  tareas auxiliares pequeñas. Un informe real de VRT confirmó el modelo Pro.
- La búsqueda admite símbolos y nombres. Los nombres con varias cotizaciones
  requieren elegir mercado; las clases de acciones, sufijos y monedas se
  conservan. Un 403 de un recurso no desactiva todo el producto del proveedor.
- VRT y GOOGL se comprobaron en producción: identidad, moneda, 16 trimestres,
  consenso y estimaciones. El CIK de EODHD permite recuperar documentos SEC sin
  depender del acceso a FMP para identificar al emisor.
- El desglose intenta primero los datos estructurados. Si faltan, puede leer
  hechos anuales Inline XBRL directamente del informe oficial: entidad,
  concepto, moneda, fechas y eje único deben coincidir y cuadrar con el total
  consolidado. No se buscan subconjuntos arbitrarios para hacer cuadrar cifras.
  Para VRT esto recuperó productos, servicios y cinco destinos de ventas sin
  generación adicional. Los documentos sin hechos compatibles conservan la
  extracción asistida y validada; no se promete cobertura universal.
- La selección de pasajes conserva las unidades globales, desagregaciones y
  ventas por destino, elimina encabezados XBRL ocultos completos y admite
  documentos hasta 12 MB. Los excesos se rechazan, no se analizan como documentos
  completos truncados. La extracción asistida contrasta escala, divisa explícita,
  período, evidencia literal, signos y totales.
- La memoria solo guarda informes con finalización `stop` y marcador `[DONE]`.
  La interfaz descarta informes incompletos; el panel de administración registra
  correctamente las interrupciones y cancelaciones. Los resúmenes PDF tienen
  un plazo propio que permite terminar al modelo Pro.
- Noticias de la ficha rápida: EODHD primero y fuentes previas para completar
  huecos. Riesgo, alertas y contexto asiático reutilizan la prioridad de mercado
  y conservan los cortes temporales de las sesiones.
- Velas: bandas de Bollinger opcionales, ATR de Wilder, zoom y ventanas ampliadas,
  ejes intradía y precisión de divisas. No se añade una vela plana artificial
  para representar un cierre ni una guía de precio al señalar volumen.

### Bonos y crédito

- Cuatro curvas soberanas verificadas, referencias de respaldo y filtrado
  individual de tenores desactualizados. La curva estadounidense separa 20 años,
  nominales y reales; la inflación implícita utiliza fechas coincidentes.
- MOVE y VIX auténticos con fecha, percentiles históricos y volatilidad realizada
  del tipo a diez años en puntos básicos diarios. La volatilidad realizada de
  tipos no se presenta como si fuera el índice MOVE.
- El crédito privado utiliza también la publicación oficial S.124.8.s de la
  Reserva Federal, con su frecuencia trimestral y precisión publicada.
- Durante la validación, la exportación CSV de FRED devolvió una página de
  mantenimiento: las series OAS afectadas no se fabrican ni se sustituyen por
  indicadores con otro significado. Se ocultan gráficos vacíos y se conserva
  una indicación discreta de disponibilidad.

`issuerResearch` sirve consenso de analistas, objetivos de precio comparables,
estimaciones con rangos y revisiones, EPS publicado frente a consenso y calidad
de caja. Los ETF incorporan referencia, posiciones, rentabilidades totales,
volatilidad y Sharpe. No requiere generación adicional con IA.

El contexto sectorial incorpora datos verificables de una muestra de posiciones
del ETF de referencia cuando corresponde. No se usa un ETF estadounidense para
representar un sector regional extranjero.

## Documentación oficial

- https://eodhd.com/financial-apis/user-api
- https://eodhd.com/financial-apis/api-limits
- https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds
- https://eodhd.com/financial-apis/live-ohlcv-stocks-api
- https://eodhd.com/financial-apis/intraday-historical-data-api
- https://eodhd.com/financial-apis/macroeconomic-data-api
- https://eodhd.com/financial-apis/stock-market-financial-news-api
- https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits
- https://eodhd.com/marketplace/unicornbay/options
