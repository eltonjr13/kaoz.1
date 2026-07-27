"""Optional non-destructive smoke: execute only resolve_get_status locally."""

from __future__ import annotations

import json

from resolve_client import ResolveClient


if __name__ == "__main__":
    print(json.dumps(ResolveClient().status(), ensure_ascii=False, indent=2))
