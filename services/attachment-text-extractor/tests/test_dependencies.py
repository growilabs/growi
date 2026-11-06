"""Smoke checks that the conversion libraries resolve in the environment."""

import importlib
import importlib.metadata
import re
import tomllib
from pathlib import Path

import pytest

PRODUCTION_MODULES = ["anydoc", "pypdfium2", "charset_normalizer", "defusedxml"]
TEST_ONLY_MODULES = ["openpyxl", "pptx", "docx", "pypdf", "msoffcrypto", "xlwt", "yaml"]


@pytest.mark.parametrize("module_name", PRODUCTION_MODULES + TEST_ONLY_MODULES)
def test_dependency_is_importable(module_name: str) -> None:
    assert importlib.import_module(module_name) is not None


def test_anydoc_is_pinned_and_exposes_markdown_api() -> None:
    import anydoc

    assert importlib.metadata.version("firecrawl-anydoc") == "0.2.4"
    assert callable(anydoc.to_markdown_bytes)


def test_anydoc_converts_csv_without_network() -> None:
    import anydoc

    out = anydoc.to_markdown_bytes(b"a,b\n1,2\n", "csv")
    assert "a" in out and "2" in out


def test_production_dependencies_exclude_external_binary_and_removed_libraries() -> None:
    pyproject = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    declared = {re.split(r"[\[<>=!~ ;]", spec, maxsplit=1)[0].lower() for spec in pyproject["project"]["dependencies"]}
    banned = {"markitdown", "pdfminer.six", "pdfplumber", "lxml", "openpyxl", "pypdf", "pytesseract", "ocrmypdf"}
    assert declared.isdisjoint(banned)
