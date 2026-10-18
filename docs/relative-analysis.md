# Comparación de activos

La navegación presenta un único apartado **Comparar**. El panel
`marketComparison` reúne comparación, correlación y análisis relativo para entre
dos y seis símbolos distintos. Acepta ventanas `1m`, `3m`, `6m` y `1y`;
`includeAnalysis` es un booleano estricto. La carga inicial solo calcula datos;
**Analizar métricas** añade conclusiones estructuradas y una interpretación
acotada de las evidencias. El modelo no puede modificar los valores, la
clasificación ni las fechas calculadas. La lectura final añade una nota específica para cada activo con historial suficiente y comentarios sobre parejas y riesgos concretos. Cada texto debe referirse al activo y a evidencias exactas; las cifras solo se admiten si figuran en esas evidencias. Los valores calculados permanecen inmutables.

Se conservan los precios por activo, las referencias SPY/URTH, matrices con el
número de observaciones por pareja, correlaciones móviles, caídas, ratios por
pareja, actividad mensual, opciones y declaraciones institucionales. Las
correlaciones requieren al menos veinte retornos comunes y monedas iguales;
la sensibilidad a factores utiliza hasta sesenta y tres retornos con un mínimo
de cuarenta, independientemente del rango general. La bandera mensual
`complete` indica cobertura de datos, nunca que el mes calendario haya cerrado.

Las fichas de índices y ETF del feed usan `marketPulse`: lectura de sesión,
intradía, gap, rango, tendencia y rotación mediante ETF sectoriales. Estos ETF
son referencias de rotación, no amplitud real del índice ni flujos de dinero.
Solo los ETF con datos suficientes incluyen volumen negociado y VWAP aproximado.
Los accesos desde watchlist y resultados conservan la ficha individual.

La bienvenida espera la watchlist sincronizada, cotizaciones, noticias y
portadas del feed. Mantiene el contenido montado detrás del modal para permitir
su carga. Los fallos o un plazo agotado requieren reintento o continuar
explícitamente con lo disponible; no se finge una carga completa.

## Compatibilidad del panel anterior

El panel `relativeComparison` acepta exactamente dos símbolos distintos. Usa el
mismo control de sesión, revocación y cuotas de la terminal. `includeAi` solo
admite un booleano: el cálculo ordinario consume cuota de datos; la lectura con
IA consume cuota de trabajo costoso.

## Fechas, unidades y cálculos

- Histórico diario de hasta un año. Acciones y ETF requieren cierres ajustados;
  índices y futuros permiten niveles publicados. Se omiten sesiones abiertas,
  huecos y observaciones duplicadas, conservando la fecha local del mercado.
- Rentabilidad relativa a veinte y sesenta y tres sesiones comunes, correlación
  diaria, beta, tracking error anualizado y ratio normalizado a cien. Se usan
  únicamente fechas coincidentes, sin rellenar precios ausentes.
- Las tarjetas de cada instrumento conservan su última fecha propia. No se
  declara una ventaja por volatilidad cuando las fechas finales difieren.
- Las comparaciones cruzadas y el ratio se dejan vacíos si las monedas difieren;
  no se realiza una conversión de divisas implícita.
- El importe negociado aproxima volumen por cierre sin afirmar que sea VWAP ni
  capital neto. Solo se calcula para acciones y ETF. Los índices no tienen
  volumen propio y los futuros requieren un multiplicador para dar un nominal.
- Las sensibilidades al mercado, bonos, dólar, petróleo y oro utilizan hasta
  sesenta y tres retornos coincidentes, con al menos cuarenta observaciones.
  Describen correlación histórica, no causalidad ni flujos.

## Posicionamiento y opciones

Las posiciones institucionales son declaraciones trimestrales atrasadas; el
cambio de acciones declaradas no equivale a dinero neto. Un porcentaje de
propiedad aislado no convierte una serie trimestral ausente en datos disponibles.
Los flujos de creación/reembolso de ETF permanecen sin datos mientras no haya una
serie verificada y autorizada.

