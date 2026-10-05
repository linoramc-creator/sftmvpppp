# Massive: fuente adicional para la terminal

El servidor `massive` de Codex ejecuta el paquete MCP oficial de Massive v0.10.0
por stdio, en un entorno Python aislado. La URL `https://mcp.massive.com/` usa
OAuth; para automatizar con la API key proporcionada se utiliza la alternativa
local oficial. No se ha registrado una conexión HTTP ficticia con API key.

La credencial se carga desde `MASSIVE_API_KEY` o desde
`~/.codex/massive/credentials.env`, indicado mediante `MASSIVE_ENV_FILE`.
Nunca debe incluirse en Git, en el cliente web, en logs ni en informes.

## Uso

En una nueva PowerShell:

```powershell
market-report AAPL
market-report SPY --json | ConvertFrom-Json -AsHashtable
market-report AAPL --json | jq '.datasets.prices.rows'
market-report AAPL --discover 'stock revenue financial statements'
```

El comando usa `scripts/market_reporter.py`, consulta las herramientas MCP y
guarda cada resultado con fecha UTC en `reports/`, excluido de Git. `--json`
emite un único documento JSON en stdout; la ruta del archivo se imprime en
stderr. `raw_mcp` conserva las respuestas originales del MCP (que puede entregar
CSV dentro de bloques de texto); `rows` ofrece la interpretación estructurada.
`partial` indica que uno o varios conjuntos no están disponibles.
Código de salida: 0 con datos parciales o completos, 2 si ninguno está disponible,
1 ante fallo de conexión. Las claves se redactan si aparecen en una respuesta.

La muestra de opciones se limita a cinco contratos y no representa toda la
cadena. La volatilidad realizada se calcula a partir de 20 retornos logarítmicos
diarios y 252 sesiones anuales; no es volatilidad implícita. Se consulta el cierre
previo ajustado, sin presentarlo como precio en tiempo real.

## Instalación reproducible

Python 3.12 o superior:

```sh
python -m venv .venv-market
# Windows: .venv-market/Scripts/python.exe
# Unix: .venv-market/bin/python
.venv-market/Scripts/python.exe -m pip install -r scripts/requirements-market.txt
.venv-market/Scripts/python.exe scripts/setup_massive.py
```

`setup_massive.py` conserva los servidores existentes y guarda una copia de la
configuración antes de añadir Massive. Añade `market-report` a los perfiles de
PowerShell y Windows PowerShell. Para Bash/Zsh puede cargarse una función que
invoque `scripts/market-report.sh` con `MARKET_REPORT_PYTHON` apuntando al venv.

## Uso al desarrollar informes y funciones

Massive complementa las fuentes existentes. Usar `search_endpoints` para comprobar
los parámetros, `call_api` para obtener los datos y `query_data` cuando proceda.
Contrastar ticker, período, moneda, fecha de mercado y ajustes antes de combinar
resultados. No tratar respuestas HTTP 403, 429 o datos ausentes como ceros.

Verificación realizada el 29-09-2026: AAPL, cierre previo e histórico accesibles;
fundamentales y opciones denegados por el plan (HTTP 403). No se ha contratado
ni ampliado ningún plan.

Este enlace habilita consultas para Codex y el pipeline local. No modifica por sí
solo el backend de producción ni conecta Gemini automáticamente a un proceso
local. Las futuras incorporaciones a Supabase deberán hacerse según las
indicaciones del propietario, con credenciales de servidor, caché, límites y
permisos de datos apropiados. No exponer este MCP local públicamente.

Documentación: https://github.com/massive-com/mcp_massive y
https://massive.com/docs/ai-tools/clients/codex .

## Integración de noticias en producción (05-10-2026)

`/v2/reference/news` está integrado por REST en Supabase como fuente adicional
para feed, paneles e informes. Verificado mediante MCP y REST. El secreto
`MASSIVE_API_KEY` permanece exclusivamente en el servidor. El MCP local sigue
siendo una herramienta de desarrollo; no se expone a los usuarios.

Consulta acotada, timeout, caché y degradación a las otras fuentes ante errores.
Los sectores se seleccionan por tema sobre noticias generales: no existe un
filtro sectorial nativo en este endpoint. Las fuentes originales y fechas se
conservan internamente; no se fabrican noticias para completar una cuota.
