"""Parent <-> child hand-off format: length-prefixed frames and the result JSON (Req 2.5, 2.7)."""

import io
import json
import struct

import pytest

from app.conversion.errors import ConversionFailure
from app.conversion.results import ConversionSuccess
from app.runner import wire
from app.runner.wire import WireProtocolError
from app.schemas import PageInfo


class _TrickleReader(io.RawIOBase):
    """Returns at most `step` bytes per read, like a pipe delivering partial reads."""

    def __init__(self, data: bytes, step: int) -> None:
        self._data = data
        self._pos = 0
        self._step = step

    def readable(self) -> bool:
        return True

    def readinto(self, buffer) -> int:  # noqa: ANN001
        chunk = self._data[self._pos : self._pos + min(self._step, len(buffer))]
        buffer[: len(chunk)] = chunk
        self._pos += len(chunk)
        return len(chunk)


class _TrickleWriter(io.RawIOBase):
    """Accepts at most `step` bytes per write, like a pipe accepting partial writes."""

    def __init__(self, step: int) -> None:
        self.data = bytearray()
        self._step = step

    def writable(self) -> bool:
        return True

    def write(self, buffer) -> int:  # noqa: ANN001
        chunk = bytes(buffer[: self._step])
        self.data += chunk
        return len(chunk)


