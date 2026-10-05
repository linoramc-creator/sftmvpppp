# Revisión de producto, arquitectura y rendimiento — 5 de octubre de 2026

## Valoración
La terminal tiene una base útil para investigación: acciones, ETF, sectores, bonos, noticias, comparación, correlaciones e informes privados. La siguiente mejora de calidad debe centrarse en coherencia de datos, continuidad entre sesiones y fiabilidad operativa. Añadir indicadores sin resolver estos puntos aumentaría la complejidad más que la utilidad.

La revisión cubre la arquitectura React/Vite, generación y almacenamiento de informes, fuentes de datos, feed, paneles financieros, autenticación, cachés, migraciones y pruebas. No es un estudio con usuarios, un pentest independiente ni un benchmark de concurrencia. Las prioridades son juicios de ingeniería basados en el código, no una promesa comercial.

## Cambios ejecutados
- Massive `/v2/reference/news` como fuente adicional del feed, paneles de noticias e información de contexto para informes de tickers, ETF y sectores. Verificado por MCP y por REST con HTTP 200. La credencial se almacena exclusivamente en secretos de Supabase.
- Límite de 50 noticias por ticker y 100 generales, una página por consulta; tiempo máximo 5 segundos. Caché local de 15 minutos, agrupación de peticiones concurrentes y recuperación tras fallos. No se contrata un plan nuevo.
- En sectores, el endpoint no ofrece un filtro sectorial nativo: se filtran noticias generales por tema y palabras clave, con equivalencias en español para sectores comunes. Se conservan las otras fuentes para completar la cobertura. No se garantiza cobertura de todos los sectores ni que una noticia de Massive aparezca si no supera los filtros.
- Se usa la foto del artículo, nunca el logo editorial. Se mantienen filtros contra duplicados, noticias promocionales y menciones irrelevantes. El sentimiento suministrado por el proveedor no se convierte en una recomendación de compra.
- Feed dividido en cotizaciones/calendario y noticias: las fotografías ya no bloquean los recuadros de mercado. La watchlist puede aparecer mientras llegan las otras tarjetas.
- Caché compartida del feed en una tabla con RLS y sin permisos para usuarios. Contiene únicamente datos públicos; cada petición sigue exigiendo autenticación y cuota. Vigencia de cinco minutos; si existe un resultado de menos de quince minutos, puede mostrarse mientras se actualiza en segundo plano. La fecha original permanece visible. Los informes privados no se comparten.
- Los paneles reaprovechan resultados en memoria al volver a una pestaña y renuevan al recuperar visibilidad. El botón de reintento invalida la caché local correspondiente.
- El reloj ya no provoca un renderizado de toda la terminal cada segundo. Cotizaciones periódicas suspendidas cuando la pestaña está oculta.
- Comparación y exportación PDF descargadas al utilizarlas. El módulo principal de terminal pasó aproximadamente de 609,68 a 590,21 kB sin comprimir; los módulos separados siguen existiendo y se descargan cuando hacen falta.

## Mediciones y validación
Prueba con cuenta temporal desde este equipo contra producción, posteriormente eliminada. No representa un percentil p95 ni la experiencia de todos los dispositivos; red, proveedores, caché e instancias pueden variar.

| Consulta | Tiempo observado |
|---|---:|
| Feed anterior, primera llamada | 13,209 s |
| Feed anterior, segunda llamada | 12,807 s |
| Nuevo bloque de mercado, primera ronda | 1,279 s |
| Nuevo bloque de noticias, primera ronda | 1,175 s |
| Mercado repetido, caché disponible | 0,373 s |
| Noticias repetidas, caché disponible | 0,499 s |

Los dos nuevos bloques se solicitan en paralelo en la interfaz. Estas cifras son tiempos de API, no de pintura de pantalla. No se ha demostrado una reducción equivalente en la generación completa de informes con IA: sigue dependiendo de las fuentes y del modelo.

