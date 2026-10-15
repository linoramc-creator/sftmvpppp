# Ficha de seguimiento · 15 de octubre de 2026

La ficha compartida por watchlist y resultados empresariales usa una cabecera
compacta gris y azul, tipografía Inter y precios tabulares. Actividad, cotización
regular y sesiones extendidas tienen espacios diferenciados; las fechas de
premarket y postmarket se mantienen explícitas, aunque correspondan a días distintos.

El gráfico de velas conserva los intervalos de una hora, cuatro horas, diario
y semanal. Añade zoom anclado a la rueda, desplazamiento por arrastre, controles
para restablecer o volver a las últimas velas y pantalla ampliada con Escape.
El cursor es una cruceta fina que desaparece al salir o perder foco. No existe
una columna de fondo por vela. Teclado: flechas, Inicio/Fin, más/menos y Escape.
Los precios OHLC y volúmenes se conservan sin interpolación.

Se elige una serie completa entre las disponibles según su última observación;
una fuente detenida en el día anterior no desplaza una serie más reciente. No
se mezclan velas con distintos anclajes de sesión. El porcentaje de cotización
usa el cierre diario de la sesión anterior en la zona del mercado, en lugar
del cierre inicial de un gráfico mensual. Si falta esa referencia, queda ausente.

Riesgo y comparación cargan en paralelo con la ficha. La comparación reutiliza
datos durante cinco minutos por cuenta, activo y referencia, con un máximo
de treinta entradas. Los paneles ocultos no inician consultas nuevas.
Estas interacciones no requieren llamadas adicionales de IA.

El feed retira trigo y AUD/USD y conserva siete filas en cada recuadro.

Verificación: 84 pruebas de backend, 37 de interfaz, TypeScript y Deno; prueba
visual de escritorio y móvil con una ficha real, zoom, cursor y pantalla ampliada.
