# Biblioteca de investigación

La biblioteca conserva el análisis original y una captura estructurada fechada. Guardar, abrir y exportar no regeneran un informe. «Evaluar informe» y el resumen son acciones explícitas; sus resultados se reutilizan por contenido, versión, receta y modelo (`PRIMARY_REPORT_MODEL`).

## Archivo y organización

- Cada acción de guardado tiene un UUID de idempotencia. Una nueva versión conserva texto, datos, configuración, fecha y moneda. La versión anterior no se sobrescribe.
- Los informes de `beta_reports` se importan sin modificar ni borrar su registro original. Se identifican como archivos anteriores con cobertura histórica limitada; nunca se reconstruyen con cotizaciones de hoy.
- Tesis, riesgos, invalidación, notas, etiquetas, carpeta y próxima revisión pertenecen al elemento de investigación. Los dossiers indican la fecha de edición de estas notas.
- La papelera es reversible. Los límites de la beta son 100 elementos y 500 versiones por cuenta, incluidos los elementos de la papelera.
- Las comparaciones conservan la selección de hasta seis activos, horizonte, referencias y resultado original completo. Las revisiones conservan hasta 90 estados recientes por versión y las entregas pendientes; este límite no elimina las versiones originales.

## Datos y revisiones

La captura usa los adaptadores existentes, con prioridad de EODHD y las alternativas autorizadas. Incluye fundamentales, resultados y previsiones, cierres ajustados, referencias y noticias verificadas según disponibilidad. Los huecos se identifican; no se completan con números inventados.

`compareResearchSnapshots` compara unidades, moneda y período. Identifica una nueva publicación por separado de una revisión del mismo período. Las rentabilidades desde el informe usan los dos extremos de la misma serie ajustada actual, con sesiones comunes cuando existe referencia. No interpreta volumen negociado como flujo institucional.

La interfaz ofrece Informe, Lectura estratégica y Organización y tesis. No muestra el comparador de informes ni las antiguas vistas Actual y Cambios. El apartado de comparación de activos de la terminal y sus archivos guardados se conservan. El motor matemático de diferencias continúa disponible internamente para el seguimiento voluntario.

## Evaluación y resumen

«Evaluar informe» reclama una tarea privada antes de consultar datos actuales o el modelo. La evaluación se guarda en `beta_research_assessments`, separada del contenido original, con su fecha y versión. La misma evaluación se reutiliza durante 24 horas; abrirla no vuelve a consumir el modelo. La lectura presenta ventajas competitivas sustentadas, fortalezas y debilidades, riesgos, variables a vigilar y noticias relevantes. Una hipótesis del texto original no se convierte en un hecho verificado ni en una ventaja estructural por sí sola.

El modelo selecciona IDs de un catálogo acotado de evidencias. El servidor recupera cifras, unidades, moneda, período, títulos, fechas y enlaces; descarta referencias desconocidas y cifras inventadas. El catálogo distribuye el espacio entre los emisores en investigaciones de varios activos. La respuesta conserva cobertura parcial cuando la evidencia no permite conclusiones completas.

El resumen `summary-v2` usa exclusivamente el archivo seleccionado: Lectura ejecutiva, Métricas clave, Riesgos, Catalizadores y Seguimiento. No consulta cotizaciones actuales para resumir un informe antiguo. Los resúmenes anteriores permanecen en la base y pueden renovarse desde «Mejorar resumen». Ambas acciones usan una sola llamada estructurada con salida limitada; no hay reintentos de pago automáticos.

## Monitor y correo

El seguimiento y el correo están desactivados inicialmente. Se activan por elemento. `next_review` es la fecha personal; `next_check_at` es interna y programa el siguiente chequeo diario. Un trabajo de Supabase cada 15 minutos atiende los elementos vencidos en lotes de cinco, con máximo global de 300 chequeos diarios y bloqueo de concurrencia. Los fallos del proveedor se posponen, sin generar un informe alternativo.

El endpoint `research-monitor` admite únicamente el secreto privado del trabajo de servidor. Reutiliza el transporte de correo del brief cuando está configurado y solo entrega a la dirección de la cuenta activa, con consentimiento por elemento. Las entregas tienen reclamación atómica e idempotencia. Una entrega ambigua se marca `uncertain`, sin reenvío automático. Abrir el informe o marcarlo revisado no produce una nueva generación de IA.

El secreto de cron se obtiene de Vault y nunca se entrega al navegador. Verificación operativa: revisar el trabajo `terminal-research-library` en `cron.job`, las ejecuciones en `cron.job_run_details` y los contadores agregados de `research-monitor` (sin direcciones ni textos privados en logs).

## Exportación y aislamiento

El dossier se genera localmente con HTML de impresión, SVG de los datos archivados y contenido escapado, sin solicitar gráficos a terceros ni ejecutar scripts externos. El usuario elige Guardar como PDF en el diálogo del navegador. La exportación no necesita Gemini; puede incluir el resumen y la lectura estratégica ya creados. La evaluación se presenta en una sección independiente, con su propia fecha, y solo si corresponde a la versión exportada.

Las tablas están protegidas mediante RLS sin acceso directo para clientes. Las operaciones de servidor vinculan el propietario autenticado, validan tamaños e identificadores y serializan las escrituras. Los textos privados se muestran escapados; el modelo recibe instrucciones separadas de la evidencia y un presupuesto de salida limitado. Las ediciones de notas usan control optimista de revisión para detectar cambios simultáneos.
