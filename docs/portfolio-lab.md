# Laboratorio privado de portfolio

La pestaña `PORTFOLIO` es exclusiva de la identidad administrativa ya fijada de `linoramc@gmail.com`. El servidor comprueba la sesión, el acceso activo y esa identidad antes de clasificar la petición o consultar datos. La base de datos repite la autorización en cada operación. Ocultar la pestaña no es la protección principal.

## Funciones

- Hasta tres carteras activas, cincuenta incluidas las archivadas y capital inicial de 100 a 10 millones de USD.
- Acciones y ETF estadounidenses en USD, cuenta de efectivo y posiciones largas. No se conecta con ningún bróker ni se envían operaciones reales.
- Órdenes a mercado, limitadas, stop y stop-limit; vigencia DAY o GTC de noventa días. Premarket y postmarket requieren activación explícita y una orden limitada o stop-limit.
- Reserva de efectivo y de acciones disponibles, ejecuciones parciales limitadas al 1 % del volumen publicado por minuto, comisión fija por orden y deslizamiento configurable. No admite gastar dos veces el saldo reservado ni vender acciones inexistentes.
- Posiciones, resultados realizados y latentes, costes, movimientos de capital, distribución, diario, exportación CSV y curva de patrimonio/rentabilidad frente a SPY. Las aportaciones y retiradas no se presentan como beneficio.
- Archivar conserva el historial y cancela órdenes pendientes; restaurar no vuelve a abrirlas.

## Observaciones y ejecución

Los identificadores, la moneda y el mercado se verifican en los metadatos. Las cotizaciones mantienen fecha real, sesión y retraso; una vela de un minuto no se presenta como una horquilla bid/ask. Las consultas reutilizan el transporte de mercado de la terminal y las cachés de observaciones.

Sólo se usan velas completas cuyo final esté al menos un minuto por detrás de la consulta. Una orden no puede ejecutarse con una vela iniciada antes de registrarla, ni con precios futuros, sin volumen, fuera de su sesión o con datos de más de veinte minutos. Se conservan los huecos de información: no se recrean ejecuciones retrospectivas durante una interrupción del proveedor. Una stop-limit recién activada espera otra vela para no suponer el orden intraminuto de máximo y mínimo.

El calendario contempla los horarios de Nueva York y su cambio de hora, festivos y cierres anticipados. En un cierre anticipado, la sesión extendida termina a las 17:00 ET. El calendario de próximos festivos de Massive complementa las reglas verificadas; el acceso a agregados de minutos de ese proveedor fue rechazado por el plan durante la validación y no se atribuyen a él esos precios. La disponibilidad de mercado no implica una promesa de latencia fija del proveedor.

Los últimos precios observados pueden valorar posiciones durante un cierre con su fecha auténtica. Los valores ausentes no se sustituyen por el coste de compra. El historial empieza al crear la cartera y sólo incorpora observaciones recibidas desde entonces; no es un backtest. SPY se normaliza desde la primera observación válida posterior a la creación y la comparación usa un período común. Los desdoblamientos verificados conservan el coste económico. Un evento ex-dividendo sin fechas verificadas de derecho/pago no genera efectivo; no se simulan impuestos, margen ni préstamos de acciones.

## Persistencia y trabajos de fondo

`beta_paper_portfolios` tiene RLS y no concede acceso directo a los roles del navegador ni al servicio. Sólo el servicio puede llamar a `beta_portfolio_store`; ese RPC también verifica propietario, admin vigente, tamaño, cuotas, creación idempotente y versión de escritura.

Las modificaciones usan UUID de petición y compare-and-swap. Un conflicto vuelve a leer el estado y recalcula el reloj de aplicación, conservando las fechas de las observaciones. Reintentar una orden o aportación no duplica el movimiento. El selector descarga únicamente metadatos, no todos los historiales archivados.

`portfolio-worker` sólo acepta el secreto existente de los trabajos del servidor. El cron privado lo invoca cada minuto durante el horario ampliado y el margen de recepción posterior; no hace consultas de mercado si no hay posiciones ni órdenes pendientes. Evalúa órdenes cada minuto y actualiza carteras sólo con posiciones cada cinco minutos. Puede operar con la pestaña cerrada, sujeto a la disponibilidad de cron, funciones y datos. No ejecuta Gemini ni envía correos.

## Referencias funcionales

- [Investing.com: posiciones, transacciones y exportación](https://www.investing-support.com/hc/en-us/articles/360000249657-How-to-Download-Your-Portfolio-from-Investing-com).
- [TradingView: ticket, posiciones y órdenes simuladas](https://www.tradingview.com/support/solutions/43000516466-paper-trading-main-functionality/).
- [IBKR: elegibilidad de órdenes fuera de sesión regular](https://www.interactivebrokers.com/campus/trading-lessons/trading-outside-regular-trading-hours-rth/).
- [NYSE: calendario y cierres oficiales](https://www.nyse.com/markets/hours-calendars).
