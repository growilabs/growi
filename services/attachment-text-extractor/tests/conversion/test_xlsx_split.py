"""XlsxSheetSplitter tests against the pinned anydoc (Req 1.3, 2.6).

Workbooks are generated with openpyxl and then edited at the ZIP level where a case needs
markup openpyxl refuses to write (sheet names with `[` / `*`, duplicate names, veryHidden).
"""

import importlib.metadata
import io
import logging
import re
import tracemalloc
import warnings
import zipfile
from collections.abc import Callable
from pathlib import Path
from xml.sax.saxutils import quoteattr

import anydoc
import openpyxl
import pytest
from defusedxml.ElementTree import fromstring

import app.conversion.xlsx_split as xlsx_split
from app.conversion.errors import ConversionError
from app.conversion.formats import AnydocFormat
from app.conversion.limits import ConversionLimits
from app.conversion.xlsx_split import convert_xlsx
from app.schemas import PageInfo

_WORKBOOK = "xl/workbook.xml"
_SHEET1 = "xl/worksheets/sheet1.xml"
_MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_SHEET_NAME_ATTR = re.compile(rb'(<sheet\b[^>]*?\bname=)"[^"]*"')
_SHEET_STATE_ATTR = re.compile(rb'(<sheet\b[^>]*?\bstate=)"[^"]*"')


def _limits(cells: int = 70_000, entries: int = 10_000, uncompressed_mb: int = 512) -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=1_000_000,
        max_pdf_pages=100,
        max_archive_entries=entries,
        max_archive_uncompressed_mb=uncompressed_mb,
        max_xlsx_cells=cells,
        ipynb_output_max_chars=100,
    )


def _book(sheets: list[tuple[str, list[str]]]) -> bytes:
    """One sheet per (name, column A values); a sheet with no values has no cells."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for name, values in sheets:
        ws = wb.create_sheet(name)
        for row, value in enumerate(values, start=1):
            ws.cell(row=row, column=1, value=value)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _rewrite(data: bytes, edits: dict[str, Callable[[bytes], bytes]]) -> bytes:
    src = zipfile.ZipFile(io.BytesIO(data))
    buf = io.BytesIO()
    with src, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as out:
        for info in src.infolist():
            body = src.read(info)
            out.writestr(info.filename, edits[info.filename](body) if info.filename in edits else body)
    return buf.getvalue()


def _renamed(data: bytes, names: list[str]) -> bytes:
    """Set the sheet names in workbook order, escaped the way any XML writer would."""
    pending = iter(names)

    def rename(body: bytes) -> bytes:
        return _SHEET_NAME_ATTR.sub(lambda m: m.group(1) + quoteattr(next(pending)).encode(), body)

    return _rewrite(data, {_WORKBOOK: rename})


def _with_states(data: bytes, states: list[str]) -> bytes:
    pending = iter(states)

    def restate(body: bytes) -> bytes:
        return _SHEET_STATE_ATTR.sub(lambda m: m.group(1) + quoteattr(next(pending)).encode(), body)

    return _rewrite(data, {_WORKBOOK: restate})


def _capture(monkeypatch: pytest.MonkeyPatch, results: list[str] | None = None) -> list[tuple[bytes, AnydocFormat]]:
    """Record what is handed to anydoc (and, into results, what it returned) while converting for real."""
    calls: list[tuple[bytes, AnydocFormat]] = []
    real = xlsx_split.convert_office

    def recording(data: bytes, fmt: AnydocFormat) -> str:
        calls.append((data, fmt))
        markdown = real(data, fmt)
        if results is not None:
            results.append(markdown)
        return markdown

    monkeypatch.setattr(xlsx_split, "convert_office", recording)
    return calls


def _sent_names(package: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(package)) as zf:
        root = fromstring(zf.read(_WORKBOOK))
    return [sheet.get("name", "") for sheet in root.iter(f"{{{_MAIN_NS}}}sheet")]


def _failure(data: bytes, limits: ConversionLimits | None = None) -> ConversionError:
    with pytest.raises(ConversionError) as excinfo:
        convert_xlsx(data, limits or _limits())
    return excinfo.value


def _rejoined(pages: list[PageInfo]) -> str:
    # anydoc writes "## <sheet name>", a blank line, the table, and one blank line between sheets.
    return "\n\n".join(f"## {page.label}\n\n{page.content}" for page in pages) + "\n"


def _labels(pages: list[PageInfo]) -> list[tuple[int | None, str | None]]:
    return [(page.pageNumber, page.label) for page in pages]


# ---------------------------------------------------------------------------
# Contract with the pinned anydoc: sheet names and order survive the markers
# ---------------------------------------------------------------------------


def test_contract_is_pinned_to_the_anydoc_version_it_was_checked_against() -> None:
    assert importlib.metadata.version("firecrawl-anydoc") == "0.2.4"


_AWKWARD_NAMES = [
    "売上",
    "Summary <#1>",
    "A&B \"double\" 'single' >",
    "[draft] a*b:c/d?e\\f",
    "x|y_z*w`~",
    "## looks like a heading",
    "ZZ0123456789abcdef0123456789abcdef1ZZ",
    "ZZ00000000000000000000000000000000002ZZ",
    "abcdefghijklmnopqrstuvwxyz01234",
    "長" * 300,
    "Sheet",
    "Sheet",
    "sheet",
    "📊 データ &amp; literal",
]


def _awkward_book() -> bytes:
    # openpyxl refuses several of these names, so placeholders are renamed in the XML afterwards.
    placeholders = [(f"S{i}", [f"value {i}", f"row two {i}"]) for i in range(len(_AWKWARD_NAMES))]
    return _renamed(_book(placeholders), _AWKWARD_NAMES)


def test_awkward_sheet_names_come_back_in_workbook_order() -> None:
    pages = convert_xlsx(_awkward_book(), _limits())
    assert _labels(pages) == [(number, name) for number, name in enumerate(_AWKWARD_NAMES, start=1)]
    assert [page.content.count("value") for page in pages] == [1] * len(_AWKWARD_NAMES)
    assert all(f"value {i} " in page.content for i, page in enumerate(pages))


def _sections(markdown: str) -> list[str]:
    """anydoc's own per-sheet bodies, cut at its "## " headings (cell text never starts a line with them)."""
    before, *bodies = re.split(r"^## .*\n", markdown, flags=re.MULTILINE)
    assert before == ""
    return [body.strip("\n") for body in bodies]


