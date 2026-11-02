"""XLSX cell-count pre-check (Req 2.6): counted on raw bytes, without parsing the XML."""

import io
import tracemalloc
import zipfile
from pathlib import Path

import pytest

import app.conversion.xlsx_split as xlsx_split
from app.config import Settings
from app.conversion.archive_guard import inspect_archive
from app.conversion.errors import ConversionError
from app.conversion.limits import ConversionLimits
from app.conversion.xlsx_split import enforce_cell_limit
from fixture_files import write_xlsx_cells

_WORKBOOK = "xl/workbook.xml"
_SHEET1 = "xl/worksheets/sheet1.xml"


def _limits(cells: int = 70_000, uncompressed_mb: int = 512) -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=1_000_000,
        max_pdf_pages=100,
        max_archive_entries=10_000,
        max_archive_uncompressed_mb=uncompressed_mb,
        max_xlsx_cells=cells,
        ipynb_output_max_chars=100,
        max_csv_bytes=8 * 1024 * 1024,
        max_html_bytes=20 * 1024 * 1024,
    )


def _package(parts: dict[str, bytes], *, compression: int = zipfile.ZIP_DEFLATED) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression) as zf:
        zf.writestr(_WORKBOOK, b"<workbook/>")
        for name, body in parts.items():
            zf.writestr(name, body)
    return buf.getvalue()


def _sheet(body: bytes) -> bytes:
    return b'<worksheet xmlns="m"><sheetData><row r="1">' + body + b"</row></sheetData></worksheet>"


def _check(data: bytes, limits: ConversionLimits) -> None:
    archive = inspect_archive(data, _WORKBOOK, limits)
    assert archive is not None
    try:
        enforce_cell_limit(archive, limits)
    finally:
        archive.close()


def _cells(count: int) -> bytes:
    return b"".join(b'<c r="A1"><v>1</v></c>' for _ in range(count))


def test_workbook_at_the_limit_passes_and_one_more_cell_is_rejected() -> None:
    _check(_package({_SHEET1: _sheet(_cells(50))}), _limits(cells=50))
    with pytest.raises(ConversionError) as exc:
        _check(_package({_SHEET1: _sheet(_cells(51))}), _limits(cells=50))
    assert exc.value.kind == "limit_exceeded"


def test_cells_are_totalled_across_all_sheets() -> None:
    data = _package({f"xl/worksheets/sheet{i}.xml": _sheet(_cells(20)) for i in range(1, 4)})
    _check(data, _limits(cells=60))
    with pytest.raises(ConversionError) as exc:
        _check(data, _limits(cells=59))
    assert exc.value.kind == "limit_exceeded"


def test_cell_forms_other_than_tags_that_merely_start_with_c_are_not_counted() -> None:
    noise = b'<cols><col min="1" max="1"/></cols><cfRule type="x"/><calcChain/><cellStyle/><c-x/><![CDATA[]]>&lt;c &gt;'
    cells = b'<c r="A1"/><c r="B1" t="s"><v>0</v></c><c>\n</c><c\tr="C1"/>'
    data = _package({_SHEET1: _sheet(noise + cells)})
    _check(data, _limits(cells=4))
    with pytest.raises(ConversionError):
        _check(data, _limits(cells=3))


def test_namespace_prefixed_cells_are_counted() -> None:
    body = b'<x:c r="A1"/><x:c r="B1"><x:v>1</x:v></x:c><x:col/>'
    data = _package({_SHEET1: b"<x:worksheet><x:sheetData><x:row>" + body + b"</x:row></x:sheetData></x:worksheet>"})
    _check(data, _limits(cells=2))
    with pytest.raises(ConversionError):
        _check(data, _limits(cells=1))


@pytest.mark.parametrize("offset", range(0, 9))
def test_a_cell_tag_split_across_chunks_is_counted_once(monkeypatch: pytest.MonkeyPatch, offset: int) -> None:
    monkeypatch.setattr(xlsx_split, "_CHUNK_BYTES", 8)
    data = _package({_SHEET1: _sheet(b"x" * offset + _cells(5))})
    _check(data, _limits(cells=5))
    with pytest.raises(ConversionError):
        _check(data, _limits(cells=4))


def test_relationship_parts_are_not_counted_but_every_other_part_is() -> None:
    _check(
        _package({"xl/_rels/workbook.xml.rels": _cells(100), "_rels/.rels": _cells(100), _SHEET1: _sheet(_cells(3))}),
        _limits(cells=3),
    )
    with pytest.raises(ConversionError):
        _check(_package({"xl/sharedStrings.xml": _cells(4)}), _limits(cells=3))


