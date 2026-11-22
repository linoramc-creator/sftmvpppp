# Catálogo financiero específico de Analytics y MensorLab

El mismo motor, autenticación, proveedores y controles de exportación sirven a
ambos apartados. El modelo interpreta una definición; los datos y cálculos se
obtienen y validan en el servidor. Guardar, actualizar y reorganizar un estudio
no vuelve a interpretar su definición con IA.

## Nuevas series de cuentas publicadas

Se incorporan `operatingIncome`, `researchDevelopment`, `currentAssets`,
`currentLiabilities` y `netDebt`, con frecuencia trimestral o anual. Los importes
conservan la moneda, el cierre fiscal y, cuando existe, la fecha de presentación.
Se reutilizan EODHD si el plan autoriza fundamentales, SEC y Yahoo. No se trata
una ausencia de I+D o de clasificación corriente como un cero.

Deuda neta se calcula como deuda total menos efectivo y equivalentes de la misma
fila fiscal. No incorpora automáticamente inversiones financieras. Puede ser
negativa (caja neta), conserva las dos fuentes utilizadas y no se infiere cuando
falta uno de los importes.

Nuevos ratios permitidos:

| Definición | Unidad |
| --- | --- |
| Beneficio operativo / ingresos | % |
| I+D / ingresos | % |
| Activos corrientes / pasivos corrientes | veces |
| Efectivo / pasivos corrientes | veces |
| CapEx / flujo de caja operativo | % |

Solo se divide por un denominador positivo, de igual fecha fiscal, duración y
moneda. Las cuentas de bancos pueden no clasificar activos o pasivos corrientes;
la cobertura parcial se muestra expresamente. Se distinguen trimestres 3M de
acumulados YTD y ejercicios 12M. Las cifras SEC son las últimas revisiones
publicadas disponibles al consultar, no una base histórica libre de revisiones.

## Valoraciones actuales, separadas del histórico

Se admiten cuatro métricas de instantánea:

| Métrica | Tipo |
| --- | --- |
| `forwardPeCurrent` | PER forward; `dataKind: estimate` |
| `trailingPeCurrent` | PER TTM; `dataKind: reported` |
| `priceToBookCurrent` | Precio / valor contable; `dataKind: reported` |
| `enterpriseToEbitdaCurrent` | EV / EBITDA; `dataKind: reported` |

Son únicamente `level`, frecuencia `daily` y gráfico `bar`, en veces (x). La
frecuencia expresa que puede actualizarse la instantánea; no implica una serie
diaria guardada. La fecha del punto es la consulta del múltiplo y su fuente
conserva también la fecha de la cotización usada. Como los ratios son
adimensionales, cambiar la moneda del control no convierte ni altera el valor.

Se reutiliza el acceso autenticado de Yahoo a través de un callback del servidor,
con caché de cinco minutos. El normalizador exige identidad del emisor, tipo
EQUITY y cotización de referencia no superior a siete días ni futura. No acepta
los múltiplos agregados de ETF como múltiplos de una empresa. Los valores no
positivos se dejan ausentes; si se conoce un EPS TTM, valor contable por acción o
EBITDA no positivo, su correspondiente múltiplo se deja ausente.

Una petición histórica explícita de PER, PER forward, P/B o EV/EBITDA no se
convierte silenciosamente en la instantánea. El intérprete explica la limitación
y ofrece consultas actuales separadas. Una consulta estructurada de instantánea
que termina antes de la fecha de consulta no recibe datos de hoy: queda ausente
y ofrece una alternativa actual explícita.

**No hay histórico forward P/E point-in-time verificado con los derechos
actuales.** No se combinan precios pasados con estimaciones de hoy, ni se usan
estimaciones de resultados de un evento como si fueran consenso NTM. El
proveedor de la instantánea no comunica un horizonte de consenso uniforme y se
advierte; no se etiqueta como NTM ni como el próximo ejercicio fiscal.

Massive MCP se verificó el 22 de noviembre de 2026: el endpoint descubierto
`GET /stocks/financials/v1/ratios` describe ratios TTM del último día de
negociación y la llamada de prueba con MSFT devolvió HTTP 403 por falta de
autorización. No se anuncia cobertura Massive para estos múltiplos ni se añade
un consumo repetido destinado a fallar. El endpoint tampoco acredita un
histórico de estimaciones forward. EODHD conserva su integración previa para
reactivar la cobertura de estados financieros cuando el plan la autorice.

## Persistencia, coste y activación

Aplicar `202611220001_analytics_catalog.sql` antes de publicar el catálogo. La
migración sustituye solo la validación de definiciones de Analytics: mantiene
propietarios, revisiones, idempotencia, límites y RLS. No modifica carteras,
órdenes, posiciones ni instantáneas previas de MensorLab. Las nuevas métricas se
guardan en estudios Analytics de proyectos privados de MensorLab mediante el
motor compartido.

Los nuevos nombres, ratios y peticiones comunes se interpretan mediante reglas;
no requieren modelo. Las ideas de valoración y liquidez son definiciones
compatibles, no promesas de cobertura ni recomendaciones de inversión. Los
derechos de exportación existentes se conservan: una gráfica derivada no
habilita automáticamente la descarga de los datos de su fuente.

Pruebas: normalización de identidad/fecha, restricciones del catálogo,
instantáneas fuera de periodo, petición histórica sin sustitución, cálculos y
denominadores ausentes, atribución de deuda neta, tres adaptadores, ejecución
MensorLab y PostgreSQL real mediante PGlite (aislamiento y guardado).
