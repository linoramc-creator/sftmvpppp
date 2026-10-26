# Biblioteca de investigación

La biblioteca conserva el análisis original y una captura estructurada fechada. Guardar, abrir, revisar y exportar no regeneran un informe con IA. El resumen y la explicación son acciones explícitas y sus resultados se reutilizan por contenido, versión y modelo (`PRIMARY_REPORT_MODEL`).

## Archivo y organización

- Cada acción de guardado tiene un UUID de idempotencia. Una nueva versión conserva texto, datos, configuración, fecha y moneda. La versión anterior no se sobrescribe.
- Los informes de `beta_reports` se importan sin modificar ni borrar su registro original. Se identifican como archivos anteriores con cobertura histórica limitada; nunca se reconstruyen con cotizaciones de hoy.
- Tesis, riesgos, invalidación, notas, etiquetas, carpeta y próxima revisión pertenecen al elemento de investigación. Los dossiers indican la fecha de edición de estas notas.
- La papelera es reversible. Los límites de la beta son 100 elementos y 500 versiones por cuenta, incluidos los elementos de la papelera.
- Las comparaciones conservan la selección de hasta seis activos, horizonte, referencias y resultado original completo. Las revisiones conservan hasta 90 estados recientes por versión y las entregas pendientes; este límite no elimina las versiones originales.

## Datos y revisiones

La captura usa los adaptadores existentes, con prioridad de EODHD y las alternativas autorizadas. Incluye fundamentales, resultados y previsiones, cierres ajustados, referencias y noticias verificadas según disponibilidad. Los huecos se identifican; no se completan con números inventados.

`compareResearchSnapshots` compara unidades, moneda y período. Identifica una nueva publicación por separado de una revisión del mismo período. Las rentabilidades desde el informe usan los dos extremos de la misma serie ajustada actual, con sesiones comunes cuando existe referencia. No interpreta volumen negociado como flujo institucional.

La vista Guardado no monta los paneles que consultan el mercado. Actual y Cambios requieren una revisión explícita o la revisión programada activada por el cliente. No se consulta Gemini para calcular estas diferencias.

## Monitor y correo

El seguimiento y el correo están desactivados inicialmente. Se activan por elemento. `next_review` es la fecha personal; `next_check_at` es interna y programa el siguiente chequeo diario. Un trabajo de Supabase cada 15 minutos atiende los elementos vencidos en lotes de cinco, con máximo global de 300 chequeos diarios y bloqueo de concurrencia. Los fallos del proveedor se posponen, sin generar un informe alternativo.

El endpoint `research-monitor` admite únicamente el secreto privado del trabajo de servidor. Reutiliza el transporte de correo del brief cuando está configurado y solo entrega a la dirección de la cuenta activa, con consentimiento por elemento. Las entregas tienen reclamación atómica e idempotencia. Una entrega ambigua se marca `uncertain`, sin reenvío automático. Abrir el informe o marcarlo revisado no produce una nueva generación de IA.

El secreto de cron se obtiene de Vault y nunca se entrega al navegador. Verificación operativa: revisar el trabajo `terminal-research-library` en `cron.job`, las ejecuciones en `cron.job_run_details` y los contadores agregados de `research-monitor` (sin direcciones ni textos privados en logs).

## Exportación y aislamiento

El dossier se genera localmente con HTML de impresión, SVG de los datos archivados y contenido escapado, sin solicitar gráficos a terceros ni ejecutar scripts externos. El usuario elige Guardar como PDF en el diálogo del navegador. La exportación no necesita Gemini; puede incluir el resumen ya creado.

Las tablas están protegidas mediante RLS sin acceso directo para clientes. Las operaciones de servidor vinculan el propietario autenticado, validan tamaños e identificadores y serializan las escrituras. Los textos privados se muestran escapados; el modelo recibe instrucciones separadas de la evidencia y un presupuesto de salida limitado. Las ediciones de notas usan control optimista de revisión para detectar cambios simultáneos.
