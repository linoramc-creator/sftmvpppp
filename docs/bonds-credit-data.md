# Bonos y Créditos: cobertura y unidades

Verificado el 18 de octubre de 2026. El endpoint `panel: bondsCredit` conserva
el panel de bonos existente y añade series oficiales y señales cotizadas. No
ejecuta modelos de IA ni toma datos de credenciales del cliente.

## Soberanos internacionales

La selección de Estados Unidos, Francia, Alemania y Reino Unido utiliza la
referencia a diez años de la OCDE, publicada con frecuencia **mensual**:

| País | Serie | Moneda del bono |
|---|---|---|
| Estados Unidos | `IRLTLT01USM156N` | USD |
| Francia | `IRLTLT01FRM156N` | EUR |
| Alemania | `IRLTLT01DEM156N` | EUR |
| Reino Unido | `IRLTLT01GBM156N` | GBP |

Son porcentajes anuales; no cotizaciones intradiarias. Las variaciones en puntos
básicos se calculan entre meses exactos. El diferencial frente a Alemania usa un
mes común entre los cuatro países. Las diferencias entre bonos denominados en
monedas distintas no representan exclusivamente riesgo soberano.

Referencias de datos: OCDE (2026), *Main Economic Indicators*, tipos de interés a
largo plazo, consultados mediante [Francia](https://fred.stlouisfed.org/series/IRLTLT01FRM156N),
[Alemania](https://fred.stlouisfed.org/series/IRLTLT01DEM156N),
[Reino Unido](https://fred.stlouisfed.org/series/IRLTLT01GBM156N) y
[Estados Unidos](https://fred.stlouisfed.org/series/IRLTLT01USM156N).
Se conservan sus identificadores y enlaces públicos en los metadatos técnicos.
La curva diaria estadounidense sigue siendo un bloque independiente: no se
fabrica una curva de varios vencimientos para los países con cobertura a diez
años únicamente.

## Crédito privado real

La [integración del crédito privado en las cuentas financieras Z.1](https://www.federalreserve.gov/econres/notes/feds-notes/introducing-private-credit-into-the-financial-accounts-of-the-united-states-20261016.html)
permite añadir datos **trimestrales** de fondos de deuda privada domiciliados en
Estados Unidos. Este sector no equivale al universo mundial de crédito privado
ni al conjunto de BDCs o fondos de intervalo.

| Magnitud | Serie | Unidad original |
|---|---|---|
| Activos financieros | `BOGZ1FL444090000Q` | Millones USD |
| Préstamos a coste | `BOGZ1FL443067205Q` | Millones USD |
| Préstamos a valor razonable | `BOGZ1LM443067215Q` | Millones USD |
| Pasivos totales | `BOGZ1FL444190005Q` | Millones USD |

Las cantidades se convierten multiplicando por 0,001 a **miles de millones USD**,
evitando la ambigüedad del término español «billón». Los datos comienzan en
2012:Q4. En los puntos trimestrales de FRED, `2026-04-01` identifica el trimestre
2026:Q2, no una valoración del 1 de abril.

La brecha de valoración es `(valor razonable / coste - 1) × 100`; únicamente se
calcula con idéntica fecha y cobertura. No es una tasa de impago. El crecimiento
interanual utiliza el mismo trimestre del año anterior, sin sustituir trimestres
ausentes. Es crecimiento del saldo, no captaciones netas.

El indicador pasivos/activos divide los pasivos totales por los activos
financieros del mismo sector y fecha. La [tabla S124.8.s](https://www.federalreserve.gov/releases/z1/current/html/s124_8_s.htm)
separa los pasivos totales de las participaciones emitidas: estas últimas no se
incluyen en el numerador. No se denomina deuda financiera/patrimonio ni se
interpreta automáticamente como apalancamiento crediticio.

## Condiciones bancarias y financieras

| Serie | Cobertura | Frecuencia |
|---|---|---|
| `DRTSCILM`, `DRTSCIS` | Estándares bancarios, porcentaje neto de endurecimiento | Trimestral |
| `DRSDCILM` | Demanda bancaria, porcentaje neto de demanda más fuerte | Trimestral |
| `DRBLACBS` | Morosidad de préstamos empresariales de bancos comerciales | Trimestral |
| `BUSLOANS` | Saldo C&I bancario, miles de millones USD | Mensual |
| `NFCI` | Condiciones financieras respecto a su media histórica | Semanal |

Las series SLOOS proceden del [Board of Governors](https://fred.stlouisfed.org/series/DRTSCILM);
la [morosidad bancaria](https://fred.stlouisfed.org/series/DRBLACBS) no es morosidad
del crédito privado no bancario. El [NFCI](https://fred.stlouisfed.org/series/NFCI),
del Federal Reserve Bank of Chicago, es positivo con condiciones más restrictivas
y negativo con condiciones más holgadas que su media. Sus cifras son un índice,
no porcentajes ni una probabilidad de crisis.

Se mantienen los diferenciales OAS investment grade y high yield existentes.
Su unidad original en puntos porcentuales se convierte a puntos básicos
multiplicando por cien. Corresponden a crédito negociado, no a préstamos privados.

## Indicadores cotizados

`BIZD` sigue BDCs cotizadas; [VanEck](https://www.vaneck.com/us/en/investments/bdc-income-etf-bizd/overview/)
describe su exposición a empresas que prestan a compañías privadas. `BKLN`
representa préstamos sindicados cotizados. Ninguno sustituye las valoraciones
trimestrales del sector privado, ni sus variaciones de precio indican flujos netos.

Los rendimientos y gráficos usan cierres ajustados de sesiones completas de la
integración existente (`relativeHistory`). Para BIZD se consulta además Massive
con la clave exclusivamente del servidor; su agregado diario fue verificado con
respuesta satisfactoria. Sólo se acepta para una fecha cuya sesión completa esté
verificada; no se presenta una barra diaria en formación como último cierre.
Precio y fecha de los rendimientos se conservan en campos separados.

## Caché y fallos parciales

Panel agregado: quince minutos; series oficiales: una hora; indicadores
cotizados: cinco minutos, con reutilización de las cachés existentes. Las series
se consultan por API oficial y, si esta no entrega datos, mediante CSV oficial.
Se descartan valores ausentes, fechas inválidas y fechas futuras; los ceros y
valores negativos legítimos se conservan. No se rellenan ni interpolan períodos.
Los fallos quedan como ausencia explícita, manteniendo las demás series.