@pytest.mark.parametrize("source", ["awkward", "plain", "stale_references"])
def test_sheet_bodies_equal_converting_the_original_workbook(source: str) -> None:
    workbook = {"awkward": _awkward_book, "plain": _plain_book, "stale_references": _stale_reference_book}[source]()
    pages = convert_xlsx(workbook, _limits())
    assert [page.content for page in pages] == _sections(anydoc.to_markdown_bytes(workbook, "xlsx"))


def test_plain_names_rejoin_to_the_original_output_exactly() -> None:
    workbook = _plain_book()
    assert _rejoined(convert_xlsx(workbook, _limits())) == anydoc.to_markdown_bytes(workbook, "xlsx")


def test_labels_are_the_names_anydoc_would_escape_in_its_headings() -> None:
    # anydoc writes "\[" and "\\" (and "&amp;amp;" for a literal "&amp;") into headings;
    # labels carry the names as stored in the workbook.
    names = ["[draft] a\\b", "a<b", "literal &amp; text"]
    workbook = _renamed(_book([(f"S{i}", [f"v{i}"]) for i in range(len(names))]), names)
    headings = [line for line in anydoc.to_markdown_bytes(workbook, "xlsx").splitlines() if line.startswith("## ")]
    assert headings != [f"## {name}" for name in names]
    assert [page.label for page in convert_xlsx(workbook, _limits())] == names


def _plain_book() -> bytes:
    return _book([("売上", ["商品", "りんご"]), ("Summary <#1>", ["Total"]), ("Third", ["3"])])


