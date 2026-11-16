# Referencia de petróleo del feed

El propietario autorizó sustituir el cierre físico publicado de EIA por una
referencia negociada reciente, identificando contrato y retraso. Los espacios
WTI y Brent usan ahora `CL=F` y `BZ=F`, futuros continuos en USD/barril. No son
precios físicos al contado; Brent corresponde al futuro financiero publicado
en NYMEX. No se afirma un vencimiento concreto cuando la fuente no lo informa.

Las preferencias guardadas de contado se normalizan en lectura sin reescribir
la selección original. EIA conserva su adaptador independiente para consultas
históricas de contado. La nueva clave de caché impide reutilizar precios antiguos
de los espacios anteriores.

La consulta de futuros se comparte y se renueva cada cinco minutos por instancia
del servidor. El feed puede actualizar otros activos cada minuto sin volver a
consultar petróleo durante ese plazo. Un dato EOD antiguo hace recurrir a la
fuente alternativa; se verifica símbolo, tipo, moneda y fecha. Una sesión activa
no admite observaciones de más de dos horas; el cierre de fin de semana se
mantiene como cierre hasta 96 horas, siempre con su fecha real. Una consulta
fallida o una fecha más antigua no produce un precio inventado.

Se muestra la hora de la observación y su antigüedad. El retraso contractual de
la fuente no está informado; cinco minutos es frecuencia de consulta, no una
promesa de latencia del mercado. Massive MCP `/futures/v1/snapshot` se comprobó
el 16 de noviembre de 2026 y devolvió 403 por falta de autorización del plan.
No se usan ni atribuyen precios de ese endpoint.