@pytest.mark.parametrize(
    "name",
    [
        "xl/worksheets/sub/sheet1.xml",
        "xl/custom/sheet1.xml",
        "xl/worksheets/sheet1.XML",
        "sheet1.xml",
        "xl/worksheets/sheet1.bin",
        "xl/worksheets/sheet1",
    ],
)
def test_sheets_reached_through_relationships_at_any_location_are_counted(name: str) -> None:
    data = _package({name: _sheet(_cells(150))})
    _check(data, _limits(cells=150))
    with pytest.raises(ConversionError) as exc:
        _check(data, _limits(cells=149))
    assert exc.value.kind == "limit_exceeded"


@pytest.mark.parametrize("bom", [b"\xff\xfe", b"\xfe\xff"])
def test_utf16_sheet_cannot_hide_cells_from_the_scan(bom: bytes) -> None:
    body = bom + _sheet(_cells(150)).decode().encode("utf-16-le" if bom == b"\xff\xfe" else "utf-16-be")
    with pytest.raises(ConversionError) as exc:
        _check(_package({_SHEET1: body}), _limits(cells=149))
    assert exc.value.kind in {"limit_exceeded", "malformed"}


def test_duplicate_part_names_are_all_scanned() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(_WORKBOOK, b"<workbook/>")
        with pytest.warns(UserWarning):
            zf.writestr(_SHEET1, _sheet(_cells(1)))
            zf.writestr(_SHEET1, _sheet(_cells(10)))
    with pytest.raises(ConversionError):
        enforce_cell_limit(zipfile.ZipFile(io.BytesIO(buf.getvalue())), _limits(cells=5))


def test_workbook_without_worksheets_passes() -> None:
    _check(_package({}), _limits(cells=0))


def test_decompressed_bytes_are_bounded_by_the_archive_limit() -> None:
    # The sheet declares nothing special; the budget is counted on bytes actually produced.
    data = _package({_SHEET1: _sheet(b"<!--" + b"a" * (3 * 1024 * 1024) + b"-->")})
    limits = _limits(uncompressed_mb=2)
    archive = zipfile.ZipFile(io.BytesIO(data))
    with pytest.raises(ConversionError) as exc:
        enforce_cell_limit(archive, limits)
    assert exc.value.kind == "limit_exceeded"


def test_corrupt_worksheet_stream_is_malformed() -> None:
    data = bytearray(_package({_SHEET1: _sheet(_cells(500))}))
    start = data.index(b"worksheets/sheet1.xml") + len(b"worksheets/sheet1.xml") + 10
    data[start : start + 20] = b"\xff" * 20
    archive = zipfile.ZipFile(io.BytesIO(bytes(data)))
    with pytest.raises(ConversionError) as exc:
        enforce_cell_limit(archive, _limits())
    assert exc.value.kind == "malformed"


def test_non_zip_and_encrypted_xlsx_are_left_to_the_caller(xlsx_encrypted: bytes) -> None:
    assert inspect_archive(xlsx_encrypted, _WORKBOOK, _limits()) is None
    assert inspect_archive(b"not a zip", _WORKBOOK, _limits()) is None


def test_real_workbooks_are_below_the_default_limit(
    xlsx_multi_sheet: bytes, xlsx_single_sheet: bytes, xlsx_hidden_sheet: bytes, xlsx_chart_sheet: bytes
) -> None:
    for data in (xlsx_multi_sheet, xlsx_single_sheet, xlsx_hidden_sheet, xlsx_chart_sheet):
        _check(data, _limits())


def test_real_workbook_over_the_limit_is_rejected_and_at_the_limit_passes(
    xlsx_over_cell_limit_path: Path, xlsx_large_for_timeout_path: Path
) -> None:
    _check(xlsx_large_for_timeout_path.read_bytes(), _limits())
    with pytest.raises(ConversionError) as exc:
        _check(xlsx_over_cell_limit_path.read_bytes(), _limits())
    assert exc.value.kind == "limit_exceeded"


def test_the_default_limit_admits_70000_cells_in_one_sheet_and_rejects_70001(tmp_path: Path) -> None:
    limits = ConversionLimits.from_settings(Settings())
    at_limit, over_limit = tmp_path / "at.xlsx", tmp_path / "over.xlsx"
    write_xlsx_cells(at_limit, [("Data", 70_000, 1)])
    write_xlsx_cells(over_limit, [("Data", 70_000, 1)], tail_cells=1)

    _check(at_limit.read_bytes(), limits)
    with pytest.raises(ConversionError) as exc:
        _check(over_limit.read_bytes(), limits)
    assert exc.value.kind == "limit_exceeded"


def test_peak_memory_stays_flat_for_a_large_sheet() -> None:
    sheet = _sheet(_cells(150_000))
    data = _package({_SHEET1: sheet})
    limits = _limits(cells=1_000_000)
    archive = zipfile.ZipFile(io.BytesIO(data))
    try:
        tracemalloc.start()
        try:
            baseline = tracemalloc.get_traced_memory()[0]
            tracemalloc.reset_peak()
            enforce_cell_limit(archive, limits)
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
    finally:
        archive.close()
    assert len(sheet) > 3 * 1024 * 1024
    assert peak - baseline < 512 * 1024
