"""Read-only MCP market data pipeline. stdout is JSON-only with --json."""
import argparse
import asyncio
import csv
import io
import json
import math
import os
from pathlib import Path
import re
import statistics
import sys
from datetime import datetime, timedelta, timezone

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]


def decode_result(result):
    raw = result.model_dump(mode='json', exclude_none=True)
    text = '\n'.join(block.text for block in result.content if getattr(block, 'type', '') == 'text')
    error = bool(result.isError) or text.startswith(('Error', 'Warning [EMPTY]'))
    rows = []
    if not error:
        try:
            data = json.loads(text)
            rows = data if isinstance(data, list) else [data]
        except (ValueError, TypeError):
            table = text.split('\n\nNext page available.')[0]
            rows = list(csv.DictReader(io.StringIO(table))) if table.strip() else []
    return {'ok': not error and bool(rows), 'rows': rows, 'raw_mcp': raw,
            'error': text[:600] if error else None}


async def collect(args):
    environment = {name: value for name, value in os.environ.items()
                   if name in ('PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
                               'APPDATA', 'LOCALAPPDATA', 'MASSIVE_API_KEY', 'MASSIVE_ENV_FILE')}
    environment['PYTHONIOENCODING'] = 'utf-8'
    params = StdioServerParameters(command=sys.executable,
        args=[str(Path(__file__).with_name('massive_server.py'))], env=environment)
    # Server logs never mix with the JSON pipeline or persist credentials.
    with open(os.devnull, 'w') as errors:
        async with stdio_client(params, errlog=errors) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = [tool.name for tool in tools.tools]
                if args.discover:
                    result = await session.call_tool('search_endpoints', {'query': args.discover, 'detail': 'more', 'max_results': 4})
                    return {'tools': names, 'discovery': result.model_dump(mode='json', exclude_none=True)}
                now = datetime.now(timezone.utc)
                ticker = args.ticker
                report = {'ticker': ticker, 'provider': 'Massive MCP', 'fetched_at': now.isoformat(),
                          'tools': names, 'datasets': {}, 'metrics': {}}
                queries = [
                    ('prices', f'/v2/aggs/ticker/{ticker}/prev', {'adjusted': 'true'}),
                    ('fundamentals', '/stocks/financials/v1/income-statements', {'tickers': ticker, 'timeframe': 'quarterly', 'sort': 'period_end.desc', 'limit': 1}),
                    ('options', f'/v3/snapshot/options/{ticker}', {'limit': 5}),
                    ('history', f'/v2/aggs/ticker/{ticker}/range/1/day/{(now-timedelta(days=60)).date()}/{now.date()}', {'adjusted': 'true', 'sort': 'asc', 'limit': 60}),
                ]
                for name, path, query in queries:
                    result = await session.call_tool('call_api', {'path': path, 'params': query})
                    report['datasets'][name] = {'path': path, **decode_result(result)}
                report['partial'] = not all(dataset['ok'] for dataset in report['datasets'].values())
                prices = report['datasets']['history']['rows']
                closes = []
                for row in prices:
                    try:
                        close = float(row['c'])
                        if math.isfinite(close) and close > 0:
                            closes.append(close)
                    except (KeyError, ValueError, TypeError):
                        continue
                if len(closes) >= 21:
                    returns = [math.log(b/a) for a, b in zip(closes[-21:-1], closes[-20:])]
                    report['metrics']['realized_volatility_20_sessions_annualized'] = statistics.stdev(returns) * math.sqrt(252)
                return report


def render(report):
    if 'discovery' in report:
        return '\n'.join(block.get('text', '') for block in report['discovery'].get('content', []))
    lines = [f"MASSIVE MCP | {report['ticker']}", f"Consulta UTC: {report['fetched_at']}", '-' * 68]
    for name, dataset in report['datasets'].items():
        if not dataset['ok']:
            reason = dataset['error'] or 'sin registros'
            if '403' in reason:
                reason = 'Tu plan no autoriza estos datos (HTTP 403).'
            elif '429' in reason:
                reason = 'Límite de consultas alcanzado (HTTP 429).'
            lines.append(f"{name:14} | {reason}")
            continue
        lines.append(f"{name:14} | {len(dataset['rows'])} registro(s)")
        if name == 'prices':
            row = dataset['rows'][0]
            try:
                date = datetime.fromtimestamp(float(row['t']) / 1000, timezone.utc).date()
                lines.append(f"  Cierre previo: {row['c']} USD | Sesión: {date}")
            except (KeyError, ValueError, TypeError):
                pass
        for key, value in list(dataset['rows'][0].items())[:10]:
            lines.append(f"  {key:28} {str(value)[:180]}")
    for name, value in report['metrics'].items():
        lines.append(f"{name}: {value:.2%}")
    lines.append('Precio: cierre previo; no implica tiempo real. Opciones: IV/griegas solo si están autorizadas y publicadas.')
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ticker', nargs='?', default='AAPL')
    parser.add_argument('--json', action='store_true', help='JSON con las respuestas MCP originales, sin logs en stdout')
    parser.add_argument('--discover', help='Consultar la documentación de endpoints a través del MCP')
    parser.add_argument('--reports-dir', type=Path, default=ROOT / 'reports')
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    args.ticker = args.ticker.upper()
    if not re.fullmatch(r'[A-Z][A-Z0-9.:-]{0,20}', args.ticker):
        parser.error('Ticker inválido')
    try:
        report = asyncio.run(asyncio.wait_for(collect(args), args.timeout))
        # Remove credentials even if an upstream service accidentally echoes one.
        payload = json.dumps(report, ensure_ascii=False, indent=2)
        from massive_server import load_key
        load_key()
        secret = os.environ.get('MASSIVE_API_KEY', '')
        if secret:
            payload = payload.replace(secret, '[REDACTED]')
        report = json.loads(payload)
        args.reports_dir.mkdir(parents=True, exist_ok=True)
        filename = args.reports_dir / f"{args.ticker}_{datetime.now(timezone.utc):%Y%m%dT%H%M%S%fZ}.json"
        filename.write_text(payload + '\n', encoding='utf-8')
        print(payload if args.json else render(report))
        print(f'Guardado: {filename}', file=sys.stderr)
        return 0 if args.discover or any(d['ok'] for d in report['datasets'].values()) else 2
    except Exception as exc:
        # Exception messages may include upstream URLs; do not print secrets.
        print(f'No se pudo completar la conexión MCP ({type(exc).__name__}). Comprueba configuración y red.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
