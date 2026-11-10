# Laboratorio privado de portfolio

La pestaña `PORTFOLIO` es exclusiva de la identidad administrativa ya fijada de `linoramc@gmail.com`. El servidor comprueba la sesión, el acceso activo y esa identidad antes de clasificar la petición o consultar datos. La base de datos repite la autorización en cada operación. Ocultar la pestaña no es la protección principal.

## Funciones

- Hasta tres carteras activas, cincuenta incluidas las archivadas y capital inicial de 100 a 10 millones de USD.
- Acciones y ETF estadounidenses en USD, posiciones largas y cortas simuladas. Comprar y vender reducen o abren posiciones largas; abrir corto y cubrir son operaciones explícitas. No se conecta con ningún bróker ni se envían operaciones reales.
- Órdenes a mercado, limitadas, stop y stop-limit; vigencia DAY o GTC de noventa días. Premarket y postmarket requieren activación explícita y una orden limitada o stop-limit.
- Reserva de efectivo y de unidades disponibles, ejecuciones parciales limitadas al 1 % del volumen publicado por minuto, comisión fija por orden y deslizamiento configurable. Vender exige unidades largas; cubrir exige unidades cortas. No se cambia de dirección automáticamente con una venta sobredimensionada.
- Posiciones, resultados realizados y latentes, costes, movimientos de capital, distribución, diario, exportación CSV y curva de patrimonio/rentabilidad frente a SPY. Las aportaciones y retiradas no se presentan como beneficio.
- Archivar conserva el historial y cancela órdenes pendientes; restaurar no vuelve a abrirlas.
- Renombrar solo cambia los metadatos de la cartera: conserva capital, posiciones, órdenes, operaciones, rentabilidad y fechas de origen. La misma petición no vuelve a aplicar un nombre anterior tras otro renombrado posterior.

## Riesgo y posiciones cortas

Los cortos usan un colateral inicial del 150 % y mantenimiento del 130 % del pasivo marcado, manteniendo restringidos los ingresos de la venta corta. Son parámetros explícitos de esta simulación y no una reproducción de las condiciones de un bróker o de sus requisitos por acción. La apertura exige un precio verificado de al menos 5 USD. No se certifica disponibilidad de préstamo ni se incorporan sus intereses o comisiones. No se practica liquidación automática.

Un déficit de margen bloquea nuevas aperturas y retiradas; permite aportar capital y reducir la exposición. Cubrir un corto con pérdidas o un dividendo verificado a cargo de un corto puede dejar una deuda de efectivo negativa, que permanece visible: no se elimina ni se convierte en cero. Las posiciones cortas y su coste mantienen signo negativo; la cantidad de cada orden es positiva.

La consulta de riesgo es independiente de la ejecución: no introduce snapshots ni modifica la contabilidad. Sharpe de la cartera usa retornos aritméticos diarios de su factor de rentabilidad ponderada en el tiempo, sobre las últimas valoraciones realmente observadas después del cierre regular de sesiones completas y consecutivas. Cada fila conserva `at`, el reloj del servidor, y `valuationAt`, la fecha más antigua de las cotizaciones usadas entre todas las posiciones; una cartera solo de efectivo utiliza su fecha de observación. Se exige que esa fecha de mercado pertenezca a la sesión y alcance su cierre. Un precio del jueves transportado a una valoración del viernes no crea un cierre del viernes; las filas históricas sin esta trazabilidad se excluyen.

Exige al menos 21 cierres para formar 20 retornos; no anualiza veinte minutos como si fueran veinte días, interpola huecos ni reconstruye rendimientos anteriores a la creación. La desviación es muestral y la anualización usa 252 sesiones. El tipo libre de riesgo se supone explícitamente del **0 % anual**; Sharpe queda sin calcular cuando no hay muestra suficiente o su desviación es cero.

Para cada activo mantenido con identidad verificada se calcula volatilidad de 20 retornos logarítmicos diarios y Sharpe de los retornos aritméticos de la misma ventana. La curva móvil conserva hasta seis meses de observaciones, sus fechas auténticas y el tipo de ajuste. Se prioriza el cierre ajustado de EODHD; ante ausencia o huecos se intenta el agregado diario de Massive, ajustado por desdoblamientos, y después el cierre ajustado de Yahoo. Cada historia usa una sola fuente. El ajuste exclusivo por desdoblamientos no se presenta como si incorporara dividendos. No se usa Gemini para estos cálculos. Una cartera archivada conserva su fecha de corte también al consultar el riesgo.

