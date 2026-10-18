# Actividad de las empresas del sector

El bloque se integra en «Empresas líderes» de los informes sectoriales, incluidos
los guardados. Extrae hasta diez empresas de la tabla Empresa/Ticker del informe
terminado, sin otra llamada a un modelo. No usa una lista fija de sectores.

La ruta autenticada `panel: sectorActivity` valida asunto y candidatos antes de
consultar datos. El backend confirma tipo de acción, símbolo, nombre y moneda.
Una identidad no confirmada queda fuera de la muestra. Las consultas se limitan
a tres empresas simultáneas y reutilizan perfiles e históricos compartidos.

Por cada moneda se elige la última sesión cerrada común. Se muestran:

- Importe aproximado negociado: volumen de títulos por precio de cierre sin
  ajustar. No es flujo neto, captación ni compra institucional.
- Volumen frente a las veinte sesiones completas anteriores y mediana real
  del grupo observado. Un volumen ausente nunca se convierte en cero.
- Empresas al alza, a la baja y por encima de su media de cincuenta sesiones.
  Es amplitud de esta muestra, no de todo el sector.
- Rentabilidad de una muestra inicialmente equiponderada frente a una referencia
  en la misma moneda, normalizada en idénticas fechas con cierres ajustados.
- Histórico de veinte importes diarios. Una sesión con cobertura incompleta
  conserva un hueco en el total; la suma parcial actual se identifica como tal.

La caché del resultado dura cinco minutos. Guarda exclusivamente datos públicos
de mercado mediante el rol de servicio. No contiene sesiones, cuentas ni informes
privados. Cambiar de apartado conserva la selección y evita repetir consultas.

Las fichas de índices y ETF reutilizan además `risk.history` ya entregado por
`marketPulse`: volatilidad anualizada a veinte/sesenta sesiones y drawdown de
cierre desde el máximo móvil de hasta 252 sesiones. Los cambios de volatilidad
de una y cinco observaciones se expresan en puntos porcentuales, sin confundirlos
con cambios porcentuales relativos o días naturales. No requiere consultas de IA.
