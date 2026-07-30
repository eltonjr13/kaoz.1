"""Optional non-destructive smoke: execute only resolve_get_status locally."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from resolve_client import ResolveClient


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Executa apenas o diagnóstico read-only do MCP DaVinci Resolve."
    )
    parser.add_argument(
        "--require-open",
        action="store_true",
        help="retorna código 1 quando o Resolve não estiver aberto e acessível",
    )
    options = parser.parse_args(argv)
    status = ResolveClient().status()
    print(json.dumps(status, ensure_ascii=False, indent=2))
    return 1 if options.require_open and not status.get("resolveOpen") else 0


if __name__ == "__main__":
    sys.exit(main())
