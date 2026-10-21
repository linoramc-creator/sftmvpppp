# Bonos y Créditos: cobertura y unidades

Revisado el 21 de octubre de 2026. El endpoint `panel: bondsCredit` conserva
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
| Compromisos de capital no exigidos | `BOGZ1FL442000093Q` | Millones USD |

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

## Análisis de curvas, inflación y riesgo

La curva del Tesoro compara la última fecha común reciente con fechas comunes
a un mes y un año. Los vencimientos se colocan por duración real del plazo,
sin interpolar tipos ausentes. Las pendientes 10 años–2 años, 10 años–3 meses y
30 años–5 años expresan diferencias en puntos básicos. La [Reserva Federal de
Nueva York](https://www.newyorkfed.org/research/capital_markets/ycfaq) documenta
el uso de la pendiente 10 años–3 meses como indicador; este panel no calcula una
probabilidad de recesión ni replica su modelo.

La comparación nominal/real incorpora el breakeven a diez años y la expectativa
implícita a cinco años dentro de cinco (`T5YIFR`). Estas últimas incluyen primas
de riesgo y liquidez, y no son pronósticos puros de inflación. Si falta cobertura
del Tesoro, se intenta el endpoint Massive `/fed/v1/treasury-yields`, con fechas
y porcentajes originales, antes del CSV oficial.

Los diferenciales IG/HY conservan las series existentes. Sus cambios se calculan
entre observaciones, que pueden incluir fines de mes en días no bursátiles. El
percentil histórico usa la muestra real indicada y requiere al menos cien
observaciones; no predice rentabilidad ni impagos. No se añaden índices ICE por
categorías BB/CCC ni se amplían sus derechos de redistribución.

El escenario de tipos usa `Δprecio (%) ≈ −duración modificada × Δtipo (pb) / 100`.
La [explicación de duración de PIMCO](https://www.pimco.com/us/en/resources/education/understanding-duration)
describe este análisis de sensibilidad. Los parámetros del simulador son
hipótesis editables, no duraciones de activos consultadas. Se excluyen cupón,
convexidad y cambios de spread. No implica respaldo o colaboración de PIMCO.

## Lectura del crédito privado

Se priorizan brecha de valoración, crecimiento de préstamos, pasivos respecto
al patrimonio financiero (`pasivos / (activos financieros − pasivos)`) y capital
comprometido no exigido respecto al saldo de préstamos a coste. Los cocientes
exigen el mismo trimestre y denominadores positivos. El capital no exigido no
es efectivo en balance, y el crecimiento del saldo no son flujos de captación.

No existe en las integraciones verificadas una serie global homogénea de PIK,
non-accrual o impagos de crédito privado; no se sustituye por morosidad bancaria
ni se inventa. La distinción entre valoración, apalancamiento y liquidez sigue
las dimensiones de riesgo examinadas por el [FMI en su análisis de crédito
privado](https://www.imf.org/-/media/Files/Publications/GFSR/2024/April/English/ch2.ashx).

## Noticias de renta fija

`panel: bondsCreditNews` acepta únicamente `US`, `FR`, `DE`, `GB` o `private`,
tras autenticar y aplicar presupuesto por cuenta. Se carga independientemente
de las métricas. Las noticias soberanas exigen vínculo entre país y mercado de
bonos; las de crédito privado deben tratar de préstamos privados o direct lending.
Se excluyen anuncios promocionales y noticias de consumo o capital riesgo sin
conexión crediticia. Ventana máxima: siete días para soberanos y catorce para
crédito privado global; se muestran hasta seis artículos, sin rellenar con ruido.

Se reutilizan las fuentes periodísticas y Massive `/v2/reference/news` con caché
y consultas acotadas. Se añaden RSS temáticos verificados de CNBC, FT y Yahoo,
y descubrimiento RSS por tema: solo se aceptan enlaces originales de editores
permitidos, sin seguir redirecciones a hosts arbitrarios. La búsqueda adicional
de pago es una sola consulta básica por tema
cuando falta cobertura y hay presupuesto. Las fechas y portadas corresponden a
artículos reales; no se reemplazan por logotipos. No se ejecuta Gemini para
construir este panel ni para calcular los indicadores.
