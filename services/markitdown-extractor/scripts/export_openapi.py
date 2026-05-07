#!/usr/bin/env python3
"""Export the FastAPI OpenAPI schema to a JSON file.

Usage:
    uv run python scripts/export_openapi.py --output /path/to/openapi.json

The script sets a dummy MARKITDOWN_SERVICE_TOKEN if one is not already present
in the environment so that the FastAPI app can be initialised without requiring
a real service token during schema export.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def main() -> None:
    """Parse arguments, initialise the app, and write the OpenAPI schema."""
    parser = argparse.ArgumentParser(description="Export OpenAPI schema to a JSON file")
    parser.add_argument(
        "--output",
        required=True,
        metavar="PATH",
        help="Destination path for the generated openapi.json",
    )
    args = parser.parse_args()

    # Provide a dummy token so that Settings() does not raise ValidationError
    # when running outside of a real service environment.
    if not os.environ.get("MARKITDOWN_SERVICE_TOKEN"):
        os.environ["MARKITDOWN_SERVICE_TOKEN"] = "export-only-dummy-token"  # noqa: S105

    # Defer the import until after the env var is set.
    from app.main import app  # noqa: PLC0415
    from app.schemas import ErrorCode, ErrorResponse  # noqa: PLC0415
    from pydantic import TypeAdapter  # noqa: PLC0415

    schema = app.openapi()

    # Ensure error schemas are always present in components/schemas.
    # FastAPI only auto-generates schemas for models declared in route response
    # type annotations.  ErrorResponse and ErrorCode are returned via
    # JSONResponse(content=...) which bypasses FastAPI's schema discovery, so
    # we inject them explicitly here using Pydantic's schema introspection.
    components = schema.setdefault("components", {})
    schemas = components.setdefault("schemas", {})

    # ErrorResponse is a Pydantic BaseModel — use model_json_schema().
    error_response_schema = ErrorResponse.model_json_schema()
    defs = error_response_schema.pop("$defs", {})
    for def_name, def_schema in defs.items():
        if def_name not in schemas:
            schemas[def_name] = def_schema
    if "ErrorResponse" not in schemas:
        schemas["ErrorResponse"] = error_response_schema

    # ErrorCode is a str Enum — use TypeAdapter to obtain its JSON schema.
    error_code_schema = TypeAdapter(ErrorCode).json_schema()
    if "ErrorCode" not in schemas:
        schemas["ErrorCode"] = error_code_schema

    # Fix dangling $defs refs: Pydantic's model_json_schema() uses "#/$defs/<name>"
    # internally, but those definitions have been lifted into "#/components/schemas/".
    # Rewrite all occurrences so that every $ref resolves correctly in the final doc.
    schema_str = json.dumps(schema)
    schema_str = schema_str.replace('"#/$defs/', '"#/components/schemas/')
    schema = json.loads(schema_str)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8") as fh:
        json.dump(schema, fh, indent=2)
        fh.write("\n")  # trailing newline for POSIX compliance

    print(f"OpenAPI schema exported to {output_path}", file=sys.stdout)  # noqa: T201


if __name__ == "__main__":
    main()
