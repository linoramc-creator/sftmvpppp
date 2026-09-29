"""Register Massive in the existing Codex config and Windows PowerShell profile."""
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import tomllib


def main():
    user = Path(os.environ.get('USERPROFILE', str(Path.home())))
    config = user / '.codex/config.toml'
    private = user / '.codex/massive'
    private.mkdir(parents=True, exist_ok=True)
    original = config.read_text(encoding='utf-8')
    parsed = tomllib.loads(original)
    scripts = Path(__file__).resolve().parent
    python = Path(sys.executable).resolve().as_posix()
    if 'massive' not in parsed.get('mcp_servers', {}):
        entry = f'''\n[mcp_servers.massive]
command = '{python}'
args = ['{(scripts / 'massive_server.py').as_posix()}']
startup_timeout_sec = 90
tool_timeout_sec = 90

[mcp_servers.massive.env]
MASSIVE_ENV_FILE = '{(private / 'credentials.env').as_posix()}'
PYTHONIOENCODING = 'utf-8'
'''
        tomllib.loads(original + entry)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        (private / f'config-before-{stamp}.toml').write_text(original, encoding='utf-8')
        config.write_text(original + entry, encoding='utf-8')
    for directory in ['PowerShell', 'WindowsPowerShell']:
        profile = user / 'Documents' / directory / 'Microsoft.PowerShell_profile.ps1'
        existing = profile.read_text(encoding='utf-8-sig') if profile.exists() else ''
        if '# Massive market-report' not in existing:
            entry = f"\n# Massive market-report\nfunction global:market-report {{\n    & '{python}' '{(scripts / 'market_reporter.py').as_posix()}' @args\n}}\n"
            profile.parent.mkdir(parents=True, exist_ok=True)
            profile.write_text(existing + entry, encoding='utf-8-sig')
    print('Configuración Massive añadida conservando servidores existentes; market-report instalado.')


if __name__ == '__main__':
    main()
