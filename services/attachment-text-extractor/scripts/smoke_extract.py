#!/usr/bin/env python3
"""Smoke-test helper for the container CI check.

Two roles, one file, so the CI job needs no extra tooling:

``generate``
    Run on the host (dev extra installed). Writes a small PDF and a small DOCX
    that each contain a known marker text.

``readyz`` / ``extract``
    Run INSIDE the container, which has no network (``--network none``), so no
    published port exists. The file is piped into ``docker exec -i <name>
    python -c "$(cat scripts/smoke_extract.py)" extract ...``; only the standard
    library is imported on this path, and the Bearer token comes from the
    container's own environment.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE_URL = "http://127.0.0.1:8000"
PDF_MARKER = "Smoke PDF marker"
DOCX_MARKER = "Smoke DOCX marker"
SAMPLES = (
    ("sample.pdf", "application/pdf", PDF_MARKER),
    ("sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", DOCX_MARKER),
)
REQUEST_TIMEOUT_S = 90


def build_multipart(filename: str, mime: str, data: bytes) -> tuple[bytes, str]:
    """Return (body, content_type) for a single ``file`` form field."""
    boundary = uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    return head + data + tail, f"multipart/form-data; boundary={boundary}"


def check_readyz(status: int, body: bytes) -> str | None:
    """Return an error message, or None when the readiness response is ``ready``."""
    if status != 200:
        return f"/readyz returned HTTP {status}"
    try:
        payload = json.loads(body)
    except ValueError:
        return "/readyz body is not JSON"
    if not isinstance(payload, dict) or payload.get("status") != "ready":
        return f"/readyz status is not ready: {payload!r}"
    return None


def check_extract(status: int, body: bytes, expect: str) -> str | None:
    """Return an error message, or None when the extraction succeeded and contains ``expect``."""
    if status != 200:
        return f"/extract returned HTTP {status}"
    try:
        payload = json.loads(body)
        text = "\n".join(page["content"] for page in payload["pages"])
    except (ValueError, KeyError, TypeError):
        return "/extract body is not a valid ExtractResponse"
    if expect not in text:
        return f"/extract result does not contain {expect!r}"
    return None


def _send(request: urllib.request.Request) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def run_readyz(base_url: str) -> int:
    status, body = _send(urllib.request.Request(f"{base_url}/readyz"))  # noqa: S310
    error = check_readyz(status, body)
    print(error or "readyz: ready")  # noqa: T201
    return 1 if error else 0


def run_extract(base_url: str, filename: str, mime: str, expect: str, data: bytes) -> int:
    token = os.environ.get("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "")
    body, content_type = build_multipart(filename, mime, data)
    request = urllib.request.Request(  # noqa: S310
        f"{base_url}/extract",
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
    )
    status, response_body = _send(request)
    error = check_extract(status, response_body, expect)
    print(error or f"extract {filename}: ok")  # noqa: T201
    return 1 if error else 0


def run_generate(out_dir: Path) -> int:
    # Imported lazily: the in-container path must stay standard-library only.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))
    from fixture_files import make_docx, make_text_pdf  # noqa: PLC0415

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "sample.pdf").write_bytes(make_text_pdf([PDF_MARKER]))
    (out_dir / "sample.docx").write_bytes(make_docx(DOCX_MARKER))
    print(f"samples written to {out_dir}")  # noqa: T201
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    gen = sub.add_parser("generate")
    gen.add_argument("--out-dir", required=True, type=Path)
    ready = sub.add_parser("readyz")
    ready.add_argument("--base-url", default=BASE_URL)
    extract = sub.add_parser("extract", help="POST the bytes on stdin to /extract")
    extract.add_argument("--base-url", default=BASE_URL)
    extract.add_argument("--filename", required=True)
    extract.add_argument("--mime", required=True)
    extract.add_argument("--expect", required=True)
    args = parser.parse_args(argv)

    if args.command == "generate":
        return run_generate(args.out_dir)
    if args.command == "readyz":
        return run_readyz(args.base_url)
    return run_extract(args.base_url, args.filename, args.mime, args.expect, sys.stdin.buffer.read())


if __name__ == "__main__":
    sys.exit(main())