Validación: 28 pruebas de servidor, 10 de interfaz, TypeScript y compilación. Las 19 verificaciones de acceso en producción incluyen aislamiento de informes, administración denegada a usuarios normales, revocación y acceso directo bloqueado a la nueva tabla. Se corrigieron selectores de pruebas de autenticación que aún esperaban el antiguo texto del botón.

## Mejoras priorizadas

| Prioridad | Mejora | Utilidad concreta | Esfuerzo orientativo |
|---|---|---|---|
| 1 | Watchlists en la cuenta y alertas dentro de la terminal | Recuperar activos en cualquier dispositivo; detectar resultados próximos, noticias relevantes o cambios de precio elegidos por el usuario | Medio |
| 1 | Estado de calidad y fecha de cada conjunto de datos | Distinguir dato actual, retrasado, estimación y ausencia real; evitar interpretar datos faltantes como ceros | Medio |
| 1 | Registro de errores, latencias y coste por operación | Identificar fallos antes de que los comunique un tester; medir p50/p95, caché y consumo de IA sin registrar secretos | Medio |
| 2 | Historial de cambios entre informes de un activo | Mostrar qué cambió en ingresos, márgenes, riesgos y catalizadores; reutilizar información previa para no regenerar todo | Medio-alto |
| 2 | Comparador ETF orientado a decisiones | Solapamiento de posiciones, concentración, coste, divisa, cobertura y distancia frente al índice; más útil que añadir ratios sin contexto | Medio-alto; sujeto a datos/licencia |
| 2 | Filtros de búsqueda de activos | Buscar por crecimiento, margen, deuda, valoración y liquidez; guardar filtros personales | Alto; requiere universo y datos consistentes |
| 2 | Panel inicial personalizable | Elegir y ordenar tarjetas, densidad visual, activos y temas; conservar preferencias por cuenta | Medio |
| 3 | Cartera manual con exposición agregada | Identificar concentración por sector, país, divisa y factores; comenzar sin conectar brokers | Alto |

Primera entrega recomendada: watchlist sincronizada + avisos internos + fechas/estado de datos. Segunda: cambios entre informes y comparador ETF. Evitaría empezar por recomendaciones automáticas de compra, ejecución de operaciones o decenas de indicadores adicionales.

## Deuda técnica y límites
- `Index.tsx` y la función principal del servidor concentran demasiadas responsabilidades. Dividir por dominios y definir contratos versionados reduciría el riesgo de regresiones y facilitaría tests.
- La caché persistente ahora beneficia al feed; parte de los demás proveedores conserva cachés por instancia. Antes de extenderlas, distinguir correctamente claves, períodos, divisas, fecha fiscal y datos privados. Una caché mal definida es peor que una consulta lenta.
- Todavía se descarga una cantidad apreciable de JavaScript: Recharts, componentes de informe y dependencias compartidas. Conviene medir un perfil real en móvil y dividir módulos pesados sin fragmentarlos arbitrariamente.
- La generación depende de una conexión abierta. Una cola de trabajos permitiría continuar al cerrar la pestaña, recuperar el resultado y controlar mejor concurrencia y reintentos. Requiere cambios de arquitectura; no se ha añadido en esta entrega.
- No hay garantía de que todos los proveedores incluyan todos los activos, desgloses de ingresos, flujos institucionales o portadas. No sustituir datos ausentes por estimaciones de IA presentadas como hechos. Separar flujos netos de volumen negociado y posiciones declaradas.
- El feed todavía puede esperar a fotografías dentro de su bloque de noticias; se ha eliminado ese bloqueo para el bloque de mercado. Una fase posterior puede enriquecer imágenes progresivamente.
- Sin verificación de correo se pueden registrar direcciones ajenas todavía libres. La identidad administrativa está fijada por ID; persisten las recomendaciones de MFA administrativo, recuperación de cuenta fiable y protección contra altas abusivas.
- Para distribución comercial, comprobar con cada proveedor derechos de visualización y redistribución según contrato. No se ha cambiado ni verificado un contrato comercial en esta tarea.

Referencia del endpoint: https://massive.com/docs/rest/stocks/news . La documentación describe actualización horaria; no presentarlo como un servicio de noticias en tiempo real.

