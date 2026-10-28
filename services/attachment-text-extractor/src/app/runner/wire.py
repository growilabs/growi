"""Parent <-> child hand-off: length-prefixed frames and the result JSON (design: 親子間の受け渡し).

Every frame is a 4-byte big-endian length followed by the body. The parent sends the file
bytes as one frame; the child sends the result JSON as one frame. Nothing here uses pickle,
so a child hijacked by a malicious file cannot run code in the parent.
"""

from __future__ import annotations

import json
import re
import struct
from io import RawIOBase
from typing import Any, Final, get_args

from app.conversion.errors import ConversionFailure, FailureKind
from app.conversion.results import ConversionOutcome, ConversionSuccess
from app.schemas import PageInfo

FRAME_HEADER_SIZE: Final = 4
MAX_FRAME_LENGTH: Final = 0xFFFF_FFFF
_HEADER = struct.Struct(">I")
_CHUNK_SIZE: Final = 64 * 1024

# Kinds the parent decides on its own (timeout / crashed / memory_exceeded) are not accepted
# from the child: a child must not be able to impersonate the parent's own classification.
CHILD_REPORTABLE_KINDS: Final[frozenset[FailureKind]] = frozenset(
    {"unsupported", "encrypted", "malformed", "limit_exceeded", "result_too_large", "internal"}
)
assert CHILD_REPORTABLE_KINDS <= frozenset(get_args(FailureKind))  # noqa: S101 - import-time invariant

MAX_DETAIL_CHARS: Final = 512
MAX_PAGE_NUMBER: Final = 2**31 - 1
_ENVELOPE_OVERHEAD_BYTES: Final = 1024 * 1024
_LONE_SURROGATE = re.compile("[\ud800-\udfff]")
_SUCCESS_KEYS: Final = frozenset({"ok", "pages", "mimeType"})
_FAILURE_KEYS: Final = frozenset({"ok", "kind", "detail"})
_PAGE_KEYS: Final = frozenset({"pageNumber", "label", "content"})


class WireProtocolError(Exception):
    """A frame or result that does not follow the protocol; the parent treats it as an abnormal child."""


def max_result_frame_bytes(max_result_bytes: int) -> int:
    """Ceiling for the encoded result frame body.

    MAX_RESULT_BYTES bounds the UTF-8 content (checked in ConversionCore); JSON escaping
    (`\\n` -> 2 bytes) and the envelope add to it, so the frame gets this ceiling instead.
    """
    return min(2 * max_result_bytes + _ENVELOPE_OVERHEAD_BYTES, MAX_FRAME_LENGTH)


def encode_frame_header(length: int) -> bytes:
    if not 0 <= length <= MAX_FRAME_LENGTH:
        raise ValueError("frame length does not fit the 4-byte header")
    return _HEADER.pack(length)


def decode_frame_header(header: bytes, max_length: int) -> int:
    """Reject an over-limit length before the caller allocates anything for the body."""
    if len(header) != FRAME_HEADER_SIZE:
        raise WireProtocolError("truncated frame header")
    (length,) = _HEADER.unpack(header)
    if length > max_length:
        raise WireProtocolError("frame length exceeds the allowed maximum")
    return length


def read_frame(stream: RawIOBase, max_length: int) -> bytes:
    """Read one frame from an unbuffered binary stream, tolerating short reads."""
    length = decode_frame_header(_read_exact(stream, FRAME_HEADER_SIZE), max_length)
    return bytes(_read_exact(stream, length))


def write_frame(stream: RawIOBase, body: bytes) -> None:
    """Write one frame in fixed-size chunks, tolerating short writes; the body is never copied."""
    _write_all(stream, memoryview(encode_frame_header(len(body))))
    view = memoryview(body)
    for start in range(0, len(view), _CHUNK_SIZE):
        _write_all(stream, view[start : start + _CHUNK_SIZE])


def _read_exact(stream: RawIOBase, length: int) -> bytearray:
    buffer = bytearray(length)
    view = memoryview(buffer)
    received = 0
    while received < length:
        count = stream.readinto(view[received:])
        if not count:
            raise WireProtocolError("stream ended before the frame was complete")
        received += count
    return buffer


