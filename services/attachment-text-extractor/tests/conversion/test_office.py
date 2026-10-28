"""OfficeConverter contract tests against the pinned anydoc (Req 1.5, 1.7, 1.8, 1.10, 1.11, 2.6)."""

import io
import traceback
import zipfile
from collections.abc import Callable
from pathlib import Path

import anydoc
import pytest

from app.conversion.errors import ConversionError
from app.conversion.formats import AnydocFormat
from app.conversion.office import convert_office
from fixture_files import ENCRYPTED_MARKER, JAPANESE_SAMPLE, make_docx

_SECRET = "TOPSECRET-BODY"


def _failure(data: bytes, fmt: AnydocFormat) -> ConversionError:
    with pytest.raises(ConversionError) as excinfo:
        convert_office(data, fmt)
    return excinfo.value


def _logged(failure: ConversionError) -> str:
    """What logger.exception() would print for this failure, chained causes included."""
    return "".join(traceback.format_exception(failure))


def _docx_with_document_xml(body: bytes) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(make_docx("base")), "r") as src, zipfile.ZipFile(buf, "w") as out:
        for info in src.infolist():
            out.writestr(info, body if info.filename == "word/document.xml" else src.read(info))
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Successful conversion into one text
# ---------------------------------------------------------------------------


def test_docx_converts_into_one_text() -> None:
    text = convert_office(make_docx("DOCX body marker"), "docx")
    assert "DOCX body marker" in text


def test_rtf_converts_into_one_text(rtf: bytes) -> None:
    text = convert_office(rtf, "rtf")
    assert "RTF body marker" in text
    assert "本番環境で発生した情報システムの障害" in text


def test_epub_converts_into_one_text(epub: bytes) -> None:
    text = convert_office(epub, "epub")
    assert "EPUB chapter marker" in text
    assert "第一章" in text


def test_csv_without_a_signature_converts_because_the_format_is_explicit() -> None:
    text = convert_office("名前,値\nりんご,1\n".encode(), "csv")
    assert "りんご" in text
    assert "名前" in text


def test_legacy_doc_converts_into_one_text(legacy_doc: Path) -> None:
    text = convert_office(legacy_doc.read_bytes(), "doc")
    assert "Cell 1,1" in text


def test_legacy_ppt_converts_into_one_text(legacy_ppt: Path) -> None:
    text = convert_office(legacy_ppt.read_bytes(), "ppt")
    assert "Text in a TextBox" in text


def test_legacy_xls_converts_under_the_xlsx_format_name(xls: bytes) -> None:
    text = convert_office(xls, "xlsx")
    assert "XLS cell marker" in text
    assert "second sheet" in text


@pytest.mark.parametrize(
    ("fixture_name", "fmt", "marker"),
    [
        ("odt", "odt", "OpenDocument text marker"),
        ("ods", "ods", "OpenDocument sheet marker"),
        ("odp", "odp", "OpenDocument slide marker"),
    ],
)
def test_opendocument_converts_into_one_text(
    request: pytest.FixtureRequest, fixture_name: str, fmt: AnydocFormat, marker: str
) -> None:
    text = convert_office(request.getfixturevalue(fixture_name), fmt)
    assert marker in text


def test_returns_text_for_japanese_docx() -> None:
    text = convert_office(make_docx(JAPANESE_SAMPLE.replace("\n", " ")), "docx")
    assert "障害対応メモ" in text


# ---------------------------------------------------------------------------
# No external transmission (Req 1.7)
# ---------------------------------------------------------------------------


def test_calls_anydoc_with_the_explicit_format_and_no_ocr_option(monkeypatch: pytest.MonkeyPatch) -> None:
    # anydoc is the outbound boundary: any `ocr` option other than the default can send the whole
    # document to Firecrawl's hosted service, so the exact call made across it is the contract.
    calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def fake(*args: object, **kwargs: object) -> str:
        calls.append((args, kwargs))
        return "converted"

    monkeypatch.setattr(anydoc, "to_markdown_bytes", fake)

    assert convert_office(b"payload", "docx") == "converted"
    assert calls == [((b"payload", "docx"), {})]


# ---------------------------------------------------------------------------
# Failure classification with real inputs
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("fixture_name", "fmt"),
    [("docx_encrypted", "docx"), ("xlsx_encrypted", "xlsx"), ("pptx_encrypted", "pptx")],
)
def test_encrypted_office_files_are_encrypted(
    request: pytest.FixtureRequest, fixture_name: str, fmt: AnydocFormat
) -> None:
    assert _failure(request.getfixturevalue(fixture_name), fmt).kind == "encrypted"


