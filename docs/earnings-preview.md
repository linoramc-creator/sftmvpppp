# Previa de resultados desde el feed

Al abrir una empresa en «Resultados · Próximos 7 días», la ficha incorpora una
previa encima de las velas. La selección conserva el ticker y la fecha del evento.
La selección normal de la watchlist conserva su comportamiento anterior.

`panel: earningsPreview` es una consulta autenticada de datos, con los límites de
uso existentes. Prioriza los fundamentales v1.1 y el calendario por símbolo de
EODHD; las fuentes secundarias existentes solo completan campos ausentes. La
fecha recibida del navegador es una pista y nunca sustituye una publicación
verificada. La caché de diez minutos depende del símbolo y del día de Madrid,
sin claves arbitrarias por fecha enviada por el cliente. No se llama a Gemini.

La respuesta separa fecha prevista de publicación, trimestre fiscal, consenso de
BPA e ingresos, rango de estimaciones, cobertura de analistas, comparación
interanual y revisiones de 30/90 días. El historial conserva hasta ocho
publicaciones, con su estimación previa, BPA publicado, sorpresa e ingresos
publicados cuando constan. La tabla muestra inicialmente las cuatro últimas.

Se usan períodos y monedas compatibles; un dato anual no reemplaza al
trimestral. Cero y valores negativos son datos válidos. La sorpresa se calcula
frente al valor absoluto de la estimación y queda ausente si su base es cero.
Las partidas extraordinarias pueden afectar al BPA: no se presenta la sorpresa
como una medida del resultado recurrente ni una predicción de rentabilidad.
Los datos no disponibles se identifican, sin generar estimaciones inventadas.

Documentación de campos y versiones:
[Fundamentales v1.1](https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds)
y [calendario y estimaciones](https://eodhd.com/financial-apis/calendar-upcoming-earnings-ipos-and-splits).
