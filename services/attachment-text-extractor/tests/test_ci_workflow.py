"""Static checks of the dedicated CI workflow (.github/workflows/attachment-text-extractor.yml).

Running the workflow needs GitHub; these tests only parse the file. They also
guard the rule in .claude/rules/github-actions-workflows.md: an ``if: |`` block is
literal expression text, so a comment or an odd number of quotes breaks the
whole file.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

WORKFLOW = Path(__file__).parents[3] / ".github" / "workflows" / "attachment-text-extractor.yml"
SERVICE_PATH = "services/attachment-text-extractor"


@pytest.fixture(scope="module")
def raw() -> str:
    if not WORKFLOW.is_file():
        pytest.skip(f"workflow not found at {WORKFLOW} (service checked out outside the monorepo)")
    return WORKFLOW.read_text()


@pytest.fixture(scope="module")
def workflow(raw: str) -> dict:
    return yaml.safe_load(raw)


@pytest.fixture(scope="module")
def triggers(workflow: dict) -> dict:
    # YAML 1.1 parses the bare key `on` as boolean True.
    return workflow.get("on", workflow.get(True))


@pytest.fixture(scope="module")
def job(workflow: dict) -> dict:
    jobs = workflow["jobs"]
    assert len(jobs) == 1
    return next(iter(jobs.values()))


@pytest.fixture(scope="module")
def run_steps(job: dict) -> list[str]:
    return [step["run"] for step in job["steps"] if "run" in step]


def _step_index(run_steps: list[str], fragment: str) -> int:
    matches = [i for i, run in enumerate(run_steps) if fragment in run]
    assert matches, f"no step runs {fragment!r}"
    return matches[0]


class TestStructure:
    def test_workflow_and_every_job_are_named(self, workflow: dict) -> None:
        assert workflow["name"].strip()
        for job_id, job in workflow["jobs"].items():
            assert job.get("name", "").strip(), job_id

    def test_every_job_has_timeout_and_read_only_permissions(self, workflow: dict) -> None:
        assert workflow["permissions"] == {"contents": "read"}
        for job_id, job in workflow["jobs"].items():
            assert isinstance(job.get("timeout-minutes"), int), job_id
            assert job["permissions"] == {"contents": "read"}, job_id

    def test_concurrency_cancels_superseded_runs(self, workflow: dict) -> None:
        assert workflow["concurrency"]["cancel-in-progress"] is True

    def test_uv_version_matches_the_dockerfile_pin(self, job: dict) -> None:
        dockerfile = (Path(__file__).parents[1] / "Dockerfile").read_text()
        pinned = re.search(r"ghcr\.io/astral-sh/uv:(\d+\.\d+\.\d+)", dockerfile)
        assert pinned
        setup = next(s for s in job["steps"] if str(s.get("uses", "")).startswith("astral-sh/setup-uv@"))
        assert setup["with"]["version"] == pinned.group(1)
        assert setup["with"]["cache-dependency-glob"] == f"{SERVICE_PATH}/uv.lock"


class TestTriggers:
    def test_push_runs_for_the_service_and_its_contract_inputs(self, triggers: dict) -> None:
        paths = triggers["push"]["paths"]
        for expected in (
            f"{SERVICE_PATH}/**",
            "packages/attachment-text-extractor-client/openapi.json",
            "infra/docker/compose.yaml",
            ".github/workflows/attachment-text-extractor.yml",
        ):
            assert expected in paths

    def test_merge_queue_branches_are_ignored_like_sibling_workflows(self, triggers: dict) -> None:
        assert "mergify/merge-queue/**" in triggers["push"]["branches-ignore"]

    def test_can_be_started_manually(self, triggers: dict) -> None:
        assert "workflow_dispatch" in triggers


class TestStepOrder:
    def test_steps_run_in_the_required_order(self, run_steps: list[str]) -> None:
        order = [
            "uv sync --locked",
            "ruff check",
            "ruff format --check",
            "pytest",
            "docker build",
            "docker image inspect",
            "docker run",
            "readyz",
            "extract",
            "export_openapi.py",
            "check_openapi_drift.py",
        ]
        indexes = [_step_index(run_steps, fragment) for fragment in order]
        assert indexes == sorted(indexes)
        assert len(set(indexes[:4])) == 4

    def test_image_size_limit_is_400mb(self, workflow: dict, run_steps: list[str]) -> None:
        assert workflow["env"]["IMAGE_MAX_BYTES"] == "400000000"
        check = run_steps[_step_index(run_steps, "docker image inspect")]
        assert "--format '{{.Size}}'" in check
        assert '-le "$IMAGE_MAX_BYTES"' in check

    def test_container_runs_read_only_as_uid_10001_without_network(self, run_steps: list[str]) -> None:
        run = run_steps[_step_index(run_steps, "docker run")]
        flags = ("--read-only", "--user 10001:10001", "--network none", "--init", "--tmpfs /tmp:rw,size=64m,mode=1777")
        for flag in flags:
            assert flag in run
        assert "-p " not in run

    def test_token_is_generated_at_run_time(self, run_steps: list[str]) -> None:
        run = run_steps[_step_index(run_steps, "docker run")]
        assert "secrets.token_hex" in run
        assert "secrets." not in run.replace("secrets.token_hex", "")

    def test_both_formats_are_extracted(self, run_steps: list[str]) -> None:
        run = run_steps[_step_index(run_steps, "extract \\")]
        assert "sample.pdf" in run
        assert "sample.docx" in run

    def test_openapi_drift_check_compares_with_the_committed_contract(self, run_steps: list[str]) -> None:
        run = run_steps[_step_index(run_steps, "check_openapi_drift.py")]
        assert "packages/attachment-text-extractor-client/openapi.json" in run


def _if_block_violations(raw: str) -> list[str]:
    lines = raw.splitlines()
    found: list[str] = []
    for i, line in enumerate(lines):
        match = re.match(r"^(\s*)(?:-\s+)?if:\s*[|>][+-]?\s*$", line)
        if not match:
            continue
        key_indent = len(match.group(1))
        for body in lines[i + 1 :]:
            if body.strip() and len(body) - len(body.lstrip()) <= key_indent:
                break
            if body.strip().startswith("#"):
                found.append(f"comment inside if block: {body!r}")
            if body.count("'") % 2 == 1:
                found.append(f"odd number of single quotes inside if block: {body!r}")
    return found


class TestWorkflowTextSafety:
    def test_if_block_scalars_have_no_comment_or_unbalanced_quote(self, raw: str) -> None:
        assert _if_block_violations(raw) == []

    def test_scanner_flags_a_comment_with_an_apostrophe_inside_an_if_block(self) -> None:
        sample = "jobs:\n  a:\n    if: |\n      x == 1\n      # the bot's branch\n    runs-on: y\n"
        assert len(_if_block_violations(sample)) == 2

    def test_scanner_ignores_a_comment_above_the_if_key(self) -> None:
        sample = "jobs:\n  # the bot's branch\n  a:\n    if: |\n      x == 1\n    runs-on: y\n"
        assert _if_block_violations(sample) == []

    def test_no_literal_secret_or_token_values(self, raw: str) -> None:
        assert not re.search(r"(?i)(token|password|secret)\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}", raw.replace("${{", ""))
        assert not re.search(r"gh[pousr]_[A-Za-z0-9]{20,}", raw)