def test_truncated_docx_is_malformed() -> None:
    data = make_docx("truncated")
    assert _failure(data[: len(data) // 2], "docx").kind == "malformed"


def test_docx_with_broken_xml_is_malformed() -> None:
    assert _failure(_docx_with_document_xml(b"<w:document <<<"), "docx").kind == "malformed"


def test_docx_without_its_document_part_is_malformed() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(make_docx("base")), "r") as src, zipfile.ZipFile(buf, "w") as out:
        for info in src.infolist():
            if info.filename != "word/document.xml":
                out.writestr(info, src.read(info))
    assert _failure(buf.getvalue(), "docx").kind == "malformed"


def test_legacy_binary_given_as_docx_is_malformed(legacy_ppt: Path) -> None:
    assert _failure(legacy_ppt.read_bytes(), "docx").kind == "malformed"


def test_docx_expanding_past_the_entry_limit_is_limit_exceeded(docx_zip_bomb_path: Path) -> None:
    failure = _failure(docx_zip_bomb_path.read_bytes(), "docx")
    assert failure.kind == "limit_exceeded"
    assert "max_entry_bytes" in failure.detail


def test_deeply_nested_docx_is_limit_exceeded(docx_deeply_nested: bytes) -> None:
    failure = _failure(docx_deeply_nested, "docx")
    assert failure.kind == "limit_exceeded"
    assert "max_xml_depth" in failure.detail


# ---------------------------------------------------------------------------
# No file content in the failure detail
# ---------------------------------------------------------------------------


def test_malformed_detail_does_not_echo_the_bytes_anydoc_quotes() -> None:
    # anydoc's CFB error quotes the first bytes of the input, i.e. file content.
    data = (_SECRET * 50).encode()
    with pytest.raises(anydoc.MalformedError) as raw:
        anydoc.to_markdown_bytes(data, "doc")
    quoted = ", ".join(f"{b:x}" for b in data[:8])
    assert quoted in str(raw.value)

    failure = _failure(data, "doc")
    assert failure.kind == "malformed"
    assert quoted not in failure.detail
    assert quoted not in str(failure)
    assert quoted not in _logged(failure)
    assert _SECRET not in failure.detail


def test_limit_detail_does_not_echo_part_names_from_the_archive(docx_zip_bomb_path: Path) -> None:
    failure = _failure(docx_zip_bomb_path.read_bytes(), "docx")
    assert "word/document.xml" not in failure.detail
    assert "word/document.xml" not in str(failure)
    assert "word/document.xml" not in _logged(failure)


def test_encrypted_detail_does_not_contain_the_document_text(docx_encrypted: bytes) -> None:
    failure = _failure(docx_encrypted, "docx")
    assert ENCRYPTED_MARKER not in failure.detail


# ---------------------------------------------------------------------------
# Failures that real inputs cannot reach reliably
# ---------------------------------------------------------------------------


class PanicException(BaseException):  # noqa: N818 — mirrors pyo3's name
    """Stand-in for ``pyo3_runtime.PanicException``, which derives from BaseException."""


PanicException.__module__ = "pyo3_runtime"


def _raising(exc: BaseException) -> Callable[..., str]:
    def fake(*_args: object, **_kwargs: object) -> str:
        raise exc

    return fake


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (anydoc.UnsupportedError(f"unsupported: {_SECRET}"), "unsupported"),
        (anydoc.MissingPartError(f"missing required part: {_SECRET}"), "malformed"),
        (PanicException(f"index out of bounds: {_SECRET}"), "internal"),
        (anydoc.NeedsOcrError(_SECRET), "internal"),
        (RuntimeError(_SECRET), "internal"),
        (ValueError(_SECRET), "internal"),
    ],
)
def test_other_exceptions_are_classified_without_leaking_their_message(
    monkeypatch: pytest.MonkeyPatch, exc: BaseException, kind: str
) -> None:
    monkeypatch.setattr(anydoc, "to_markdown_bytes", _raising(exc))
    failure = _failure(b"payload", "docx")
    assert failure.kind == kind
    assert _SECRET not in failure.detail
    assert _SECRET not in str(failure)
    assert _SECRET not in _logged(failure)


@pytest.mark.parametrize("exc_type", [KeyboardInterrupt, SystemExit])
def test_interpreter_exits_are_not_swallowed(monkeypatch: pytest.MonkeyPatch, exc_type: type[BaseException]) -> None:
    monkeypatch.setattr(anydoc, "to_markdown_bytes", _raising(exc_type()))
    with pytest.raises(exc_type):
        convert_office(b"payload", "docx")
