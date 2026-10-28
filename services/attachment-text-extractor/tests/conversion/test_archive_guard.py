"""ArchiveGuard tests (Req 2.6). Zips are built in-test so the limits can be tiny."""

import io
import random
import struct
import tracemalloc
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.conversion.archive_guard import copy_part, inspect_archive, read_part
from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits

_MIB = 1024 * 1024
PPTX_PART = "ppt/presentation.xml"


def _limits(entries: int = 100, uncompressed_mb: int = 1) -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=1_000_000,
        max_pdf_pages=100,
        max_archive_entries=entries,
        max_archive_uncompressed_mb=uncompressed_mb,
        max_xlsx_cells=1000,
        ipynb_output_max_chars=100,
    )


def _zip(members: list[tuple[str, bytes]], compression: int = zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        for name, body in members:
            zf.writestr(name, body)
    return buf.getvalue()


@contextmanager
def _opened(data: bytes, required_part: str, limits: ConversionLimits) -> Iterator[zipfile.ZipFile]:
    archive = inspect_archive(data, required_part, limits)
    assert archive is not None, "expected the archive to be returned, got pass-through (None)"
    with archive:
        yield archive


def test_zip_with_required_part_is_returned_open() -> None:
    data = _zip([(PPTX_PART, b"<x/>"), ("other.xml", b"y")])
    with _opened(data, PPTX_PART, _limits()) as archive:
        assert archive.read(PPTX_PART) == b"<x/>"


def test_zip_without_required_part_passes_through() -> None:
    assert inspect_archive(_zip([("word/document.xml", b"<x/>")]), PPTX_PART, _limits()) is None


@pytest.mark.parametrize("data", [b"", b"plain text, not a zip", b"PK\x03\x04" + b"\x00" * 10])
def test_non_zip_or_truncated_input_passes_through(data: bytes) -> None:
    assert inspect_archive(data, PPTX_PART, _limits()) is None


def test_truncated_real_zip_passes_through() -> None:
    data = _zip([(PPTX_PART, b"<x/>" * 100)])
    assert inspect_archive(data[: len(data) // 2], PPTX_PART, _limits()) is None


def test_empty_zip_passes_through() -> None:
    assert inspect_archive(_zip([]), PPTX_PART, _limits()) is None


@pytest.mark.parametrize("fixture_name", ["docx_encrypted", "xlsx_encrypted", "pptx_encrypted"])
def test_encrypted_ooxml_is_not_a_zip_and_passes_through(fixture_name: str, request: pytest.FixtureRequest) -> None:
    assert inspect_archive(request.getfixturevalue(fixture_name), PPTX_PART, _limits()) is None


def test_entry_count_over_limit_is_limit_exceeded() -> None:
    data = _zip([(PPTX_PART, b"a")] + [(f"f{i}.xml", b"") for i in range(5)])
    with pytest.raises(ConversionError) as exc:
        inspect_archive(data, PPTX_PART, _limits(entries=5))
    assert exc.value.kind == "limit_exceeded"


def test_entry_count_at_limit_is_accepted() -> None:
    data = _zip([(PPTX_PART, b"a")] + [(f"f{i}.xml", b"") for i in range(4)])
    with _opened(data, PPTX_PART, _limits(entries=5)) as archive:
        assert archive.testzip() is None


def test_declared_uncompressed_sum_over_limit_is_limit_exceeded() -> None:
    # Two parts of 0.6 MiB each: each under the limit, the sum over it.
    chunk = b"A" * int(0.6 * 1024 * 1024)
    data = _zip([(PPTX_PART, chunk), ("big2.bin", chunk)])
    with pytest.raises(ConversionError) as exc:
        inspect_archive(data, PPTX_PART, _limits(uncompressed_mb=1))
    assert exc.value.kind == "limit_exceeded"


def test_limit_is_checked_before_the_required_part_is_looked_up() -> None:
    chunk = b"A" * (2 * 1024 * 1024)
    with pytest.raises(ConversionError) as exc:
        inspect_archive(_zip([("big.bin", chunk)]), PPTX_PART, _limits(uncompressed_mb=1))
    assert exc.value.kind == "limit_exceeded"


def test_docx_zip_bomb_fixture_is_limit_exceeded(docx_zip_bomb_path: Path) -> None:
    with pytest.raises(ConversionError) as exc:
        inspect_archive(docx_zip_bomb_path.read_bytes(), "word/document.xml", _limits(uncompressed_mb=512))
    assert exc.value.kind == "limit_exceeded"


def test_real_pptx_fixture_is_accepted(pptx_multi_slide: bytes) -> None:
    with _opened(pptx_multi_slide, PPTX_PART, _limits()) as archive:
        assert archive.testzip() is None


def test_real_xlsx_fixture_is_accepted(xlsx_multi_sheet: bytes) -> None:
    with _opened(xlsx_multi_sheet, "xl/workbook.xml", _limits()) as archive:
        assert archive.testzip() is None


def test_duplicate_required_part_passes_through() -> None:
    # Readers disagree on which duplicate wins, so anydoc gets the file untouched.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf, pytest.warns(UserWarning, match="Duplicate name"):
        zf.writestr(PPTX_PART, b"first")
        zf.writestr(PPTX_PART, b"second")
    assert inspect_archive(buf.getvalue(), PPTX_PART, _limits()) is None


def test_traversal_entry_names_are_never_written_to_disk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.chdir(tmp_path)
    data = _zip([(PPTX_PART, b"<x/>"), ("../../evil.txt", b"x"), ("/abs/evil.txt", b"x")])
    with _opened(data, PPTX_PART, _limits()) as archive:
        assert archive.testzip() is None
    assert list(tmp_path.iterdir()) == []


def test_zip64_archive_is_handled() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        with zf.open(PPTX_PART, "w", force_zip64=True) as part:
            part.write(b"<x/>")
    with _opened(buf.getvalue(), PPTX_PART, _limits()) as archive:
        assert read_part(archive, PPTX_PART, 100) == b"<x/>"


def test_read_part_returns_bytes_within_cap() -> None:
    with zipfile.ZipFile(io.BytesIO(_zip([("a.xml", b"12345")]))) as zf:
        assert read_part(zf, "a.xml", 5) == b"12345"


def test_read_part_over_cap_is_limit_exceeded() -> None:
    with zipfile.ZipFile(io.BytesIO(_zip([("a.xml", b"A" * 1000)]))) as zf:
        with pytest.raises(ConversionError) as exc:
            read_part(zf, "a.xml", 999)
    assert exc.value.kind == "limit_exceeded"


def test_read_part_with_header_lying_about_size_is_never_silently_truncated() -> None:
    body = b"B" * 5000
    honest = _zip([("a.xml", body)], compression=zipfile.ZIP_STORED)
    lying = honest.replace(struct.pack("<II", 5000, 5000), struct.pack("<II", 10, 10))
    assert lying != honest
    with zipfile.ZipFile(io.BytesIO(lying)) as zf:
        with pytest.raises(ConversionError) as exc:
            read_part(zf, "a.xml", 100_000)
    assert exc.value.kind == "malformed"


def test_read_part_missing_part_is_malformed() -> None:
    with zipfile.ZipFile(io.BytesIO(_zip([("a.xml", b"x")]))) as zf:
        with pytest.raises(ConversionError) as exc:
            read_part(zf, "nope.xml", 10)
    assert exc.value.kind == "malformed"


def _craft_zip() -> bytearray:
    rng = random.Random(1)
    body = bytes(rng.getrandbits(8) for _ in range(2000)) + b"A" * 5000
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(PPTX_PART, body)
    return bytearray(buf.getvalue())


def _central_header_offset(data: bytearray) -> int:
    return data.rfind(b"PK\x01\x02")


def _patch_u16(data: bytearray, offset: int, value: int) -> None:
    struct.pack_into("<H", data, offset, value)


# Offsets: local header flags@6 method@8 name@30; central header version-needed@6 flags@8 method@10 name@46.
def _corrupt_deflate_zip() -> bytes:
    data = _craft_zip()
    data[30 + len(PPTX_PART)] = 0x07  # BFINAL=1, BTYPE=11 (reserved) as the first deflate block header
    return bytes(data)


def _unsupported_method_zip() -> bytes:
    data = _craft_zip()
    _patch_u16(data, 8, 9)
    _patch_u16(data, _central_header_offset(data) + 10, 9)
    return bytes(data)


def _encrypted_entry_zip() -> bytes:
    data = _craft_zip()
    _patch_u16(data, 6, 1)
    _patch_u16(data, _central_header_offset(data) + 8, 1)
    return bytes(data)


def _non_utf8_name_with_utf8_flag_zip() -> bytes:
    data = _craft_zip()
    central = _central_header_offset(data)
    _patch_u16(data, central + 8, 0x800)
    data[central + 46] = 0xFF
    return bytes(data)


def _version_needed_10x_zip() -> bytes:
    data = _craft_zip()
    _patch_u16(data, _central_header_offset(data) + 6, 100)
    return bytes(data)


@pytest.mark.parametrize(
    ("data", "kind"),
    [
        pytest.param(_corrupt_deflate_zip(), "malformed", id="corrupt-deflate-stream"),
        pytest.param(_unsupported_method_zip(), "malformed", id="unsupported-compression-method"),
        pytest.param(_encrypted_entry_zip(), "encrypted", id="zip-level-encryption-flag"),
    ],
)
def test_read_part_on_undecodable_entry_maps_to_a_conversion_error(data: bytes, kind: str) -> None:
    with _opened(data, PPTX_PART, _limits()) as archive:
        with pytest.raises(ConversionError) as exc:
            read_part(archive, PPTX_PART, 1_000_000)
    assert exc.value.kind == kind


@pytest.mark.parametrize("storage", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED])
def test_read_part_on_data_truncated_after_open_is_malformed(storage: int) -> None:
    rng = random.Random(2)
    buf = io.BytesIO(_zip([(PPTX_PART, bytes(rng.getrandbits(8) for _ in range(5000)))], storage))
    archive = zipfile.ZipFile(buf)
    buf.truncate(30 + len(PPTX_PART) + 100)
    with archive, pytest.raises(ConversionError) as exc:
        read_part(archive, PPTX_PART, 1_000_000)
    assert exc.value.kind == "malformed"


def test_read_part_on_closed_archive_is_malformed() -> None:
    archive = zipfile.ZipFile(io.BytesIO(_zip([(PPTX_PART, b"<x/>")])))
    archive.close()
    with pytest.raises(ConversionError) as exc:
        read_part(archive, PPTX_PART, 100)
    assert exc.value.kind == "malformed"


@pytest.mark.parametrize(
    "data",
    [
        pytest.param(_version_needed_10x_zip(), id="version-needed-10x"),
        pytest.param(_non_utf8_name_with_utf8_flag_zip(), id="utf8-flag-with-non-utf8-name"),
    ],
)
def test_archive_the_zip_reader_refuses_to_open_passes_through(data: bytes) -> None:
    assert inspect_archive(data, PPTX_PART, _limits()) is None


def test_read_part_on_zip_bomb_part_stops_at_cap_without_inflating_it() -> None:
    chunk = b"\x00" * _MIB
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf, zf.open(PPTX_PART, "w", force_zip64=True) as part:
        for _ in range(200):
            part.write(chunk)
    data = buf.getvalue()
    assert len(data) < 1_000_000

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        tracemalloc.start()
        try:
            with pytest.raises(ConversionError) as exc:
                read_part(archive, PPTX_PART, _MIB)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
    assert exc.value.kind == "limit_exceeded"
    assert peak < 10 * _MIB


@pytest.mark.parametrize("method", [zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA])
def test_read_part_on_corrupt_bzip2_or_lzma_entry_is_malformed(method: int) -> None:
    data = bytearray(_zip([(PPTX_PART, b"A" * 3000)], method))
    # LZMA entries carry a 4-byte property header before the compressed stream.
    start = 30 + len(PPTX_PART) + (4 if method == zipfile.ZIP_LZMA else 0)
    for i in range(start, start + 12):
        data[i] ^= 0xFF
    with _opened(bytes(data), PPTX_PART, _limits()) as archive:
        with pytest.raises(ConversionError) as exc:
            read_part(archive, PPTX_PART, 1_000_000)
    assert exc.value.kind == "malformed"


# ---------------------------------------------------------------------------
# copy_part: same guarantees as read_part, without holding the part in memory
# ---------------------------------------------------------------------------


class _Sink(io.RawIOBase):
    """Counts written bytes and keeps none of them."""

    def __init__(self) -> None:
        self.size = 0

    def writable(self) -> bool:
        return True

    def write(self, data) -> int:  # noqa: ANN001 - bytes-like
        self.size += len(data)
        return len(data)


def _copy(archive: zipfile.ZipFile, name: str, budget: int) -> bytes:
    dest = io.BytesIO()
    copied = copy_part(archive, name, dest, budget)
    assert copied == len(dest.getvalue())
    return dest.getvalue()


def test_copy_part_copies_the_bytes_within_budget() -> None:
    with zipfile.ZipFile(io.BytesIO(_zip([("a.xml", b"12345")]))) as zf:
        assert _copy(zf, "a.xml", 5) == b"12345"


def test_copy_part_over_budget_is_limit_exceeded() -> None:
    with zipfile.ZipFile(io.BytesIO(_zip([("a.xml", b"A" * 1000)]))) as zf:
        with pytest.raises(ConversionError) as exc:
            _copy(zf, "a.xml", 999)
    assert exc.value.kind == "limit_exceeded"


def test_copy_part_with_header_lying_about_size_is_malformed() -> None:
    honest = _zip([("a.xml", b"B" * 5000)], compression=zipfile.ZIP_STORED)
    lying = honest.replace(struct.pack("<II", 5000, 5000), struct.pack("<II", 10, 10))
    with zipfile.ZipFile(io.BytesIO(lying)) as zf:
        with pytest.raises(ConversionError) as exc:
            _copy(zf, "a.xml", 100_000)
    assert exc.value.kind == "malformed"


def test_copy_part_missing_part_is_malformed() -> None:
    with zipfile.ZipFile(io.BytesIO(_zip([("a.xml", b"x")]))) as zf:
        with pytest.raises(ConversionError) as exc:
            _copy(zf, "nope.xml", 10)
    assert exc.value.kind == "malformed"


@pytest.mark.parametrize(
    ("data", "kind"),
    [
        pytest.param(_corrupt_deflate_zip(), "malformed", id="corrupt-deflate-stream"),
        pytest.param(_unsupported_method_zip(), "malformed", id="unsupported-compression-method"),
        pytest.param(_encrypted_entry_zip(), "encrypted", id="zip-level-encryption-flag"),
    ],
)
def test_copy_part_on_undecodable_entry_maps_to_a_conversion_error(data: bytes, kind: str) -> None:
    with _opened(data, PPTX_PART, _limits()) as archive:
        with pytest.raises(ConversionError) as exc:
            _copy(archive, PPTX_PART, 1_000_000)
    assert exc.value.kind == kind


@pytest.mark.parametrize("storage", [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED])
def test_copy_part_on_data_truncated_after_open_is_malformed(storage: int) -> None:
    rng = random.Random(2)
    buf = io.BytesIO(_zip([(PPTX_PART, bytes(rng.getrandbits(8) for _ in range(5000)))], storage))
    archive = zipfile.ZipFile(buf)
    buf.truncate(30 + len(PPTX_PART) + 100)
    with archive, pytest.raises(ConversionError) as exc:
        _copy(archive, PPTX_PART, 1_000_000)
    assert exc.value.kind == "malformed"


def test_copy_part_leaves_the_archive_usable() -> None:
    with zipfile.ZipFile(io.BytesIO(_zip([("a.xml", b"aaa"), ("b.xml", b"bbb")]))) as zf:
        assert _copy(zf, "a.xml", 10) == b"aaa"
        with pytest.raises(ConversionError):
            _copy(zf, "b.xml", 1)
        assert _copy(zf, "b.xml", 10) == b"bbb"
        assert read_part(zf, "a.xml", 10) == b"aaa"


def test_copy_part_streams_a_large_part_with_flat_memory() -> None:
    chunk = b"\x00" * _MIB
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf, zf.open(PPTX_PART, "w", force_zip64=True) as part:
        for _ in range(200):
            part.write(chunk)
    del chunk
    with zipfile.ZipFile(io.BytesIO(buf.getvalue())) as archive:
        sink = _Sink()
        tracemalloc.start()
        try:
            copied = copy_part(archive, PPTX_PART, sink, 512 * _MIB)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
    assert copied == sink.size == 200 * _MIB
    assert peak < 10 * _MIB