## Observaciones y ejecución

Los identificadores, la moneda y el mercado se verifican en los metadatos. Las cotizaciones mantienen fecha real, sesión y retraso; una vela de un minuto no se presenta como una horquilla bid/ask. Las consultas reutilizan el transporte de mercado de la terminal y las cachés de observaciones.

Sólo se usan velas completas cuyo final esté al menos un minuto por detrás de la consulta. Una orden no puede ejecutarse con una vela iniciada antes de registrarla, ni con precios futuros, sin volumen, fuera de su sesión o con datos de más de veinte minutos. Se conservan los huecos de información: no se recrean ejecuciones retrospectivas durante una interrupción del proveedor. Una stop-limit recién activada espera otra vela para no suponer el orden intraminuto de máximo y mínimo.

El calendario contempla los horarios de Nueva York y su cambio de hora, festivos y cierres anticipados. En un cierre anticipado, la sesión extendida termina a las 17:00 ET. El calendario de próximos festivos de Massive complementa las reglas verificadas; el acceso a agregados de minutos de ese proveedor fue rechazado por el plan durante la validación y no se atribuyen a él esos precios. La disponibilidad de mercado no implica una promesa de latencia fija del proveedor.

Los últimos precios observados pueden valorar posiciones durante un cierre con su fecha auténtica. Los valores ausentes no se sustituyen por el coste de compra. El historial empieza al crear la cartera y sólo incorpora observaciones recibidas desde entonces; no es un backtest. SPY se normaliza desde la primera observación válida posterior a la creación y la comparación usa un período común. Los desdoblamientos verificados conservan el coste económico. Un evento ex-dividendo sin fechas verificadas de derecho/pago no genera efectivo; no se simulan impuestos ni préstamos reales de acciones.

## Persistencia y trabajos de fondo

`beta_paper_portfolios` tiene RLS y no concede acceso directo a los roles del navegador ni al servicio. Sólo el servicio puede llamar a `beta_portfolio_store`; ese RPC también verifica propietario, admin vigente, tamaño, cuotas, creación idempotente y versión de escritura.

Las modificaciones usan UUID de petición y compare-and-swap. Un conflicto vuelve a leer el estado y recalcula el reloj de aplicación, conservando las fechas de las observaciones. Reintentar una orden o aportación no duplica el movimiento. El selector descarga únicamente metadatos, no todos los historiales archivados.

`portfolio-worker` sólo acepta el secreto existente de los trabajos del servidor. El cron privado lo invoca cada minuto durante el horario ampliado y el margen de recepción posterior; no hace consultas de mercado si no hay posiciones ni órdenes pendientes. Evalúa órdenes cada minuto y actualiza carteras sólo con posiciones cada cinco minutos. Puede operar con la pestaña cerrada, sujeto a la disponibilidad de cron, funciones y datos. No ejecuta Gemini ni envía correos.

La interfaz consulta la cartera y su riesgo cada cinco minutos mientras está visible. Una lectura de snapshot reciente reutiliza precios persistidos y evita proveedores y escrituras: cinco minutos sin órdenes abiertas, un minuto con órdenes. El trabajo de ejecución continúa cada minuto aunque la interfaz no consulte. Las series históricas públicas comparten caché de cinco minutos y solicitudes simultáneas; los fallos esperan treinta segundos antes de reintentar. Solo se consultan hasta veinte activos mantenidos y verificados, con cuatro solicitudes como máximo en paralelo. No se cachean balances ni otros datos privados entre carteras.

## Referencias funcionales

- [Investing.com: posiciones, transacciones y exportación](https://www.investing-support.com/hc/en-us/articles/360000249657-How-to-Download-Your-Portfolio-from-Investing-com).
- [TradingView: ticket, posiciones y órdenes simuladas](https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/).
- [IBKR: elegibilidad de órdenes fuera de sesión regular](https://www.interactivebrokers.com/campus/trading-lessons/trading-outside-regular-trading-hours-rth/).
- [NYSE: calendario y cierres oficiales](https://www.nyse.com/markets/hours-calendars).
- [Reserva Federal: suplemento de requisitos de margen](https://www.federalreserve.gov/frrs/regulations/section-22012-supplement-margin-requirements.htm). Referencia de contexto; la simulación no replica las reglas completas ni los requisitos específicos de un intermediario.