def _framed(body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + body


# --- frames ---------------------------------------------------------------


def test_header_is_four_bytes_big_endian():
    assert wire.encode_frame_header(0x01020304) == b"\x01\x02\x03\x04"


def test_frame_round_trips_through_partial_writes_and_reads():
    body = bytes(range(256)) * 1000
    writer = _TrickleWriter(step=777)
    wire.write_frame(writer, body)
    assert bytes(writer.data) == _framed(body)

    assert wire.read_frame(_TrickleReader(bytes(writer.data), step=3), max_length=len(body)) == body


def test_empty_frame_round_trips():
    writer = _TrickleWriter(step=1)
    wire.write_frame(writer, b"")
    assert wire.read_frame(_TrickleReader(bytes(writer.data), step=1), max_length=0) == b""


def test_length_over_the_maximum_is_rejected_from_the_header_alone():
    # Only the header exists: a reader that tried to allocate/read the body would fail differently.
    stream = _TrickleReader(b"\xff\xff\xff\xff", step=4)
    with pytest.raises(WireProtocolError, match="exceeds"):
        wire.read_frame(stream, max_length=50 * 1024 * 1024)


def test_truncated_header_is_rejected():
    with pytest.raises(WireProtocolError):
        wire.read_frame(_TrickleReader(b"\x00\x00", step=1), max_length=10)


def test_truncated_body_is_rejected():
    with pytest.raises(WireProtocolError):
        wire.read_frame(_TrickleReader(_framed(b"abcdef")[:-2], step=2), max_length=10)


def test_header_cannot_encode_more_than_four_bytes_of_length():
    with pytest.raises(ValueError):
        wire.encode_frame_header(2**32)


def test_result_frame_ceiling_leaves_room_for_json_escaping():
    limit = 16 * 1024 * 1024
    assert wire.max_result_frame_bytes(limit) >= 2 * limit
    assert wire.max_result_frame_bytes(2**40) == 0xFFFF_FFFF


# --- result JSON ------------------------------------------------------------


def test_success_round_trips_and_uses_the_design_field_names():
    success = ConversionSuccess(
        pages=[
            PageInfo(pageNumber=1, label="1", content="情報システム\n計画"),
            PageInfo(pageNumber=None, label=None, content=""),
        ],
        mime_type="application/pdf",
    )
    body = wire.encode_success(success)

    assert json.loads(body) == {
        "ok": True,
        "pages": [
            {"pageNumber": 1, "label": "1", "content": "情報システム\n計画"},
            {"pageNumber": None, "label": None, "content": ""},
        ],
        "mimeType": "application/pdf",
    }
    # Japanese stays raw UTF-8 (3 bytes per character), not \\uXXXX escapes.
    assert "情報".encode() in body
    assert wire.decode_result(body) == success


def test_failure_round_trips():
    failure = ConversionFailure(kind="malformed", detail="pdf could not be opened")
    body = wire.encode_failure(failure)
    assert json.loads(body) == {"ok": False, "kind": "malformed", "detail": "pdf could not be opened"}
    assert wire.decode_result(body) == failure


def test_lone_surrogate_cannot_be_encoded():
    success = ConversionSuccess(
        pages=[PageInfo(pageNumber=None, label=None, content="a\ud800b")], mime_type="text/plain"
    )
    with pytest.raises(UnicodeEncodeError):
        wire.encode_success(success)


def _page(**overrides: object) -> dict[str, object]:
    return {"pageNumber": 1, "label": "1", "content": "x", **overrides}


def _success_doc(**overrides: object) -> dict[str, object]:
    return {"ok": True, "pages": [_page()], "mimeType": "application/pdf", **overrides}


@pytest.mark.parametrize(
    "body",
    [
        pytest.param(b"\xff\xfe not utf-8", id="non-utf8"),
        pytest.param(b"{not json", id="invalid-json"),
        pytest.param(b"", id="empty"),
        pytest.param(b"[]", id="not-an-object"),
        pytest.param(b'{"ok": 1, "kind": "internal", "detail": "x"}', id="ok-not-bool"),
        pytest.param(b'{"kind": "internal", "detail": "x"}', id="ok-missing"),
        pytest.param(b'{"ok": false, "ok": false, "kind": "internal", "detail": "x"}', id="duplicate-key"),
        pytest.param(
            b'{"ok": true, "pages": [{"pageNumber": NaN, "label": null, "content": ""}], "mimeType": "a"}', id="nan"
        ),
        pytest.param(
            b'{"ok": true, "pages": [{"pageNumber": ' + b"9" * 5000 + b', "label": null, "content": ""}],'
            b' "mimeType": "a"}',
            id="int-beyond-digit-limit",
        ),
        pytest.param(b"[" * 100_000 + b"]" * 100_000, id="deep-nesting"),
        pytest.param(
            b'{"ok": true, "pages": [{"pageNumber": 1, "label": "\\ud800", "content": ""}], "mimeType": "a"}',
            id="escaped-lone-surrogate",
        ),
    ],
)
def test_malformed_bodies_raise_the_protocol_error(body: bytes):
    with pytest.raises(WireProtocolError):
        wire.decode_result(body)


@pytest.mark.parametrize(
    "document",
    [
        pytest.param(_success_doc(extra=1), id="extra-top-level-field"),
        pytest.param({"ok": True, "pages": [_page()]}, id="missing-mimeType"),
        pytest.param(_success_doc(mimeType=""), id="empty-mimeType"),
        pytest.param(_success_doc(mimeType=5), id="mimeType-not-str"),
        pytest.param(_success_doc(pages=[]), id="no-pages"),
        pytest.param(_success_doc(pages="x"), id="pages-not-list"),
        pytest.param(_success_doc(pages=["x"]), id="page-not-object"),
        pytest.param(_success_doc(pages=[{**_page(), "extra": 1}]), id="extra-page-field"),
        pytest.param(_success_doc(pages=[{"pageNumber": 1, "label": "1"}]), id="missing-content"),
        pytest.param(_success_doc(pages=[_page(pageNumber=True)]), id="pageNumber-bool"),
        pytest.param(_success_doc(pages=[_page(pageNumber=1.0)]), id="pageNumber-float"),
        pytest.param(_success_doc(pages=[_page(pageNumber="1")]), id="pageNumber-str"),
        pytest.param(_success_doc(pages=[_page(pageNumber=0)]), id="pageNumber-zero"),
        pytest.param(_success_doc(pages=[_page(pageNumber=-1)]), id="pageNumber-negative"),
        pytest.param(_success_doc(pages=[_page(pageNumber=2**31)]), id="pageNumber-huge"),
        pytest.param(_success_doc(pages=[_page(label=3)]), id="label-not-str"),
        pytest.param(_success_doc(pages=[_page(content=None)]), id="content-null"),
        pytest.param({"ok": False, "kind": "internal"}, id="failure-missing-detail"),
        pytest.param({"ok": False, "kind": "internal", "detail": "x", "trace": "y"}, id="failure-extra-field"),
        pytest.param({"ok": False, "kind": "no_such_kind", "detail": "x"}, id="unknown-kind"),
        pytest.param({"ok": False, "kind": "timeout", "detail": "x"}, id="parent-only-timeout"),
        pytest.param({"ok": False, "kind": "crashed", "detail": "x"}, id="parent-only-crashed"),
        pytest.param({"ok": False, "kind": "memory_exceeded", "detail": "x"}, id="parent-only-memory"),
        pytest.param({"ok": False, "kind": "internal", "detail": 1}, id="detail-not-str"),
        pytest.param({"ok": False, "kind": "internal", "detail": "x" * 10_000}, id="detail-too-long"),
    ],
)
def test_schema_violations_raise_the_protocol_error(document: dict[str, object]):
    with pytest.raises(WireProtocolError):
        wire.decode_result(json.dumps(document).encode())


@pytest.mark.parametrize("kind", sorted(wire.CHILD_REPORTABLE_KINDS))
def test_every_kind_the_child_may_report_is_accepted(kind: str):
    assert wire.decode_result(wire.encode_failure(ConversionFailure(kind=kind, detail="d"))).kind == kind
