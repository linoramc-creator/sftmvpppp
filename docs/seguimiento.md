# Seguimiento

Seguimiento tiene una lista privada de hasta siete activos, independiente de
la personalización del feed. Al crearla se copia la lista privada existente;
las ediciones posteriores solo cambian Seguimiento. El guardado usa revisiones
para detectar modificaciones simultáneas y no sobrescribirlas silenciosamente.

- **Resumen:** noticias de esa lista en un feed cronológico, deduplicadas entre
  activos, con búsqueda, filtros y lectura persistida. Las imágenes y puntos
  clave se muestran únicamente cuando están disponibles. Incluye próximos
  eventos e indicadores observados, con cobertura y antigüedad explícitas.
- **Agenda:** resultados, dividendos y publicaciones de la lista. Las fechas
  estimadas se identifican; una fecha desconocida no se inventa.
- **Alertas:** Reglas conserva creación, edición, pausa y eliminación por
  revisión. Buzón contiene exclusivamente notificaciones de alertas, con
  paginación propia y filtros de lectura y regla. Registro conserva los cambios
  de configuración y las activaciones, incluso después de eliminar una regla.

Cada activación guarda las condiciones, la evaluación, las fuentes y las fechas
de ese momento. No se reconstruye con la configuración actual. El buzón y el
registro se aíslan por usuario. La retención aplicada al registrar actividad es
de hasta 180 días, con máximos de 500 mensajes y 1.000 entradas de auditoría por
usuario; se retiran primero las entradas más antiguas.

Se reutiliza el cron `terminal-monitoring`, que ejecuta el worker del servidor
cada cinco minutos y comparte la recopilación por activo, normalmente cada
quince minutos. Los fallos conservan los reintentos con espera progresiva. La
recopilación y las alertas funcionan con la aplicación cerrada; no envían correo.
La IA no evalúa condiciones numéricas.

Aplicar `202611170001_following_workspace.sql` después de las migraciones de
seguimiento anteriores y publicar `analyze-ticker`, `monitoring-worker` y la
interfaz. Se mantienen los proveedores y secretos existentes: no se requieren
nuevas variables de entorno. Los detalles operativos anteriores permanecen en
[monitoring-center.md](monitoring-center.md).