Las opciones usan un único vencimiento entre siete y cuarenta y cinco días,
preferentemente próximo a treinta. Se descartan otros vencimientos, contratos
duplicados y tamaños no estándar. El volumen observado incluye exclusivamente
contratos con volumen numérico no negativo y operación fechada en la sesión
indicada; se devuelve su cobertura. Los totales estrictos y su ratio no se
reconstruyen con datos ausentes. El interés abierto puede corresponder a otra
actualización; ninguno de estos datos identifica al comprador o a instituciones.

El snapshot de opciones de Massive devolvió `NOT_AUTHORIZED` en la comprobación
del 17/10/2026. Se reutiliza la integración de opciones ya disponible; no se
cambian planes ni se simulan permisos o flujos.

## Coste y memoria

Los cálculos no invocan Gemini. La lectura opcional usa una petición Flash
acotada y noticias ya compartidas por el feed, sin otra búsqueda web. La IA solo
redacta sobre evidencias existentes; no modifica cifras ni gráficos.

La comparación se conserva cinco minutos; la interpretación válida, cuarenta y
cinco minutos, con huella de los datos y noticias utilizados. La caché persistente
comparte únicamente datos públicos de mercado, nunca perfiles o informes
privados. La migración `202610170001_relative_market_cache.sql` conserva RLS y
acceso exclusivo del rol de servicio. La prueba SQL de regresión revierte todas
sus escrituras.


## Seis activos y análisis específico (18 de octubre de 2026)

La validación y el cálculo admiten de dos a seis activos distintos; un séptimo
se rechaza sin recortar la selección. Hasta ocho series incluyen las referencias
SPY y URTH, con colores diferenciados.

La lectura final recibe por activo rentabilidad y riesgo del período, tendencia,
valoración disponible, posiciones fechadas, cobertura de opciones y sensibilidades,
además de noticias compartidas. No recibe históricos completos ni imágenes. Una
única petición a Gemini Flash usa salida JSON con esquema, razonamiento mínimo,
35 segundos de plazo y máximo de 4.200 tokens. Produce notas de entre treinta y
setenta palabras por activo y comparaciones seleccionadas; no modifica las tablas,
no genera órdenes de compra/venta y no presenta volumen como flujo de dinero.

El validador exige identificadores y referencias de evidencia exactos,
longitud acotada y cifras presentes en la evidencia asociada, admitiendo su
redondeo exacto a cero, uno o dos decimales como en las tablas.
El nombre verificado de una empresa o fondo puede aparecer en el texto sin
repetir su ticker, que ya está en el encabezado de la tarjeta. La evidencia de
cada activo conserva también su hallazgo ya formateado; no se sobrescribe al
añadir los datos sin redondear. Conserva un diagnóstico
sin respuestas crudas ni secretos: indisponibilidad, HTTP rechazado, JSON truncado,
respuesta inválida o notas aceptadas/rechazadas. La versión anterior omitía estos
motivos y descartaba incluso horizontes numéricos habituales; no es posible atribuir
una respuesta histórica `enhanced:false` a una causa exacta sin sus registros.
No se reintenta una generación fallida o ambigua. La huella de caché incluye activos,
parejas, cobertura y factores; una interpretación válida dura 45 minutos. Guarda
también las noticias utilizadas en esa edición y consulta la caché antes de
refrescarlas: una actualización del feed no vuelve a facturar la misma selección.
Las notas interpretativas evitan repetir cifras que ya aparecen en sus tarjetas.

Las filas completamente vacías y los apartados no aplicables se omiten. Las
carencias verificadas se agrupan en «Disponibilidad de datos complementarios»,
sin convertirlas en ceros ni en cálculos estimados. La valoración de empresas se
separa de fondos e índices. Los ratios de opciones con cobertura parcial siguen
sin calcularse, aunque se muestran los contratos y volúmenes realmente observados.
El acceso actual a ratios de Massive para AAPL volvió a devolver HTTP 403; no se
han contratado planes ni se simula una fuente alternativa para datos institucionales
que no estén autorizados.
