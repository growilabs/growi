"""POST /extract through the real ConversionRunner (forkserver + child process)."""

from __future__ import annotations

import os
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.config import Settings
from app.limits import Limits
from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers.extract import router as extract_router
from app.runner import ConversionRunner

TOKEN = "real-runner-token"  # noqa: S105 — test credential
TOKEN_ENV = "ATTACHMENT_EXTRACTOR_SERVICE_TOKEN"


@pytest.mark.usefixtures("isolated_forkserver")
def test_plain_text_is_extracted_through_a_child_process() -> None:
    app = FastAPI()
    app.include_router(extract_router)
    app.add_middleware(BearerAuthMiddleware, token=TOKEN)
    settings = Settings()
    app.state.runner = ConversionRunner.from_settings(settings)
    app.state.limits = Limits.from_settings(settings)
    with TestClient(app, raise_server_exceptions=True) as client:
        response = client.post(
            "/extract",
            headers={"Authorization": f"Bearer {TOKEN}"},
            files={"file": ("a.txt", BytesIO(b"hello from a child process"), "text/plain")},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["pages"][0]["content"] == "hello from a child process"
    assert body["extractedCharacters"] == len("hello from a child process")


@pytest.mark.usefixtures("isolated_forkserver")
def test_service_token_does_not_reach_the_forkserver_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    # Every conversion child forks from the forkserver and shares its environment.
    from app.main import create_app

    monkeypatch.setenv(TOKEN_ENV, TOKEN)
    app = create_app()
    with TestClient(app) as client:
        assert (
            client.post(
                "/extract", headers={"Authorization": f"Bearer {TOKEN}"}, files={"file": ("a.txt", b"still authorised")}
            ).json()["pages"][0]["content"]
            == "still authorised"
        )
        pid = app.state.runner.readiness().forkserver_pid
        assert pid is not None
        environ = Path(f"/proc/{pid}/environ").read_bytes()
    assert TOKEN.encode() not in environ
    assert TOKEN_ENV.encode() not in environ
    assert TOKEN_ENV not in os.environ