def _write_all(stream: RawIOBase, view: memoryview) -> None:
    while view:
        written = stream.write(view)
        if written is None:
            raise WireProtocolError("non-blocking stream is not supported here")
        view = view[written:]


def encode_success(success: ConversionSuccess) -> bytes:
    """Strict UTF-8: a lone surrogate raises UnicodeEncodeError, which the child reports as a failure."""
    document = {
        "ok": True,
        "pages": [{"pageNumber": p.pageNumber, "label": p.label, "content": p.content} for p in success.pages],
        "mimeType": success.mime_type,
    }
    return _dumps(document)


def encode_failure(failure: ConversionFailure) -> bytes:
    return _dumps({"ok": False, "kind": failure.kind, "detail": failure.detail})


def _dumps(document: dict[str, Any]) -> bytes:
    # ensure_ascii=False keeps Japanese at 3 bytes per character instead of 6.
    return json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")


def decode_result(body: bytes) -> ConversionOutcome:
    try:
        text = body.decode("utf-8")
        document = json.loads(text, parse_constant=_reject_constant, object_pairs_hook=_reject_duplicate_keys)
    except (UnicodeDecodeError, ValueError, RecursionError):
        # ValueError covers JSONDecodeError and integers beyond the int-digit limit.
        raise WireProtocolError("result is not valid UTF-8 JSON") from None
    if not isinstance(document, dict):
        raise WireProtocolError("result is not a JSON object")
    ok = document.get("ok")
    if ok is True:
        return _decode_success(document)
    if ok is False:
        return _decode_failure(document)
    raise WireProtocolError("result has no boolean ok field")


def _reject_constant(_name: str) -> None:
    raise WireProtocolError("NaN / Infinity are not allowed")


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    document = dict(pairs)
    if len(document) != len(pairs):
        raise WireProtocolError("duplicate key in result")
    return document


def _decode_success(document: dict[str, Any]) -> ConversionSuccess:
    if document.keys() != _SUCCESS_KEYS:
        raise WireProtocolError("success result has unexpected fields")
    pages = document["pages"]
    if not isinstance(pages, list) or not pages:
        raise WireProtocolError("success result needs at least one page")
    mime_type = _require_str(document["mimeType"], "mimeType")
    if not mime_type:
        raise WireProtocolError("mimeType is empty")
    return ConversionSuccess(pages=[_decode_page(page) for page in pages], mime_type=mime_type)


def _decode_page(page: object) -> PageInfo:
    if not isinstance(page, dict) or page.keys() != _PAGE_KEYS:
        raise WireProtocolError("page has unexpected shape")
    number = page["pageNumber"]
    # `type(...) is int` rejects bool, which isinstance would accept.
    if number is not None and (type(number) is not int or not 1 <= number <= MAX_PAGE_NUMBER):
        raise WireProtocolError("pageNumber is not a positive integer")
    label = page["label"]
    if label is not None:
        _require_str(label, "label")
    content = _require_str(page["content"], "content")
    return PageInfo(pageNumber=number, label=label, content=content)


def _decode_failure(document: dict[str, Any]) -> ConversionFailure:
    if document.keys() != _FAILURE_KEYS:
        raise WireProtocolError("failure result has unexpected fields")
    kind = document["kind"]
    if not isinstance(kind, str) or kind not in CHILD_REPORTABLE_KINDS:
        raise WireProtocolError("failure kind is not one the child may report")
    detail = _require_str(document["detail"], "detail")
    if len(detail) > MAX_DETAIL_CHARS:
        raise WireProtocolError("failure detail is too long")
    return ConversionFailure(kind=kind, detail=detail)


def _require_str(value: object, field: str) -> str:
    if not isinstance(value, str):
        raise WireProtocolError(f"{field} is not a string")
    # `\udXXX` escapes decode to lone surrogates, which would break the HTTP response later.
    if _LONE_SURROGATE.search(value):
        raise WireProtocolError(f"{field} contains a lone surrogate")
    return value
