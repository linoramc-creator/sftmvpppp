# Fuentes de datos de mercado

Para desarrollar las funciones y los informes solicitados por el propietario,
usar Massive MCP como fuente adicional, junto con las integraciones existentes.
Consultar `docs/massive-integration.md` para la configuración y las limitaciones
verificadas del plan. El pipeline local está en `scripts/market_reporter.py`.

Descubrir y verificar endpoints mediante el MCP cuando esté disponible. Si no
está cargado en la sesión, el script puede consultarlo por stdio. No afirmar que
los datos se obtuvieron de Massive sin una llamada real satisfactoria.

Conservar fecha, moneda, período y ajustes de los datos. No inventar importes,
griegas o fundamentales cuando el plan no los autorice. Mantener las claves fuera
de Git y del frontend. Conectar nuevos datos a producción según las indicaciones
del usuario; configurar el MCP en Codex no equivale a conectarlo con Gemini.
