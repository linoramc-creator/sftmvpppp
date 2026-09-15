# Paneles de mercado

La aplicación usa `Terminal_Export` como frontend y la función raíz `supabase/functions/analyze-ticker` como backend. El proyecto activo es `zeimhqybhsrmfljrdkwk`. La carpeta Supabase antigua dentro de `Terminal_Export` se conserva por compatibilidad histórica; no es el origen del despliegue.

## Cambios

- Noticias: dos listas independientes de seis artículos para ticker y sector. Se priorizan treinta días y se amplía hasta noventa si faltan noticias relevantes. Se eliminan duplicados, vídeos, promociones y menciones incidentales. Los ETF amplios incluyen noticias de su mercado de referencia. No se inventan noticias para completar el cupo.
- Calendario: por defecto diez próximos eventos y cinco recientes de alto impacto. Permite ampliar a impacto medio y seleccionar EE. UU. sin nuevas consultas.
- Crecimiento de ingresos: barras SVG sin dependencia del dimensionado de Recharts, períodos ordenados, comparación fiscal interanual con tolerancia de calendarios de 52/53 semanas, ceros y ausencias diferenciados. La serie numérica precisa enriquece el histórico sin sustituirlo por una ventana más corta.
- Institucional: recomendaciones y precios objetivo individuales de entidades, con fechas independientes para recomendación y objetivo. Combina historial de revisiones de Yahoo y endpoints de calificaciones/objetivos de FMP; conserva la publicación más reciente por entidad durante doce meses. No convierte posiciones de cartera en opiniones. También disponible en ETF; si no hay cobertura directa se indica sin extrapolar opiniones de sus componentes.
- Bonos: catorce series FRED y ocho ETF estadounidenses, curva con una misma fecha de observación, históricos, tipos reales, inflación implícita, crédito, precios y ficha de ETF. Los precios no incluyen reinversión de distribuciones. No se presenta yield SEC ni duración cuando la fuente no los facilita.
- Negocio: cuatro ejercicios de ingresos por producto y región, resumen breve en español organizado por actividad, clientes y generación de ingresos. El último apartado contiene socios y acuerdos anunciados durante los últimos doce meses; se exige fecha conocida y evidencia textual del acuerdo, sin rumores ni relaciones históricas mencionadas de paso.
- Presentación: se ocultan nombres de proveedores, citas y explicaciones del proceso, también en los informes guardados. Se mantienen fechas, estimaciones, ausencias de datos y nombres de instituciones. Los titulares de noticias permiten abrir el artículo.

## Consultas y créditos

Los paneles se solicitan al abrirlos. Caché en el navegador y por instancia de Edge Function: una hora para bonos/noticias y veinticuatro horas para negocio/institucional. Las consultas simultáneas iguales se agrupan. La caché del servidor es en memoria: un arranque de instancia nueva puede repetir consultas; no es un límite global de gasto.

Institucional realiza tres consultas estructuradas, sin búsquedas web ni llamadas de modelo. Noticias realiza hasta dos búsquedas Tavily básicas por lista cuando faltan artículos. Negocio realiza una o dos búsquedas y una única llamada breve a Gemini 2.5 Flash para redactar el resumen y estructurar los acuerdos; la evidencia se valida contra los documentos recibidos. Bonos conserva FRED y Yahoo. Los informes existentes conservan su generación habitual.

## Validación y publicación

- Frontend: `npm run build`, `npx tsc --noEmit -p tsconfig.app.json`, `npm test` desde `Terminal_Export`.
- Regresiones de datos: `node --test tests/market-panels.test.ts tests/editorial.test.ts` desde la raíz, con Node compatible con TypeScript nativo (22.18 o superior).
- Función: `supabase functions deploy analyze-ticker --project-ref zeimhqybhsrmfljrdkwk --use-api --no-verify-jwt` desde la raíz. Se conserva la configuración JWT de la función existente.
- Vercel publica el frontend al actualizar `main`. La función también queda declarada en `supabase/config.toml` para la integración GitHub de Supabase. Comprobar los dos despliegues después de publicar; no asumir que el éxito de uno demuestra el del otro.

No se añaden tablas, migraciones, secretos ni servicios de pago.
