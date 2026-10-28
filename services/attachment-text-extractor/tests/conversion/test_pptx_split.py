"""PptxSlideSplitter tests against the pinned anydoc (Req 1.2, 2.6).

Decks are generated with python-pptx and then edited at the ZIP level where a case needs
markup python-pptx cannot produce.
"""

import importlib.metadata
import io
import re
import struct
import zipfile
import zlib
from collections.abc import Callable
from pathlib import Path

import anydoc
import pytest
from pptx import Presentation
from pptx.util import Inches

import app.conversion.pptx_split as pptx_split
from app.conversion.errors import ConversionError
from app.conversion.formats import AnydocFormat
from app.conversion.limits import ConversionLimits
from app.conversion.pptx_split import convert_pptx
from app.schemas import PageInfo

_PRESENTATION = "ppt/presentation.xml"
_SLIDE1_RELS = "ppt/slides/_rels/slide1.xml.rels"
_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def _limits(entries: int = 10_000, uncompressed_mb: int = 512) -> ConversionLimits:
    return ConversionLimits(
        max_child_rss_mb=512,
        max_result_bytes=1_000_000,
        max_pdf_pages=100,
        max_archive_entries=entries,
        max_archive_uncompressed_mb=uncompressed_mb,
        max_xlsx_cells=1000,
        ipynb_output_max_chars=100,
    )


