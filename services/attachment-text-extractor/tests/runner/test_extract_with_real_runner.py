"""POST /extract through the real ConversionRunner (forkserver + child process)."""

from __future__ import annotations

from io import BytesIO

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.config import Settings
from app.middleware.bearer_auth import BearerAuthMiddleware
from app.routers.extract import router as extract_router
from app.runner import ConversionRunner

TOKEN = "real-runner-token"  # noqa: S105 — test credential


@pytest.mark.usefixtures("isolated_forkserver")
def test_plain_text_is_extracted_through_a_child_process() -> None:
    app = FastAPI()
    app.include_router(extract_router)
    app.add_middleware(BearerAuthMiddleware, token=TOKEN)
    app.state.runner = ConversionRunner.from_settings(Settings())
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
