# Personalización del feed

Los cuatro recuadros editables admiten entre uno y siete activos por cuenta. Se pueden añadir con el ticker o elegir entre sugerencias de referencia; la búsqueda también compara sus nombres. Las sugerencias no son recomendaciones de inversión ni una clasificación por rentabilidad.

Los índices incluyen IBEX 35, Euro Stoxx 50, DAX, CAC 40, FTSE 100, Hang Seng, Shanghai Composite, Shenzhen Component y CSI 300, además de las referencias estadounidenses y asiáticas anteriores. Los alias habituales se convierten al identificador de consulta: por ejemplo, `IBEX35` y `IBEX 35` corresponden a `^IBEX`, y `CSI300` a `000300.SS`. ETF y divisas conservan sus instrumentos e identificadores propios.

Con siete activos, elegir uno nuevo inicia una sustitución explícita: se verifica el instrumento, se elige cuál reemplazar y después se guarda la selección. No se elimina otro activo por defecto ni se escribe al pulsar una sugerencia. Se conserva la posición del activo sustituido.

La validación del servidor comprueba símbolo, tipo de instrumento y disponibilidad de una cotización. Guardar vuelve a comprobar cada incorporación y vincula la preferencia al usuario autenticado. Un fallo mantiene la lista anterior. El navegador no puede saltarse el límite ni introducir una acción ordinaria en el recuadro de índices o ETF.

Las preferencias antiguas de hasta doce instrumentos se leen como una vista ordenada de un máximo de siete por grupo. La lectura no reescribe ni elimina preferencias almacenadas. No se modifican listas de seguimiento, informes, noticias ni otras configuraciones; guardar en el editor es una acción explícita.

La búsqueda de sugerencias es local y no consume modelos de IA ni consultas por cada carácter. Las verificaciones de instrumentos coincidentes comparten las cachés existentes y las cotizaciones del feed siguen usando su caché habitual.

## Búsqueda rápida

La lupa «Buscar activo», situada sobre los recuadros del feed, admite nombres y tickers. Presenta coincidencias verificadas con su mercado y tipo de instrumento; elegir una abre la ficha rápida existente con cotización, métricas e histórico, sin generar un informe ni consumir IA. Los informes completos siguen en sus apartados. La búsqueda comparte peticiones y caché, espera a que termine la escritura y cancela resultados antiguos. No convierte una consulta desconocida en un ticker supuesto. Las fichas rápidas usan la paleta neutra del resto de la terminal, conservando los colores financieros y los acentos azules discretos.

## Petróleo al contado

El recuadro de materias primas usa `WTI-SPOT` y `BRENT-SPOT` como identificadores internos de referencias físicas al contado, con los rótulos WTI y BRENT. Las selecciones anteriores `CL=F` y `BZ=F`, y los alias CL/BZ/WTI/BRENT, se convierten únicamente en ese recuadro, conservando el orden de la preferencia. Leer una selección antigua no escribe en la base de datos. Los futuros de otros módulos, informes, gráficos y listas de seguimiento conservan su instrumento original.

Se consultan las series diarias oficiales de la EIA distribuidas por FRED: [WTI en Cushing — DCOILWTICO](https://fred.stlouisfed.org/series/DCOILWTICO) y [Brent Europa — DCOILBRENTEU](https://fred.stlouisfed.org/series/DCOILBRENTEU), ambas en dólares por barril. Son observaciones diarias publicadas con retraso; no son operaciones en vivo ni precios de contratos de futuros. La fecha visible es la fecha observada, sin inventar una hora de negociación. La referencia anterior también conserva su fecha y el porcentaje compara las dos últimas observaciones disponibles, omitiendo los días vacíos sin interpolar.

El adaptador usa la [API oficial de observaciones](https://fred.stlouisfed.org/docs/api/fred/series_observations.html), con la credencial del servidor `Fred` (alternativas `FRED_KEY`/`FRED_API_KEY`), y el CSV público oficial si falta la clave o falla la API. Las consultas se limitan a 45 días y las respuestas a 50 KB; cada serie comparte una petición concurrente y una caché de una hora. Un fallo se conserva durante dos minutos. Una referencia de más de catorce días o sin formato verificable se muestra sin precio disponible: nunca se sustituye por un futuro ni una estimación de IA.

Comprobación real del 11 de noviembre de 2026: ambos CSV devolvieron HTTP 200 y su última observación fue el 3 de noviembre: WTI 99,64 USD/barril y Brent 107,03 USD/barril, frente a 100,06 y 107,39 el 2 de noviembre. Las páginas oficiales identificaron la última actualización de publicación el 4 de noviembre. Estos valores documentan la prueba, no se incorporan como constantes al código.