def _png(side: int = 8) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = b"".join(b"\x00" + bytes([128]) * side for _ in range(side))
    header = struct.pack(">IIBBBBB", side, side, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def _save(prs: Presentation) -> bytes:
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _title_slide(prs: Presentation, title: str):  # noqa: ANN202
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = title
    return slide


def _contract_deck() -> bytes:
    """Notes, a table, an image, a group, a hidden slide, an empty slide, and a reordered slide list."""
    prs = Presentation()
    first = prs.slides.add_slide(prs.slide_layouts[1])
    first.shapes.title.text = "Opening slide"
    first.placeholders[1].text = "first bullet\nsecond bullet"
    first.notes_slide.notes_text_frame.text = "speaker notes for the opening"

    table_slide = _title_slide(prs, "Table slide")
    table = table_slide.shapes.add_table(2, 2, Inches(1), Inches(2), Inches(4), Inches(2)).table
    for (row, col), text in {(0, 0): "head A", (0, 1): "head B", (1, 0): "cell 1", (1, 1): "cell 2"}.items():
        table.cell(row, col).text = text

    media_slide = _title_slide(prs, "Image and group")
    media_slide.shapes.add_picture(io.BytesIO(_png()), Inches(1), Inches(1))
    group = media_slide.shapes.add_group_shape()
    group.shapes.add_textbox(Inches(1), Inches(3), Inches(2), Inches(1)).text_frame.text = "grouped text"

    hidden = _title_slide(prs, "Hidden slide")
    hidden._element.set("show", "0")

    prs.slides.add_slide(prs.slide_layouts[6])  # blank layout: no text at all

    _title_slide(prs, "Moved to the front")
    slide_ids = prs.slides._sldIdLst
    moved = slide_ids[-1]
    slide_ids.remove(moved)
    slide_ids.insert(0, moved)
    return _save(prs)


def _rewrite(base: bytes, edits: dict[str, Callable[[bytes], bytes]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(base)) as src, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as out:
        for info in src.infolist():
            body = src.read(info)
            out.writestr(info, edits[info.filename](body) if info.filename in edits else body)
    return buf.getvalue()


def _add_member(base: bytes, name: str, body: bytes) -> bytes:
    buf = io.BytesIO(base)
    with zipfile.ZipFile(buf, "a") as out:
        out.writestr(name, body)
    return buf.getvalue()


def _with_relationship(rels: bytes, rel_id: str, rel_type: str, target: str, external: bool = False) -> bytes:
    mode = ' TargetMode="External"' if external else ""
    entry = f'<Relationship Id="{rel_id}" Type="{rel_type}" Target="{target}"{mode}/>'
    return rels.replace(b"</Relationships>", entry.encode() + b"</Relationships>")


def _capture_packages(
    monkeypatch: pytest.MonkeyPatch, results: list[str] | None = None
) -> list[tuple[bytes, AnydocFormat]]:
    """Record what is handed to anydoc (and, into results, what it returned) while converting for real."""
    calls: list[tuple[bytes, AnydocFormat]] = []
    real = pptx_split.convert_office

    def recording(data: bytes, fmt: AnydocFormat) -> str:
        calls.append((data, fmt))
        markdown = real(data, fmt)
        if results is not None:
            results.append(markdown)
        return markdown

    monkeypatch.setattr(pptx_split, "convert_office", recording)
    return calls


def _failure(data: bytes, limits: ConversionLimits | None = None) -> ConversionError:
    with pytest.raises(ConversionError) as excinfo:
        convert_pptx(data, limits or _limits())
    return excinfo.value


def _joined(pages: list[PageInfo]) -> str:
    # anydoc separates slides with one blank line and emits nothing for a slide without text.
    return "\n".join(page.content for page in pages if page.content)


# ---------------------------------------------------------------------------
# Contract with the pinned anydoc: splitting does not change the text
# ---------------------------------------------------------------------------


def test_contract_is_pinned_to_the_anydoc_version_it_was_checked_against() -> None:
    assert importlib.metadata.version("firecrawl-anydoc") == "0.2.4"


def _absolute_target_deck() -> bytes:
    return _rewrite(_notes_deck(), {_SLIDE1_RELS: lambda body: body.replace(b'Target="../', b'Target="/ppt/')})


def _artefact_deck() -> bytes:
    """Auto alt text, author lines ending in the same sentences, and soft line breaks across slides."""
    prs = Presentation()
    first = _title_slide(prs, "Artefacts")
    first.shapes.add_picture(io.BytesIO(_png()), Inches(1), Inches(1))._element.nvPicPr.cNvPr.set(
        "descr", "A cat\n\nAI-generated content may be incorrect."
    )
    first.shapes.add_textbox(
        Inches(1), Inches(4), Inches(3), Inches(1)
    ).text_frame.text = "Disclaimer: AI-generated content may be incorrect."
    first.notes_slide.notes_text_frame.text = "line one\vline two"
    only_picture = prs.slides.add_slide(prs.slide_layouts[6])
    only_picture.shapes.add_picture(io.BytesIO(_png()), Inches(1), Inches(1))._element.nvPicPr.cNvPr.set(
        "descr", "A dog\n\nDescription automatically generated"
    )
    last = _title_slide(prs, "Last")
    last.shapes.add_textbox(Inches(1), Inches(4), Inches(3), Inches(1)).text_frame.text = "end\vof deck"
    return _save(prs)


@pytest.mark.parametrize(
    "deck_source", ["contract", "pptx_multi_slide", "pptx_large_images_path", "absolute_targets", "artefacts"]
)
def test_joined_slides_equal_converting_the_whole_deck_at_once(
    deck_source: str, request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    if deck_source == "contract":
        deck = _contract_deck()
    elif deck_source == "absolute_targets":
        deck = _absolute_target_deck()
    elif deck_source == "artefacts":
        deck = _artefact_deck()
    else:
        fixture = request.getfixturevalue(deck_source)
        deck = fixture if isinstance(fixture, bytes) else fixture.read_bytes()
    whole = anydoc.to_markdown_bytes(deck, "pptx")
    raw: list[str] = []
    _capture_packages(monkeypatch, raw)
    pages = convert_pptx(deck, _limits())
    assert "\n".join(text for text in raw if text) == whole
    assert _joined(pages) == pptx_split._clean(whole)


def test_one_element_per_slide_numbered_in_presentation_order() -> None:
    pages = convert_pptx(_contract_deck(), _limits())
    assert [(page.pageNumber, page.label) for page in pages] == [(n, str(n)) for n in range(1, 7)]
    assert "Moved to the front" in pages[0].content
    assert "Opening slide" in pages[1].content
    assert "speaker notes for the opening" in pages[1].content
    assert "| head A | head B |" in pages[2].content
    assert "grouped text" in pages[3].content


def test_hidden_slide_is_kept_at_its_position() -> None:
    pages = convert_pptx(_contract_deck(), _limits())
    assert "Hidden slide" in pages[4].content


def test_slide_without_text_keeps_its_element_and_number() -> None:
    pages = convert_pptx(_contract_deck(), _limits())
    assert pages[5] == PageInfo(pageNumber=6, label="6", content="")


def test_fixture_deck_returns_one_element_per_slide(pptx_multi_slide: bytes) -> None:
    pages = convert_pptx(pptx_multi_slide, _limits())
    assert [page.label for page in pages] == ["1", "2", "3"]
    assert ["second slide body" in page.content for page in pages] == [False, True, False]


# ---------------------------------------------------------------------------
# What each per-slide package contains
# ---------------------------------------------------------------------------


def test_each_package_holds_one_slide_and_only_xml_parts(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _capture_packages(monkeypatch)
    convert_pptx(_contract_deck(), _limits())
    assert len(calls) == 6
    for package, fmt in calls:
        assert fmt == "pptx"
        with zipfile.ZipFile(io.BytesIO(package)) as zf:
            names = zf.namelist()
            presentation = zf.read(_PRESENTATION).decode()
        assert len([n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]) == 1
        assert all(n.endswith((".xml", ".rels")) for n in names), names
        assert presentation.count("sldId ") == 1


def test_large_images_are_left_out_of_the_packages(
    pptx_large_images_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _capture_packages(monkeypatch)
    pages = convert_pptx(pptx_large_images_path.read_bytes(), _limits())
    assert len(pages) == len(calls) == 12
    assert "slide with images follows" in pages[0].content
    assert max(len(package) for package, _ in calls) < 1024 * 1024


# ---------------------------------------------------------------------------
# Packages that do not pass the ZIP pre-check go to anydoc whole
# ---------------------------------------------------------------------------


def test_encrypted_pptx_is_handed_whole_and_reports_encrypted(
    pptx_encrypted: bytes, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls = _capture_packages(monkeypatch)
    assert _failure(pptx_encrypted).kind == "encrypted"
    assert calls == [(pptx_encrypted, "pptx")]


def test_non_zip_input_is_handed_whole_as_pptx(legacy_ppt: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = legacy_ppt.read_bytes()
    calls = _capture_packages(monkeypatch)
    with pytest.raises(ConversionError):
        convert_pptx(data, _limits())
    assert calls == [(data, "pptx")]


def test_whole_file_fallback_returns_one_unnumbered_element(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pptx_split, "convert_office", lambda data, fmt: "whole text\\\nnext\n")
    pages = convert_pptx(b"not a zip at all", _limits())
    assert pages == [PageInfo(pageNumber=None, label=None, content="whole text\nnext\n")]


# ---------------------------------------------------------------------------
# Cleanup of PowerPoint artefacts in anydoc's output
# ---------------------------------------------------------------------------

_AUTO_ALT_TEXTS = [
    "A screenshot of a computer\n\nAI-generated content may be incorrect.",
    "A picture containing text\n\nDescription automatically generated",
    "A close up of a sign\n\nDescription automatically generated with medium confidence",
    "テキスト が含まれている画像\n\n自動的に生成された説明",
    "コンピューターのスクリーンショット\n\nAI 生成コンテンツは誤りを含む可能性があります。",
]


def _deck_with_pictures(descriptions: list[str]) -> bytes:
    prs = Presentation()
    slide = _title_slide(prs, "Pictures")
    for index, description in enumerate(descriptions):
        picture = slide.shapes.add_picture(io.BytesIO(_png()), Inches(1 + index), Inches(1))
        picture._element.nvPicPr.cNvPr.set("descr", description)
    group = slide.shapes.add_group_shape()
    grouped = group.shapes.add_picture(io.BytesIO(_png()), Inches(1), Inches(3))
    grouped._element.nvPicPr.cNvPr.set("descr", "A grouped chart\n\nAI-generated content may be incorrect.")
    group.shapes.add_textbox(Inches(2), Inches(3), Inches(2), Inches(1)).text_frame.text = "grouped caption"
    slide.shapes.add_textbox(Inches(1), Inches(4), Inches(3), Inches(1)).text_frame.text = "after pictures"
    return _save(prs)


def test_powerpoint_auto_generated_alt_text_is_removed() -> None:
    (page,) = convert_pptx(_deck_with_pictures(_AUTO_ALT_TEXTS), _limits())
    for marker in ("screenshot", "picture containing", "close up", "grouped chart", "画像", "自動的", "AI"):
        assert marker not in page.content
    assert page.content == "## Pictures\n\ngrouped caption\n\nafter pictures\n"


_FIXED_SENTENCES = [
    "AI-generated content may be incorrect.",
    "Description automatically generated",
    "Description automatically generated with high confidence",
    "自動的に生成された説明",
    "AI 生成コンテンツは誤りを含む可能性があります。",
]


@pytest.mark.parametrize("sentence", _FIXED_SENTENCES)
@pytest.mark.parametrize("template", ["Disclaimer: {}", "社内ルール: {}", "| table-ish line {}", "{}", "Figure 3.\v{}"])
def test_author_text_ending_with_a_fixed_sentence_is_kept(template: str, sentence: str) -> None:
    text = template.format(sentence)
    (page,) = convert_pptx(_deck_with_text(text), _limits())
    assert page.content == text.replace("\v", "\n") + "\n"


@pytest.mark.parametrize("sentence", _FIXED_SENTENCES)
def test_notes_ending_with_a_fixed_sentence_are_kept(sentence: str) -> None:
    prs = Presentation()
    slide = _title_slide(prs, "Notes")
    slide.notes_slide.notes_text_frame.text = f"Speaker: remember {sentence}"
    (page,) = convert_pptx(_save(prs), _limits())
    assert f"Speaker: remember {sentence}" in page.content


def test_author_written_alt_text_is_kept() -> None:
    (page,) = convert_pptx(_deck_with_pictures(["Network diagram of the office"]), _limits())
    assert "Network diagram of the office" in page.content


def _deck_with_text(text: str) -> bytes:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(2)).text_frame.text = text
    return _save(prs)


def test_line_break_markers_at_line_end_are_removed() -> None:
    (page,) = convert_pptx(_deck_with_text("first line\vsecond line\vthird line"), _limits())
    assert page.content == "first line\nsecond line\nthird line\n"


def test_escaped_backslash_typed_by_the_author_survives() -> None:
    (page,) = convert_pptx(_deck_with_text("path C:\\\vnext line"), _limits())
    # anydoc escapes a literal backslash as "\\"; only the line-break marker after it goes.
    assert page.content == "path C:\\\\\nnext line\n"


# ---------------------------------------------------------------------------
# Relationship targets are resolved inside the package only
# ---------------------------------------------------------------------------


def _notes_deck() -> bytes:
    prs = Presentation()
    slide = _title_slide(prs, "Slide with notes")
    slide.notes_slide.notes_text_frame.text = "notes reached through an absolute target"
    return _save(prs)


def test_absolute_relationship_targets_are_resolved() -> None:
    deck = _rewrite(_notes_deck(), {_SLIDE1_RELS: lambda body: body.replace(b'Target="../', b'Target="/ppt/')})
    (page,) = convert_pptx(deck, _limits())
    assert "notes reached through an absolute target" in page.content


@pytest.mark.parametrize(
    ("target", "external"),
    [
        ("../../../outside.xml", False),
        ("/../outside.xml", False),
        ("http://example.invalid/remote.xml", True),
        ("../missing/part.xml", False),
    ],
)
def test_unsafe_external_or_missing_targets_are_skipped(
    target: str, external: bool, monkeypatch: pytest.MonkeyPatch
) -> None:
    rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
    deck = _rewrite(
        _notes_deck(), {_SLIDE1_RELS: lambda body: _with_relationship(body, "rId99", rel_type, target, external)}
    )
    # Present at the archive root, so clamping "../" to the root instead of refusing would pick it up.
    deck = _add_member(deck, "outside.xml", b"<x>outside marker</x>")
    calls = _capture_packages(monkeypatch)
    (page,) = convert_pptx(deck, _limits())
    assert "Slide with notes" in page.content
    with zipfile.ZipFile(io.BytesIO(calls[0][0])) as zf:
        assert not [n for n in zf.namelist() if "outside" in n or "missing" in n or "remote" in n]


def test_hyperlinked_other_slides_stay_out_of_the_package(monkeypatch: pytest.MonkeyPatch) -> None:
    prs = Presentation()
    for title in ("Linking slide", "Linked slide"):
        _title_slide(prs, title)
    slide_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
    deck = _rewrite(
        _save(prs), {_SLIDE1_RELS: lambda body: _with_relationship(body, "rId99", slide_type, "slide2.xml")}
    )
    calls = _capture_packages(monkeypatch)
    pages = convert_pptx(deck, _limits())
    assert [("Linked slide" in page.content) for page in pages] == [False, True]
    with zipfile.ZipFile(io.BytesIO(calls[0][0])) as zf:
        assert "ppt/slides/slide2.xml" not in zf.namelist()


# ---------------------------------------------------------------------------
# Limits (Req 2.6) and malformed packages (Req 1.11)
# ---------------------------------------------------------------------------


def _repeat_slide_entries(body: bytes, times: int) -> bytes:
    entry = re.search(rb"<p:sldId [^>]*/>", body)
    assert entry is not None
    return body.replace(entry.group(0), entry.group(0) * times, 1)


def test_slide_list_longer_than_the_entry_limit_is_rejected() -> None:
    prs = Presentation()
    _title_slide(prs, "only slide")
    deck = _rewrite(_save(prs), {_PRESENTATION: lambda body: _repeat_slide_entries(body, 200)})
    with zipfile.ZipFile(io.BytesIO(deck)) as zf:
        entries = len(zf.infolist())
    failure = _failure(deck, _limits(entries=entries))
    assert failure.kind == "limit_exceeded"


def test_bytes_read_across_slides_are_capped() -> None:
    prs = Presentation()
    slide = _title_slide(prs, "huge slide")
    slide.shapes.add_textbox(Inches(1), Inches(2), Inches(4), Inches(2)).text_frame.text = "x" * 400_000
    deck = _rewrite(_save(prs), {_PRESENTATION: lambda body: _repeat_slide_entries(body, 3)})
    with zipfile.ZipFile(io.BytesIO(deck)) as zf:
        assert sum(info.file_size for info in zf.infolist()) < 1024 * 1024
    assert _failure(deck, _limits(uncompressed_mb=1)).kind == "limit_exceeded"


def test_presentation_xml_that_is_not_well_formed_is_malformed() -> None:
    deck = _rewrite(_notes_deck(), {_PRESENTATION: lambda body: body[: len(body) // 2]})
    assert _failure(deck).kind == "malformed"


@pytest.mark.parametrize("part", [_PRESENTATION, "ppt/_rels/presentation.xml.rels", "[Content_Types].xml"])
def test_unknown_encoding_in_the_xml_declaration_is_malformed(part: str) -> None:
    declared = re.compile(rb"encoding=(['\"])[^'\"]*\1")
    deck = _rewrite(_notes_deck(), {part: lambda body: declared.sub(b'encoding="UTF-9"', body, count=1)})
    assert _failure(deck).kind == "malformed"


def test_entity_expansion_in_relationships_is_refused_as_malformed() -> None:
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;">]>'
        b'<Relationships xmlns="' + _REL_NS.encode() + b'"><Relationship Id="rId1" Type="t" Target="&b;"/>'
        b"</Relationships>"
    )
    deck = _rewrite(_notes_deck(), {_SLIDE1_RELS: lambda body: bomb})
    assert _failure(deck).kind == "malformed"


def test_slide_entry_pointing_at_no_relationship_is_malformed() -> None:
    deck = _rewrite(
        _notes_deck(),
        {_PRESENTATION: lambda body: re.sub(rb'r:id="rId\d+"/></p:sldIdLst>', b'r:id="rId404"/></p:sldIdLst>', body)},
    )
    assert _failure(deck).kind == "malformed"


def test_relationship_to_the_content_types_part_is_not_copied_as_a_part(monkeypatch: pytest.MonkeyPatch) -> None:
    rel_type = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml"
    deck = _rewrite(
        _notes_deck(), {_SLIDE1_RELS: lambda body: _with_relationship(body, "rId98", rel_type, "/[Content_Types].xml")}
    )
    calls = _capture_packages(monkeypatch)
    convert_pptx(deck, _limits())
    with zipfile.ZipFile(io.BytesIO(calls[0][0])) as zf:
        assert [info.filename for info in zf.infolist()].count("[Content_Types].xml") == 1


def test_presentation_without_slides_returns_no_elements() -> None:
    assert convert_pptx(_save(Presentation()), _limits()) == []
