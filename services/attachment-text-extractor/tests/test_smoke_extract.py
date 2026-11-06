"""Tests for the CI helper scripts: scripts/smoke_extract.py and scripts/check_openapi_drift.py."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).parents[1] / "scripts"


def _load(name: str):  # noqa: ANN202
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


smoke = _load("smoke_extract")
drift = _load("check_openapi_drift")


class TestResponseChecks:
    def test_readyz_accepts_only_status_ready(self) -> None:
        assert smoke.check_readyz(200, b'{"status": "ready"}') is None
        assert smoke.check_readyz(503, b'{"status": "not_ready"}')
        assert smoke.check_readyz(200, b'{"status": "not_ready"}')
        assert smoke.check_readyz(200, b"nope")

    def test_extract_requires_200_and_the_marker(self) -> None:
        body = json.dumps({"pages": [{"content": "a Smoke PDF marker b"}]}).encode()
        assert smoke.check_extract(200, body, "Smoke PDF marker") is None
        assert smoke.check_extract(200, body, "other")
        assert smoke.check_extract(422, body, "Smoke PDF marker")
        assert smoke.check_extract(200, b"{}", "x")


class TestMultipart:
    def test_body_carries_the_file_field_and_bytes(self) -> None:
        body, content_type = smoke.build_multipart("a.pdf", "application/pdf", b"\x00data")
        boundary = content_type.split("boundary=")[1]
        assert body.startswith(f"--{boundary}\r\n".encode())
        assert b'name="file"; filename="a.pdf"' in body
        assert b"\r\n\r\n\x00data\r\n" in body
        assert body.endswith(f"--{boundary}--\r\n".encode())


class TestGeneratedSamplesAreExtractable:
    @pytest.mark.parametrize(("filename", "mime", "marker"), smoke.SAMPLES)
    def test_service_extracts_the_marker(self, tmp_path: Path, client, test_token, filename, mime, marker) -> None:
        assert smoke.main(["generate", "--out-dir", str(tmp_path)]) == 0
        body, content_type = smoke.build_multipart(filename, mime, (tmp_path / filename).read_bytes())
        response = client.post(
            "/extract",
            headers={"Authorization": f"Bearer {test_token}", "Content-Type": content_type},
            content=body,
        )
        assert smoke.check_extract(response.status_code, response.content, marker) is None


class TestOpenapiDrift:
    def test_formatting_differences_are_not_drift(self, tmp_path: Path) -> None:
        generated, committed = tmp_path / "g.json", tmp_path / "c.json"
        generated.write_text('{\n  "tags": [\n    "health"\n  ]\n}\n')
        committed.write_text('{ "tags": ["health"] }\n')
        assert drift.main([str(generated), str(committed)]) == 0

    def test_content_difference_is_drift(self, tmp_path: Path) -> None:
        generated, committed = tmp_path / "g.json", tmp_path / "c.json"
        generated.write_text('{"tags": ["health", "extract"]}')
        committed.write_text('{"tags": ["health"]}')
        assert drift.main([str(generated), str(committed)]) == 1

    def test_committed_contract_matches_the_current_export(self, tmp_path: Path) -> None:
        committed = Path(__file__).parents[3] / "packages" / "attachment-text-extractor-client" / "openapi.json"
        if not committed.is_file():
            pytest.skip("OpenAPI contract not found (service checked out outside the monorepo)")
        export = _load("export_openapi")
        generated = tmp_path / "openapi.json"
        import sys  # noqa: PLC0415

        old_argv, sys.argv = sys.argv, ["export_openapi.py", "--output", str(generated)]
        try:
            export.main()
        finally:
            sys.argv = old_argv
        assert drift.main([str(generated), str(committed)]) == 0
