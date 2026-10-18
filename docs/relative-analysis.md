# Comparación de activos

La navegación presenta un único apartado **Comparar**. El panel
`marketComparison` reúne comparación, correlación y análisis relativo para entre
dos y cinco símbolos distintos. Acepta ventanas `1m`, `3m`, `6m` y `1y`;
`includeAnalysis` es un booleano estricto. La carga inicial solo calcula datos;
**Analizar métricas** añade conclusiones estructuradas y una interpretación
acotada de las evidencias. El modelo no puede modificar los valores, la
clasificación ni las fechas calculadas. Los comentarios tienen un máximo de
treinta y cinco palabras y no pueden introducir cifras.

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
