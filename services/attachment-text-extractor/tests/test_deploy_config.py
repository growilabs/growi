"""Static checks of the container deployment config (Dockerfile and compose).

Building and running the image needs docker, so these tests only parse the
files; the runtime behaviour is verified by the container smoke test in CI.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

SERVICE_DIR = Path(__file__).parents[1]
DOCKERFILE = SERVICE_DIR / "Dockerfile"
COMPOSE = Path(__file__).parents[3] / "infra" / "docker" / "compose.yaml"
SERVICE_NAME = "attachment-text-extractor"


def _logical_lines(text: str) -> list[str]:
    """Join backslash continuations and drop comments and blank lines."""
    joined = re.sub(r"\\\n", " ", text)
    return [ln.strip() for ln in joined.splitlines() if ln.strip() and not ln.strip().startswith("#")]


def _final_stage_lines() -> list[str]:
    lines = _logical_lines(DOCKERFILE.read_text())
    last_from = max(i for i, ln in enumerate(lines) if ln.upper().startswith("FROM "))
    return lines[last_from:]


def _final_stage_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in _final_stage_lines():
        if line.upper().startswith("ENV "):
            for key, value in re.findall(r'(\w+)=("[^"]*"|\S+)', line[4:]):
                env[key] = value.strip('"')
    return env


@pytest.fixture(scope="module")
def compose_service() -> dict:
    if not COMPOSE.is_file():
        pytest.skip(f"compose file not found at {COMPOSE} (service checked out outside the monorepo)")
    return yaml.safe_load(COMPOSE.read_text())["services"][SERVICE_NAME]


class TestDockerfile:
    def test_uv_image_is_pinned_to_an_exact_version(self) -> None:
        refs = re.findall(r"--from=(ghcr\.io/astral-sh/uv:\S+)", DOCKERFILE.read_text())
        assert refs, "uv must be copied from the official image"
        for ref in refs:
            assert re.fullmatch(r"ghcr\.io/astral-sh/uv:\d+\.\d+\.\d+", ref), ref

    def test_base_images_are_pinned_to_a_patch_version(self) -> None:
        bases = [ln.split()[1] for ln in _logical_lines(DOCKERFILE.read_text()) if ln.upper().startswith("FROM ")]
        for base in bases:
            assert re.fullmatch(r"python:3\.12\.\d+-slim-bookworm", base), base

    def test_final_stage_pins_rayon_threads_and_tmpdir(self) -> None:
        env = _final_stage_env()
        assert env.get("RAYON_NUM_THREADS") == "1"
        assert env.get("TMPDIR") == "/tmp"

    def test_final_stage_runs_as_uid_10001(self) -> None:
        users = [ln.split()[1] for ln in _final_stage_lines() if ln.upper().startswith("USER ")]
        assert users
        assert users[-1] == "10001"

    def test_worker_count_defaults_to_one(self) -> None:
        cmd = next(ln for ln in _final_stage_lines() if ln.upper().startswith("CMD "))
        assert "${WORKERS:-1}" in cmd

    def test_production_install_excludes_the_dev_extra(self) -> None:
        sync_lines = [ln for ln in _logical_lines(DOCKERFILE.read_text()) if "uv sync" in ln]
        assert sync_lines
        for line in sync_lines:
            assert "--locked" in line
            assert "--extra" not in line
            assert "--all-extras" not in line

    def test_bytecode_is_precompiled_for_the_read_only_rootfs(self) -> None:
        env = _final_stage_env()
        assert env.get("PYTHONDONTWRITEBYTECODE") == "1"
        assert "UV_COMPILE_BYTECODE=1" in DOCKERFILE.read_text()


class TestCompose:
    def test_rootfs_is_read_only_with_tmpfs_tmp(self, compose_service: dict) -> None:
        assert compose_service["read_only"] is True
        assert any(str(t).split(":")[0] == "/tmp" for t in compose_service["tmpfs"])

    def test_runs_as_uid_10001_without_capabilities(self, compose_service: dict) -> None:
        assert str(compose_service["user"]).split(":")[0] == "10001"
        assert compose_service["cap_drop"] == ["ALL"]
        assert "no-new-privileges:true" in compose_service["security_opt"]

    def test_memory_limit_covers_the_documented_budget(self, compose_service: dict) -> None:
        # Design budget for the defaults is ~1.7GB.
        assert compose_service["mem_limit"] in ("2g", "2048m")

    def test_recommended_concurrency_and_workers(self, compose_service: dict) -> None:
        env = compose_service["environment"]
        assert str(env["WORKERS"]) == "1"
        assert str(env["MAX_CONCURRENCY"]) == "3"

    def test_has_healthcheck_and_init(self, compose_service: dict) -> None:
        assert compose_service["healthcheck"]["test"]
        assert compose_service["init"] is True

    def test_network_blocks_egress(self) -> None:
        if not COMPOSE.is_file():
            pytest.skip("compose file not found")
        networks = yaml.safe_load(COMPOSE.read_text())["networks"]
        assert networks["internal"]["internal"] is True