def _stale_reference_book() -> bytes:
    """Defined names, print titles and a cached cross-sheet formula still name the old sheets."""
    wb = openpyxl.Workbook()
    first = wb.active
    first.title = "Alpha"
    first["A1"] = "alpha value"
    first.print_title_rows = "1:1"
    second = wb.create_sheet("Beta")
    second["A1"] = "beta value"
    wb.defined_names["named_cell"] = openpyxl.workbook.defined_name.DefinedName("named_cell", attr_text="Beta!$A$1")
    buf = io.BytesIO()
    wb.save(buf)
    formula = b'<c r="B1" t="str"><f>Beta!A1</f><v>cached from beta</v></c>'
    return _rewrite(
        buf.getvalue(), {_SHEET1: lambda body: body.replace(b"</c></row>", b"</c>" + formula + b"</row>", 1)}
    )


def test_defined_names_are_not_rewritten(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture(monkeypatch)
    pages = convert_xlsx(_stale_reference_book(), _limits())
    with zipfile.ZipFile(io.BytesIO(calls[0][0])) as zf:
        workbook_xml = zf.read(_WORKBOOK)
    assert b"Beta!$A$1" in workbook_xml
    assert b"'Alpha'!$1:$1" in workbook_xml
    assert "cached from beta" in pages[0].content


def test_fixture_with_an_empty_sheet_skips_it(xlsx_multi_sheet: bytes) -> None:
    pages = convert_xlsx(xlsx_multi_sheet, _limits())
    assert _labels(pages) == [(1, "売上"), (2, "Summary <#1>")]
    assert "りんご" in pages[0].content
    assert "Total" in pages[1].content


def test_empty_sheet_in_the_middle_leaves_a_gap_in_the_numbers() -> None:
    pages = convert_xlsx(_book([("First", ["one"]), ("Blank", []), ("Third", ["three"])]), _limits())
    assert _labels(pages) == [(1, "First"), (3, "Third")]
    assert "three" in pages[1].content


def test_chart_sheet_is_skipped_but_counted(xlsx_chart_sheet: bytes) -> None:
    pages = convert_xlsx(xlsx_chart_sheet, _limits())
    assert _labels(pages) == [(1, "Data")]
    assert "Jan" in pages[0].content


def test_chart_sheet_before_a_worksheet_shifts_its_number(xlsx_chart_sheet: bytes) -> None:
    def chart_first(body: bytes) -> bytes:
        sheets = re.findall(rb"<sheet\b[^>]*/>", body)
        return body.replace(sheets[0] + sheets[1], sheets[1] + sheets[0])

    pages = convert_xlsx(_rewrite(xlsx_chart_sheet, {_WORKBOOK: chart_first}), _limits())
    assert _labels(pages) == [(2, "Data")]


def test_hidden_sheet_is_kept_at_its_position(xlsx_hidden_sheet: bytes) -> None:
    pages = convert_xlsx(xlsx_hidden_sheet, _limits())
    assert _labels(pages) == [(1, "Visible"), (2, "Secret")]
    assert "hidden marker" in pages[1].content


@pytest.mark.parametrize("state", ["hidden", "veryHidden"])
def test_hidden_states_are_made_visible(state: str, monkeypatch: pytest.MonkeyPatch) -> None:
    workbook = _with_states(_book([("Shown", ["shown text"]), ("Kept", ["kept text"])]), ["visible", state])
    calls = _capture(monkeypatch)
    pages = convert_xlsx(workbook, _limits())
    assert _labels(pages) == [(1, "Shown"), (2, "Kept")]
    assert "kept text" in pages[1].content
    with zipfile.ZipFile(io.BytesIO(calls[0][0])) as zf:
        assert b"idden" not in zf.read(_WORKBOOK)


def test_sheet_order_follows_the_workbook_not_the_sheet_ids() -> None:
    def swap(body: bytes) -> bytes:
        sheets = re.findall(rb"<sheet\b[^>]*/>", body)
        return body.replace(sheets[0] + sheets[1], sheets[1] + sheets[0])

    workbook = _rewrite(_book([("Low id", ["low"]), ("High id", ["high"])]), {_WORKBOOK: swap})
    pages = convert_xlsx(workbook, _limits())
    assert _labels(pages) == [(1, "High id"), (2, "Low id")]
    assert "high" in pages[0].content


def test_excel_style_workbook_markup_still_splits() -> None:
    """Prefixes named only in mc:Ignorable, AlternateContent and revision attributes, as Excel writes them."""
    excel_workbook = (
        b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        b'<workbook xmlns="' + _MAIN_NS.encode() + b'" '
        b'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        b'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x15 xr xr6 xr10" '
        b'xmlns:x15="http://schemas.microsoft.com/office/spreadsheetml/2010/11/main" '
        b'xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" '
        b'xmlns:xr6="http://schemas.microsoft.com/office/spreadsheetml/2016/revision6" '
        b'xmlns:xr10="http://schemas.microsoft.com/office/spreadsheetml/2016/revision10">'
        b'<fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/>'
        b'<workbookPr defaultThemeVersion="166925"/>'
        b'<mc:AlternateContent><mc:Choice Requires="x15"><x15ac:absPath url="C:\\Users\\x\\" '
        b'xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac"/></mc:Choice></mc:AlternateContent>'
        b'<xr:revisionPtr revIDLastSave="0" documentId="8_{1}" xr6:coauthVersionLast="47" '
        b'xr10:uidLastSave="{00000000-0000-0000-0000-000000000000}"/>'
        b'<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="1" windowHeight="1"/></bookViews>'
        b'<sheets><sheet name="First" sheetId="1" r:id="rId1"/>'
        b'<sheet name="Second" sheetId="2" state="hidden" r:id="rId2"/></sheets>'
        b'<calcPr calcId="191029"/></workbook>'
    )
    workbook = _rewrite(_book([("a", ["first text"]), ("b", ["second text"])]), {_WORKBOOK: lambda _: excel_workbook})
    pages = convert_xlsx(workbook, _limits())
    assert _labels(pages) == [(1, "First"), (2, "Second")]
    assert "second text" in pages[1].content


def test_cell_text_shaped_like_a_marker_heading_stays_in_its_sheet() -> None:
    forged = "## ZZ0123456789abcdef0123456789abcdef1ZZ"
    pages = convert_xlsx(_book([("One", [forged, "one"]), ("Two", ["two"])]), _limits())
    assert _labels(pages) == [(1, "One"), (2, "Two")]
    assert "ZZ0123456789abcdef0123456789abcdef1ZZ" in pages[0].content


def test_whitespace_only_sheet_name_is_still_found() -> None:
    # anydoc prints no heading for a blank name, which is why every name is replaced.
    pages = convert_xlsx(_renamed(_book([("a", ["blank named"]), ("b", ["normal"])]), ["   ", "Normal"]), _limits())
    assert _labels(pages) == [(1, "   "), (2, "Normal")]
    assert "blank named" in pages[0].content


# ---------------------------------------------------------------------------
# One sheet: anydoc prints no heading
# ---------------------------------------------------------------------------


def test_single_sheet_is_one_element_named_after_the_sheet(xlsx_single_sheet: bytes) -> None:
    pages = convert_xlsx(xlsx_single_sheet, _limits())
    assert _labels(pages) == [(1, "OnlySheet")]
    assert "single sheet marker" in pages[0].content
    assert "##" not in pages[0].content


def test_single_hidden_sheet_is_still_converted() -> None:
    workbook = _with_states(_book([("Lonely", ["lonely text"])]), ["hidden"])
    pages = convert_xlsx(workbook, _limits())
    assert _labels(pages) == [(1, "Lonely")]
    assert "lonely text" in pages[0].content


def test_single_sheet_with_an_awkward_name() -> None:
    pages = convert_xlsx(_renamed(_book([("a", ["content"])]), ["<&>\"'[]"]), _limits())
    assert _labels(pages) == [(1, "<&>\"'[]")]


def test_workbook_whose_sheets_are_all_empty_returns_no_elements() -> None:
    assert convert_xlsx(_book([("A", []), ("B", [])]), _limits()) == []


# ---------------------------------------------------------------------------
# What is handed to anydoc
# ---------------------------------------------------------------------------


def test_anydoc_is_called_once_with_the_xlsx_format(xlsx_multi_sheet: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture(monkeypatch)
    convert_xlsx(xlsx_multi_sheet, _limits())
    assert [fmt for _, fmt in calls] == ["xlsx"]


def test_sent_names_are_alphanumeric_markers_unique_per_call(
    xlsx_multi_sheet: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _capture(monkeypatch)
    convert_xlsx(xlsx_multi_sheet, _limits())
    convert_xlsx(xlsx_multi_sheet, _limits())
    first, second = (_sent_names(package) for package, _ in calls)
    assert len(first) == 3
    assert all(re.fullmatch(r"[A-Za-z0-9]+", name) for name in first + second)
    assert len(set(first)) == 3
    assert not set(first) & set(second)
    assert not {"売上", "Summary <#1>", "Empty"} & set(first)


def test_other_parts_are_copied_unchanged_in_their_original_order(
    xlsx_chart_sheet: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _capture(monkeypatch)
    convert_xlsx(xlsx_chart_sheet, _limits())
    with zipfile.ZipFile(io.BytesIO(xlsx_chart_sheet)) as before, zipfile.ZipFile(io.BytesIO(calls[0][0])) as after:
        assert [i.filename for i in after.infolist()] == [i.filename for i in before.infolist()]
        assert [i.compress_type for i in after.infolist()] == [i.compress_type for i in before.infolist()]
        for info in before.infolist():
            if info.filename != _WORKBOOK:
                assert after.read(info.filename) == before.read(info)


def test_duplicated_entry_is_sent_once_with_the_copy_anydoc_reads(monkeypatch: pytest.MonkeyPatch) -> None:
    base = _book([("A", ["first copy"]), ("B", ["b"])])
    src = zipfile.ZipFile(io.BytesIO(base))
    buf = io.BytesIO()
    with src, warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as out:
            for info in src.infolist():
                out.writestr(info.filename, src.read(info))
            out.writestr(_SHEET1, src.read(_SHEET1).replace(b"first copy", b"second copy"))
    workbook = buf.getvalue()
    calls = _capture(monkeypatch)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        pages = convert_xlsx(workbook, _limits())
    assert [page.content for page in pages] == _sections(anydoc.to_markdown_bytes(workbook, "xlsx"))
    assert "second copy" in pages[0].content
    with zipfile.ZipFile(io.BytesIO(calls[0][0])) as sent:
        assert [info.filename for info in sent.infolist()].count(_SHEET1) == 1


def test_large_unreferenced_part_is_repackaged_with_flat_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    # Pivot cache records and media are not counted as cells, so only streaming keeps them cheap.
    src = zipfile.ZipFile(io.BytesIO(_book([("A", ["a"]), ("B", ["b"])])))
    buf = io.BytesIO()
    chunk = bytes(1024 * 1024)
    with src, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as out:
        for info in src.infolist():
            out.writestr(info.filename, src.read(info))
        with out.open("xl/pivotCache/pivotCacheRecords1.xml", "w") as part:
            for _ in range(150):
                part.write(chunk)
    del chunk
    workbook = buf.getvalue()
    assert len(workbook) < 1024 * 1024
    sent: list[int] = []

    def fake_office(data: bytes, fmt: AnydocFormat) -> str:
        sent.append(len(data))
        return ""

    monkeypatch.setattr(xlsx_split, "convert_office", fake_office)
    tracemalloc.start()
    try:
        convert_xlsx(workbook, _limits())
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert len(sent) == 1
    assert sent[0] < 2 * 1024 * 1024
    assert peak < 32 * 1024 * 1024


def test_stored_entries_stay_stored(monkeypatch: pytest.MonkeyPatch) -> None:
    src = zipfile.ZipFile(io.BytesIO(_book([("A", ["a"]), ("B", ["b"])])))
    buf = io.BytesIO()
    with src, zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as out:
        for info in src.infolist():
            out.writestr(info.filename, src.read(info))
    calls = _capture(monkeypatch)
    pages = convert_xlsx(buf.getvalue(), _limits())
    assert _labels(pages) == [(1, "A"), (2, "B")]
    with zipfile.ZipFile(io.BytesIO(calls[0][0])) as after:
        assert {info.compress_type for info in after.infolist()} == {zipfile.ZIP_STORED}


# ---------------------------------------------------------------------------
# Whole-output fallback: only for output the markers cannot explain
# ---------------------------------------------------------------------------


def _answer_with(monkeypatch: pytest.MonkeyPatch, render: Callable[[list[str]], str]) -> None:
    """Make anydoc answer with text built from the marker names it was sent."""
    monkeypatch.setattr(xlsx_split, "convert_office", lambda data, fmt: render(_sent_names(data)))


_SECRET_NAMES = ["Payroll secret", "Bonus secret", "Third secret"]


def _secret_book() -> bytes:
    return _book([(name, [f"cell {i}"]) for i, name in enumerate(_SECRET_NAMES)])


def _unknown_number(marker: str) -> str:
    # Markers end in the 1-based sheet position, so the first one ends in "1ZZ".
    assert marker.endswith("1ZZ")
    return marker[: -len("1ZZ")] + "9ZZ"


@pytest.mark.parametrize(
    ("case", "render"),
    [
        ("text before the first marker", lambda m: f"stray\n\n## {m[0]}\n\nA\n\n## {m[1]}\n\nB\n"),
        ("order mismatch", lambda m: f"## {m[1]}\n\nB\n\n## {m[0]}\n\nA\n"),
        ("marker repeated", lambda m: f"## {m[0]}\n\nA\n\n## {m[0]}\n\nB\n"),
        ("unknown marker number", lambda m: f"## {m[0]}\n\nA\n\n## {_unknown_number(m[0])}\n\nC\n"),
        ("marker outside a heading", lambda m: f"## {m[0]}\n\nA mentions {m[1]}\n\n## {m[1]}\n\nB\n"),
        ("marker inside a longer heading", lambda m: f"## {m[0]}\n\nA\n\n## {m[1]} extra\n\nB\n"),
        ("no marker at all", lambda m: "| a |\n| --- |\n| b |\n"),
    ],
)
def test_output_the_markers_cannot_explain_falls_back_to_one_unnumbered_element(
    case: str, render: Callable[[list[str]], str], monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    _answer_with(monkeypatch, render)
    with caplog.at_level(logging.WARNING, logger=xlsx_split.__name__):
        pages = convert_xlsx(_secret_book(), _limits())
    assert len(pages) == 1
    assert (pages[0].pageNumber, pages[0].label) == (None, None)
    assert "ZZ" not in pages[0].content
    assert [record.levelno for record in caplog.records] == [logging.WARNING]
    assert not any(name in caplog.text for name in _SECRET_NAMES)


def test_fallback_restores_the_sheet_names_in_the_text(monkeypatch: pytest.MonkeyPatch) -> None:
    _answer_with(monkeypatch, lambda m: f"## {m[1]}\n\nB\n\n## {m[0]}\n\nA\n")
    pages = convert_xlsx(_secret_book(), _limits())
    assert pages == [PageInfo(pageNumber=None, label=None, content="## Bonus secret\n\nB\n\n## Payroll secret\n\nA\n")]


def test_marker_from_another_call_is_not_mistaken_for_a_sheet(monkeypatch: pytest.MonkeyPatch) -> None:
    foreign = "ZZ0123456789abcdef0123456789abcdef1ZZ"
    _answer_with(monkeypatch, lambda m: f"## {m[0]}\n\nA\n\n## {foreign}\n\nX\n\n## {m[1]}\n\nB\n")
    pages = convert_xlsx(_secret_book(), _limits())
    # Not one of this call's markers: it is ordinary text of the first sheet.
    assert _labels(pages) == [(1, "Payroll secret"), (2, "Bonus secret")]
    assert foreign in pages[0].content


def test_well_formed_output_is_not_logged(xlsx_multi_sheet: bytes, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger=xlsx_split.__name__):
        convert_xlsx(xlsx_multi_sheet, _limits())
    assert caplog.records == []


# ---------------------------------------------------------------------------
# Packages that do not pass the ZIP pre-check go to anydoc whole
# ---------------------------------------------------------------------------


def test_legacy_xls_is_handed_whole_as_xlsx(xls: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture(monkeypatch)
    pages = convert_xlsx(xls, _limits())
    assert calls == [(xls, "xlsx")]
    assert len(pages) == 1
    assert (pages[0].pageNumber, pages[0].label) == (None, None)
    assert "XLS cell marker" in pages[0].content
    assert "second sheet" in pages[0].content


def test_encrypted_xlsx_is_handed_whole_and_reports_encrypted(
    xlsx_encrypted: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _capture(monkeypatch)
    assert _failure(xlsx_encrypted).kind == "encrypted"
    assert calls == [(xlsx_encrypted, "xlsx")]


def test_zip_without_a_workbook_is_handed_whole(monkeypatch: pytest.MonkeyPatch) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("other.xml", "<x/>")
    monkeypatch.setattr(xlsx_split, "convert_office", lambda data, fmt: f"whole {fmt} {len(data)}")
    assert convert_xlsx(buf.getvalue(), _limits()) == [
        PageInfo(pageNumber=None, label=None, content=f"whole xlsx {len(buf.getvalue())}")
    ]


# ---------------------------------------------------------------------------
# Limits and malformed workbooks are decided before anydoc runs
# ---------------------------------------------------------------------------


def test_cell_pre_check_runs_before_anydoc(xlsx_over_cell_limit_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture(monkeypatch)
    assert _failure(xlsx_over_cell_limit_path.read_bytes()).kind == "limit_exceeded"
    assert calls == []


def test_small_cell_limit_is_honoured(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture(monkeypatch)
    assert _failure(_book([("A", ["1", "2", "3"])]), _limits(cells=2)).kind == "limit_exceeded"
    assert calls == []


def test_sheet_list_longer_than_the_entry_limit_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    def many_sheets(body: bytes) -> bytes:
        entry = re.search(rb"<sheet\b[^>]*/>", body)
        assert entry is not None
        return body.replace(entry.group(0), entry.group(0) * 50_000)

    workbook = _rewrite(_book([("A", ["a"])]), {_WORKBOOK: many_sheets})
    calls = _capture(monkeypatch)
    assert _failure(workbook).kind == "limit_exceeded"
    assert calls == []


def test_workbook_xml_beyond_the_size_limit_is_rejected() -> None:
    workbook = _rewrite(
        _book([("A", ["a"])]),
        {_WORKBOOK: lambda body: body.replace(b"<sheets>", b"<!--" + b"x" * 1_200_000 + b"--><sheets>")},
    )
    assert _failure(workbook, _limits(uncompressed_mb=1)).kind == "limit_exceeded"


def test_workbook_xml_that_is_not_well_formed_is_malformed(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture(monkeypatch)
    assert (
        _failure(_rewrite(_book([("A", ["a"])]), {_WORKBOOK: lambda body: body[: len(body) // 2]})).kind == "malformed"
    )
    assert calls == []


def test_unknown_encoding_in_the_xml_declaration_is_malformed() -> None:
    def bad_declaration(body: bytes) -> bytes:
        return b'<?xml version="1.0" encoding="UTF-9"?>' + re.sub(rb"^<\?xml[^>]*\?>", b"", body)

    assert _failure(_rewrite(_book([("A", ["a"])]), {_WORKBOOK: bad_declaration})).kind == "malformed"


def test_entity_expansion_in_the_workbook_is_refused_as_malformed() -> None:
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]>'
        b'<workbook xmlns="' + _MAIN_NS.encode() + b'"><sheets><sheet name="&b;" sheetId="1"/></sheets></workbook>'
    )
    assert _failure(_rewrite(_book([("A", ["a"])]), {_WORKBOOK: lambda _: bomb})).kind == "malformed"


def test_archive_is_closed_on_success_and_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    opened: list[zipfile.ZipFile] = []
    real = xlsx_split.inspect_archive

    def recording(data: bytes, required: str, limits: ConversionLimits) -> zipfile.ZipFile | None:
        archive = real(data, required, limits)
        if archive is not None:
            opened.append(archive)
        return archive

    monkeypatch.setattr(xlsx_split, "inspect_archive", recording)
    convert_xlsx(_book([("A", ["a"]), ("B", ["b"])]), _limits())
    _failure(_book([("A", ["1", "2", "3"])]), _limits(cells=1))
    _failure(_rewrite(_book([("A", ["a"])]), {_WORKBOOK: lambda body: body[:20]}))
    assert len(opened) == 3
    assert all(archive.fp is None for archive in opened)
