#!/usr/bin/env bash
# Optional Bash/Zsh entry point; the current Windows machine uses PowerShell.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec "${MARKET_REPORT_PYTHON:-python3}" "$script_dir/market_reporter.py" "$@"
