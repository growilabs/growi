#!/usr/bin/env python3
"""Compare a freshly exported OpenAPI document with the committed one, as JSON.

The committed packages/attachment-text-extractor-client/openapi.json is
formatted by biome (short arrays on one line) while the exporter writes
``json.dump(indent=2)``, so a textual diff would always fail. Comparing the
parsed documents ignores formatting and catches every real contract change.

Usage: python scripts/check_openapi_drift.py GENERATED COMMITTED
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def documents_differ(generated: Path, committed: Path) -> bool:
    return json.loads(generated.read_text(encoding="utf-8")) != json.loads(committed.read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)  # noqa: T201
        return 2
    generated, committed = Path(argv[0]), Path(argv[1])
    if documents_differ(generated, committed):
        print(  # noqa: T201
            f"OpenAPI drift: {committed} is out of date. Run `uv run poe export-openapi`, "
            "format the file with biome and commit it.",
            file=sys.stderr,
        )
        return 1
    print("OpenAPI contract is up to date")  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
