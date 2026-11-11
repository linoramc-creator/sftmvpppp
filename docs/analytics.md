# Analytics

Analytics interpreta una petición en una definición JSON versionada y ejecuta exclusivamente métricas y operaciones del catálogo del servidor. No admite expresiones, SQL, código ni direcciones de proveedor generados por el modelo. La autenticación, revocaciones, cuotas y reservas de trabajo son las mismas de la terminal.

## Uso

- «Compara Microsoft y el S&P 500 los últimos dos años»: precios de cierre en base 100 sobre la primera sesión común, sin reinversión de dividendos.
- «Grafica el crecimiento trimestral de ingresos de las Big 7»: siete emisores, una sola clase de Alphabet; trimestres publicados y crecimientos compatibles.
- «Evolución del CapEx en IA de las Big 7 durante dos años»: se conserva la petición y su limitación. El botón de alternativa calcula CapEx total por separado; no se etiqueta como inversión en IA.

Los parámetros quedan visibles y editables: activos, métrica, operación, fechas, frecuencia, moneda y representación. La petición natural se interpreta una vez; actualizar una definición guardada o cambiar el gráfico y los colores no llama al modelo. Una modificación pendiente no cambia silenciosamente el gráfico calculado ni sus descargas. Se pueden guardar hasta cien consultas activas por cuenta, con revisión para detectar conflictos y clave idempotente para no duplicar un guardado reintentado.

## Datos y cálculos

Se reutiliza EODHD como primera opción y los transportes existentes de cotizaciones y estados financieros. EDGAR aporta una alternativa pública para emisores con CIK verificado, incluidas las Big 7; no presupone cobertura universal. Massive se comprobó como fuente adicional: los estados financieros consultados devolvieron 403 con el plan actual y no se presentan como cobertura disponible.

La tabla conserva fechas fiscales reales, estado de observación, moneda, fecha de publicación cuando existe y fuente. Los flujos trimestrales requieren duración independiente de tres meses; los acumulados se separan únicamente con bases fiscales compatibles. Los ratios exigen igual emisor, fecha, duración y moneda. Un denominador ausente o cero no produce un ratio. No se rellenan ausencias con cero ni se arrastran precios de otro día. Los periodos de emisores distintos no se renombran como un mismo trimestre natural.

Las conversiones de precios requieren cambio observado en cada fecha; la conversión de flujos fiscales no se aproxima usando un cambio de cierre si falta el promedio verificable del periodo. Se muestran limitaciones y alternativas explícitas. El ajuste de precios por splits no se confunde con rentabilidad total ni con cierres ajustados por dividendos. Las previsiones quedan fuera del catálogo inicial.

## Portfolio y Seguimiento

La exposición de Analytics lee el estado, las marcas y la moneda del simulador existente, con sus mismos permisos privados. No crea carteras, actualiza valoraciones ni ejecuta órdenes. Se muestra la fecha de valoración y se mantienen como desconocidos los pesos que no pueden calcularse. Sin selección explícita, se usa la cartera activa modificada más recientemente y se identifica en metodología. Se conserva el signo de posiciones cortas.

Seguimiento se encuentra dentro de Portfolio: noticias de posiciones, noticias de la lista de seguimiento, próximos eventos y cambios desde la visita anterior. Reutiliza recopilación programada, evidencia, exposiciones y estados de lectura. Las alertas de oportunidades se retiran: se pausan las existentes, se bloquea su activación en la base de datos y la API devuelve 410 al crear o reanudar. No se borran las noticias ni los recibos de lectura históricos.

## Exportación y seguridad

El gráfico derivado puede descargarse en SVG o PNG con la firma pequeña «MensorTerminal» abajo a la derecha, fuentes, fechas y definición. La definición JSON permite reproducir el análisis. La tabla CSV mantiene valores ausentes como celdas vacías y conserva metadatos. Solo se habilita cuando todas las fuentes usadas permiten esa exportación: datos propios del portfolio y publicaciones públicas de EDGAR, o derechos de proveedor acreditados en el servidor. La variable opcional `ANALYTICS_DATA_EXPORT_ALLOWED=1` debe activarse únicamente si la licencia contratada lo permite; no cambia la cobertura del proveedor. No es necesaria para usar Analytics ni descargar gráficos.

Las tablas nuevas no tienen acceso directo desde el navegador: RLS y revocación de permisos, RPC restringida al servicio, filtro por propietario, comprobación de cuenta activa, límites y control de revisiones. El cliente solo guarda definiciones; no puede subir resultados como si fueran evidencia. Al eliminar se borra el contenido de la definición y se conserva un recibo compacto de reintento con un límite de quinientos recibos por usuario; los de más de treinta días se purgan al guardar o eliminar; las consultas activas siguen limitadas a cien. Los secretos permanecen en el servidor. La caché de datos de mercado se comparte por activo; la lectura de cartera es específica del usuario autenticado.

## Activación

Aplicar `202611110002_analytics.sql` y `202611110003_analytics_retention.sql`, publicar `analyze-ticker` y desplegar la interfaz. No requiere nuevas credenciales para los proveedores ya configurados. Comprobar los tres ejemplos y permisos cruzados; donde no exista cobertura, debe aparecer un resultado parcial o no disponible con su motivo. Las operaciones y tareas del simulador conservan su frecuencia y comportamiento.
