# Test Fixtures

This directory contains sample input files used by the markitdown-extractor test suite.

## Currently Available

| File | Format | Notes |
|------|--------|-------|
| `sample.txt` | Plain text | Unicode + special chars |
| `sample.json` | JSON | Nested object, array |

## Placeholders (to be generated)

The following binary formats require generated fixture files.
Run `generate_fixtures.py` to create them (requires the dev dependencies).

| File | Format | Content description |
|------|--------|---------------------|
| `sample.pdf` | PDF | 3-page document with headings + body text |
| `sample.pptx` | PowerPoint | 5 slides, each with a title and bullet points |
| `sample.xlsx` | Excel | 2 sheets: "Sheet1" and "Summary" |
| `sample.docx` | Word | Single-section document with heading + paragraphs |

## Generating Binary Fixtures

```bash
cd services/markitdown-extractor
uv run python tests/fixtures/generate_fixtures.py
```

This script creates minimal but valid binary files using `python-pptx`,
`openpyxl`, `python-docx`, and `reportlab` (or `fpdf2`).  These packages are
**not** listed in `pyproject.toml` dev dependencies because they are only
needed once to regenerate fixtures — the generated files are committed to the
repository and do not need to be regenerated on every CI run.

> **Note**: If you only need `.txt` and `.json` fixtures (tasks 1.4 and 3.4),
> the binary placeholders are not required.  They are consumed by tasks 3.1
> (PDF), 3.2 (PPTX), and 3.3 (XLSX).
