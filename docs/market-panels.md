# Paneles de mercado

La aplicación usa `Terminal_Export` como frontend y la función raíz `supabase/functions/analyze-ticker` como backend. El proyecto activo es `zeimhqybhsrmfljrdkwk`. La carpeta Supabase antigua dentro de `Terminal_Export` se conserva por compatibilidad histórica; no es el origen del despliegue.

## Cambios

- Noticias de acciones, ETF y sectores: hasta cinco artículos, últimos catorce días, relación con el activo, fuentes financieras seleccionadas, sin duplicados ni listas promocionales. La ausencia de noticias válidas se muestra explícitamente.
- Calendario: por defecto diez próximos eventos y cinco recientes de alto impacto. Permite ampliar a impacto medio y seleccionar EE. UU. sin nuevas consultas.
- Crecimiento de ingresos: períodos ordenados por fecha, comparación fiscal interanual con tolerancia de calendarios de 52/53 semanas, ceros y ausencias diferenciados, sin interpolar huecos.
- Institucional: Yahoo Finance, FMP y documentos públicos; fecha de posición y fuente por fila. No se suman gestoras y fondos porque pueden solaparse. El análisis e insiders previo permanece accesible.
- Bonos: catorce series FRED y ocho ETF estadounidenses, curva con una misma fecha de observación, históricos, tipos reales, inflación implícita, crédito, precios y ficha de ETF. Los precios no incluyen reinversión de distribuciones. No se presenta yield SEC ni duración cuando la fuente no los facilita.
- Negocio: cuatro ejercicios de ingresos por producto y región con FMP, perfil de Yahoo y canales respaldados por extractos. Los documentos SEC se filtran por emisor y año; las dimensiones no se suman entre sí. La cobertura depende de lo publicado y del acceso del proveedor.

## Consultas y créditos

Los paneles se solicitan al abrirlos y no añaden llamadas a Gemini. Caché en el navegador y por instancia de Edge Function: una hora para bonos/noticias y veinticuatro horas para negocio/institucional. Las consultas simultáneas iguales se agrupan. FMP institucional comparte caché con el informe original. La caché del servidor es en memoria: un arranque de instancia nueva puede repetir consultas; no es un límite global de gasto.

Bonos usa FRED y Yahoo; los otros paneles realizan como máximo una búsqueda Tavily básica por consulta no almacenada, además de las fuentes estructuradas. Los informes existentes conservan su generación con Gemini y sus proveedores.

## Validación y publicación

- Frontend: `npm run build`, `npx tsc --noEmit -p tsconfig.app.json`, `npm test` desde `Terminal_Export`.
- Regresiones de datos: `node --test tests/market-panels.test.ts` desde la raíz, con Node compatible con TypeScript nativo (22.18 o superior).
- Función: `supabase functions deploy analyze-ticker --project-ref zeimhqybhsrmfljrdkwk --use-api --no-verify-jwt` desde la raíz. Se conserva la configuración JWT de la función existente.
- Vercel publica el frontend al actualizar `main`. La función también queda declarada en `supabase/config.toml` para la integración GitHub de Supabase. Comprobar los dos despliegues después de publicar; no asumir que el éxito de uno demuestra el del otro.

No se añaden tablas, migraciones, secretos ni servicios de pago.
