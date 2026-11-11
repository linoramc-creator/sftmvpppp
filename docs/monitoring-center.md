# Seguimiento personal

El apartado **Seguimiento** reúne Cambios, Alertas y Agenda. Usa la lista existente
`beta_watchlists` y lee las posiciones de las carteras simuladas autorizadas.
No crea otra cartera, ejecuta órdenes, cambia sus marcas ni escribe en sus tablas.
La cartera conserva su restricción actual de administrador.

## Datos y límites

- Un trabajo global por activo comparte la observación entre suscriptores.
- Cron despierta cada cinco minutos. Cada activo vence a los quince minutos;
  cuatro trabajos por ejecución, dos simultáneos, máximo ocho por llamada.
- Fundamentales, fechas de resultados y composición se consultan una vez al día.
  EODHD es prioritario cuando el plan permite el dato. Yahoo, los calendarios
  existentes y Massive `/v2/reference/news` completan la cobertura disponible.
- Cotización y variación usan sesión regular o cierre, con su fecha real.
  No se prometen precios en tiempo real ni se atribuye un movimiento a una noticia.
- Las revisiones de BPA requieren período, moneda y unidad compatibles. Las
  publicaciones necesitan fecha de publicación, no solo cierre fiscal.
- El historial numérico conserva hasta 64 observaciones horarias recientes por
  activo, dentro de treinta días; las observaciones anteriores se compactan.
  Los eventos y recibos se conservan noventa días, con topes por activo/usuario.
- Hay hasta cincuenta alertas por usuario, veinte activas, cinco condiciones
  simultáneas por alerta. Los precios/importes exigen una moneda explícita.
- La agenda mira noventa días. La composición de ETF debe tener fuente, fecha y
  pesos válidos, con antigüedad máxima de ciento ochenta días. Los diez primeros
  componentes se incorporan a la recogida de eventos; el desglose monetario usa
  los pesos publicados disponibles. No se reconstruye la parte desconocida.

La cobertura de fundamentales depende del plan activo. La clave EODHD actual
puede proporcionar solamente EOD; la integración ampliada queda preparada sin
etiquetar campos ausentes como cero ni como datos actuales. Un fallo de consulta
mantiene la observación anterior y su fecha. Una observación más antigua nunca
sustituye a otra más reciente.

## Lectura, reglas y exposición

La entrada autenticada registra una visita idempotente. El identificador se
conserva durante una sesión; otras pestañas cercanas comparten la misma referencia.
Actualizar o cambiar de apartado no consume novedades. Solo una acción explícita
marca recibos como leídos. La fecha de detección permite incluir una publicación
descubierta después de la visita, conservando además su fecha original.

El servidor calcula las condiciones con aritmética, sin IA. Solo la transición
de no cumplida a cumplida produce un aviso. Un dato ausente/antiguo conserva el
estado previo; una condición vigente falsa permite rearmar. Pausar y reanudar
no provoca otro aviso para la misma condición ya cumplida. Las ediciones usan
revisión y las creaciones un UUID de intención; los borrados conservan un
identificador de idempotencia para impedir resurrecciones por reintentos tardíos.

`portfolioMetrics` calcula directamente sobre el estado existente, sus marcas
y su moneda. Se mantienen signos largos/cortos, efectivo y valoraciones
desconocidas. No se suman divisas sin conversión verificada. Las participaciones
de ETF desglosan el valor del fondo; no se añaden otra vez al patrimonio. Si el
ETF solo está en seguimiento, se informa de su composición sin atribuir al
usuario una inversión monetaria inexistente.

## IA y seguridad

Se reutiliza el resumidor de noticias existente con evidencia limitada a cada
artículo. El resultado se guarda en la observación compartida y se reutiliza;
también se conserva la marca de intento fallido para evitar reintentos de pago.
La misma noticia se deduplica por URL y titular dentro de cada lote. Un contador
atómico global limita la IA a 96 lotes diarios de hasta seis noticias. Sin clave,
presupuesto o respuesta válida se muestra el extracto de la fuente y continúan
los cálculos, la agenda y las alertas.

Todas las tablas tienen RLS y carecen de permisos directos para navegadores.
La API toma el usuario de la sesión verificada, rechaza propietarios en el
payload y llama al RPC `beta_monitor_store`. Las operaciones de worker requieren
`service_role`; la función HTTP exige POST, ausencia de Origin y el secreto
de trabajo. Los bloqueos por usuario, leases por activo, revisiones y claves
únicas evitan carreras y duplicados. Los fallos tienen backoff de cinco a
sesenta minutos. No se envían correos ni notificaciones móviles desde este módulo.

## Activación y operación

1. Aplicar `202611110001_monitoring.sql` con las migraciones anteriores presentes.
2. Publicar `analyze-ticker` y `monitoring-worker` con `verify_jwt=false`:
   ambos implementan su propia validación de identidad o secreto.
3. Reutilizar `BRIEF_CRON_SECRET` y la entrada Vault `terminal_brief_cron` ya
   configuradas. Las claves de proveedores permanecen en secretos de Supabase.
4. Verificar el trabajo `terminal-monitoring` y su historial en `cron.job_run_details`.
5. Publicar el frontend. Los usuarios pueden abrir Seguimiento y crear sus reglas.

`POST monitoring-worker` con `x-monitor-job` admite `operation: status` o `run`.
El estado devuelve contadores y fechas; nunca secretos o posiciones. No hace
falta mantener el navegador abierto. El primer recorrido recopila cobertura;
los cambios numéricos requieren una observación anterior y las noticias iniciales
se limitan a las últimas veinticuatro horas.

## Verificación

Los tests `monitoring-{api,data,engine,worker,database}.test.ts` verifican reglas,
fechas, divisas, estados desconocidos, noticias, composición parcial, reintentos,
deduplicación y ejecución sin navegador. La prueba SQL usa PostgreSQL aislado
(PGlite), roles reales, dos usuarios, un administrador y una cartera previa cuyo
contenido debe permanecer intacto. Las pruebas de interfaz comprueban formularios,
estados de lectura, cambio de cuenta, cancelación y pausa de consultas ocultas.
