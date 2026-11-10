# Personalización del feed

Los cuatro recuadros editables admiten entre uno y siete activos por cuenta. Se pueden añadir con el ticker o elegir entre sugerencias de referencia; la búsqueda también compara sus nombres. Las sugerencias no son recomendaciones de inversión ni una clasificación por rentabilidad.

Los índices incluyen IBEX 35, Euro Stoxx 50, DAX, CAC 40, FTSE 100, Hang Seng, Shanghai Composite, Shenzhen Component y CSI 300, además de las referencias estadounidenses y asiáticas anteriores. Los alias habituales se convierten al identificador de consulta: por ejemplo, `IBEX35` y `IBEX 35` corresponden a `^IBEX`, y `CSI300` a `000300.SS`. ETF y divisas conservan sus instrumentos e identificadores propios.

Con siete activos, elegir uno nuevo inicia una sustitución explícita: se verifica el instrumento, se elige cuál reemplazar y después se guarda la selección. No se elimina otro activo por defecto ni se escribe al pulsar una sugerencia. Se conserva la posición del activo sustituido.

La validación del servidor comprueba símbolo, tipo de instrumento y disponibilidad de una cotización. Guardar vuelve a comprobar cada incorporación y vincula la preferencia al usuario autenticado. Un fallo mantiene la lista anterior. El navegador no puede saltarse el límite ni introducir una acción ordinaria en el recuadro de índices o ETF.

Las preferencias antiguas de hasta doce instrumentos se leen como una vista ordenada de un máximo de siete por grupo. La lectura no reescribe ni elimina preferencias almacenadas. No se modifican listas de seguimiento, informes, noticias ni otras configuraciones; guardar en el editor es una acción explícita.

La búsqueda de sugerencias es local y no consume modelos de IA ni consultas por cada carácter. Las verificaciones de instrumentos coincidentes comparten las cachés existentes y las cotizaciones del feed siguen usando su caché habitual.
