"""Tests for scripts/export_openapi.py.

Verifies that the script:
- writes a valid JSON file to the requested output path
- includes the required OpenAPI 3.x top-level keys
- exposes ExtractResponse, ErrorResponse, and ErrorCode in components/schemas
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Locate the script under test
# ---------------------------------------------------------------------------
_SCRIPTS_DIR = Path(__file__).parent.parent / "scripts"
_SCRIPT_PATH = _SCRIPTS_DIR / "export_openapi.py"


# ---------------------------------------------------------------------------
# Helper: load the script as a module so we can call main() directly
# ---------------------------------------------------------------------------
def _load_script():  # noqa: ANN201
    spec = importlib.util.spec_from_file_location("export_openapi", _SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_script_file_exists() -> None:
    """The export_openapi.py script must exist at scripts/export_openapi.py."""
    assert _SCRIPT_PATH.exists(), f"Script not found: {_SCRIPT_PATH}"


def test_export_creates_file(tmp_path: Path) -> None:
    """Calling main() writes a file at the specified output path."""
    output_file = tmp_path / "openapi.json"

    # inject_service_token autouse fixture already set the env var, so we can
    # call main() directly without additional env manipulation.
    module = _load_script()
    sys.argv = ["export_openapi.py", "--output", str(output_file)]
    module.main()

    assert output_file.exists(), "Output file was not created"


def test_export_creates_parent_dirs(tmp_path: Path) -> None:
    """main() creates any missing parent directories before writing the file."""
    output_file = tmp_path / "nested" / "dir" / "openapi.json"

    module = _load_script()
    sys.argv = ["export_openapi.py", "--output", str(output_file)]
    module.main()

    assert output_file.exists(), "Output file was not created inside nested dirs"


def test_export_valid_json(tmp_path: Path) -> None:
    """The output file must contain valid JSON."""
    output_file = tmp_path / "openapi.json"

    module = _load_script()
    sys.argv = ["export_openapi.py", "--output", str(output_file)]
    module.main()

    raw = output_file.read_text(encoding="utf-8")
    # Must not raise
    parsed = json.loads(raw)
    assert isinstance(parsed, dict)


def test_export_openapi_top_level_keys(tmp_path: Path) -> None:
    """The JSON must contain the required OpenAPI 3.x top-level keys."""
    output_file = tmp_path / "openapi.json"

    module = _load_script()
    sys.argv = ["export_openapi.py", "--output", str(output_file)]
    module.main()

    schema = json.loads(output_file.read_text(encoding="utf-8"))

    assert "openapi" in schema, "Missing 'openapi' key"
    assert "info" in schema, "Missing 'info' key"
    assert "paths" in schema, "Missing 'paths' key"
    assert schema["openapi"].startswith("3."), f"Expected OpenAPI 3.x, got: {schema['openapi']}"


def test_export_required_schemas_present(tmp_path: Path) -> None:
    """components/schemas must include ExtractResponse, ErrorResponse, and ErrorCode."""
    output_file = tmp_path / "openapi.json"

    module = _load_script()
    sys.argv = ["export_openapi.py", "--output", str(output_file)]
    module.main()

    schema = json.loads(output_file.read_text(encoding="utf-8"))
    components_schemas = schema.get("components", {}).get("schemas", {})

    for required_schema in ("ExtractResponse", "ErrorResponse", "ErrorCode"):
        assert required_schema in components_schemas, (
            f"'{required_schema}' not found in components/schemas. "
            f"Found: {list(components_schemas.keys())}"
        )


def test_error_response_ref_points_to_components(tmp_path: Path) -> None:
    """ErrorResponse.$ref must point to #/components/schemas/ErrorCode, not #/$defs/."""
    output_file = tmp_path / "openapi.json"

    module = _load_script()
    sys.argv = ["export_openapi.py", "--output", str(output_file)]
    module.main()

    with open(output_file) as f:
        schema = json.load(f)

    # No dangling $defs in the document
    assert "$defs" not in json.dumps(schema), "Dangling $defs found in output"

    # ErrorResponse.code must reference ErrorCode via components/schemas
    error_response = schema["components"]["schemas"]["ErrorResponse"]
    code_ref = error_response["properties"]["code"]["$ref"]
    assert code_ref == "#/components/schemas/ErrorCode", f"Broken ref: {code_ref}"


def test_export_via_subprocess(tmp_path: Path) -> None:
    """Running the script via subprocess (uv run python ...) must succeed."""
    output_file = tmp_path / "subprocess_openapi.json"

    repo_root = _SCRIPT_PATH.parent.parent  # services/markitdown-extractor/
    result = subprocess.run(
        [
            "uv",
            "run",
            "python",
            str(_SCRIPT_PATH),
            "--output",
            str(output_file),
        ],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )

    assert result.returncode == 0, (
        f"Script exited with code {result.returncode}.\n"
        f"stdout: {result.stdout}\n"
        f"stderr: {result.stderr}"
    )
    assert output_file.exists(), "Subprocess run did not produce an output file"

    schema = json.loads(output_file.read_text(encoding="utf-8"))
    components_schemas = schema.get("components", {}).get("schemas", {})

    for required_schema in ("ExtractResponse", "ErrorResponse", "ErrorCode"):
        assert required_schema in components_schemas, (
            f"'{required_schema}' not found after subprocess run"
        )
