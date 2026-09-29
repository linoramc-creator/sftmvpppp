"""Launch the official, pinned Massive MCP server without embedding credentials."""
import os
from pathlib import Path


def load_key():
    if os.environ.get('MASSIVE_API_KEY'):
        return
    location = Path(os.environ.get('MASSIVE_ENV_FILE', str(Path.home() / '.codex/massive/credentials.env')))
    for line in location.read_text(encoding='utf-8-sig').splitlines():
        name, separator, value = line.partition('=')
        if separator and name.strip() == 'MASSIVE_API_KEY':
            os.environ['MASSIVE_API_KEY'] = value.strip()
    if not os.environ.get('MASSIVE_API_KEY'):
        raise RuntimeError('Falta MASSIVE_API_KEY en el entorno o archivo privado.')


if __name__ == '__main__':
    load_key()
    from mcp_massive import main
    main()
