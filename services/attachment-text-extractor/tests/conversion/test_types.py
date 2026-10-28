"""Shared conversion-layer types: failure kinds, limits value object, format/route types."""

import dataclasses
from typing import get_args

import pytest

EXPECTED_KINDS = {
    "unsupported",
    "encrypted",
    "malformed",
    "limit_exceeded",
    "memory_exceeded",
    "result_too_large",
    "timeout",
    "crashed",
    "internal",
}


def test_failure_kinds_match_design() -> None:
    from app.conversion.errors import FailureKind

    assert set(get_args(FailureKind)) == EXPECTED_KINDS


def test_conversion_error_carries_kind_and_detail() -> None:
    from app.conversion.errors import ConversionError

    err = ConversionError("encrypted", "password protected")
    assert isinstance(err, Exception)
    assert err.kind == "encrypted"
    assert err.detail == "password protected"


def test_conversion_failure_is_frozen_value() -> None:
    from app.conversion.errors import ConversionFailure

    f = ConversionFailure(kind="timeout", detail="too slow")
    assert (f.kind, f.detail) == ("timeout", "too slow")
    with pytest.raises(dataclasses.FrozenInstanceError):
        f.kind = "crashed"  # type: ignore[misc]


def test_conversion_outcome_is_union_of_success_and_failure() -> None:
    from app.conversion.errors import ConversionFailure
    from app.conversion.results import ConversionOutcome, ConversionSuccess

    assert set(get_args(ConversionOutcome)) == {ConversionSuccess, ConversionFailure}


def test_route_and_format_literals() -> None:
    from app.conversion.formats import AnydocFormat, Route, TextKind

    assert set(get_args(Route)) == {"pdf", "pptx", "xlsx", "office", "text"}
    assert set(get_args(TextKind)) == {"plain", "html", "xml", "ipynb", "csv"}
    assert set(get_args(AnydocFormat)) == {
        "doc", "docx", "odt", "ppt", "pptx", "rtf", "epub", "xlsx", "ods", "odp", "csv",
    }  # fmt: skip


def test_resolved_format_fields() -> None:
    from app.conversion.formats import ResolvedFormat

    r = ResolvedFormat(mime_type="application/pdf", route="pdf", anydoc_format=None, text_kind=None)
    assert r.route == "pdf"
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.route = "text"  # type: ignore[misc]


def test_limits_from_settings_with_fixed_ipynb_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import Settings
    from app.conversion.limits import ConversionLimits

    monkeypatch.setenv("ATTACHMENT_EXTRACTOR_SERVICE_TOKEN", "tok")
    monkeypatch.setenv("IPYNB_OUTPUT_MAX_CHARS", "1")  # must NOT be a setting
    limits = ConversionLimits.from_settings(Settings())

    assert limits == ConversionLimits(
        max_child_rss_mb=320,
        max_result_bytes=16 * 1024 * 1024,
        max_pdf_pages=5000,
        max_archive_entries=10000,
        max_archive_uncompressed_mb=512,
        max_xlsx_cells=100000,
        ipynb_output_max_chars=10000,
    )
    assert not hasattr(Settings(), "IPYNB_OUTPUT_MAX_CHARS")


def test_limits_is_frozen() -> None:
    from app.conversion.limits import ConversionLimits

    assert dataclasses.is_dataclass(ConversionLimits)
    assert ConversionLimits.__dataclass_params__.frozen  # type: ignore[attr-defined]
