# Test Fixtures

Real documents are not committed. Binary test documents are generated inside
the test run as session-scoped pytest fixtures defined in
[`tests/fixture_files.py`](../fixture_files.py) and registered for every test
directory through `tests/conftest.py`. `tests/test_fixture_files.py` checks that
each fixture is what its name claims.

## Committed files

| Path | Notes |
|------|-------|
| `sample.txt` | Plain text — Unicode + special chars |
| `sample.json` | JSON — nested object, array |
| `legacy/` | Legacy DOC / PPT copied from Apache POI test data (Apache-2.0). They cannot be generated with Python; source, commit, license and SHA-256 are in [`legacy/README.md`](legacy/README.md) |

## Generated fixtures

Fixtures named `*_path` are large: each is written once per session under
pytest's temporary directory and returned as a `Path`. All others return `bytes`.

| Fixture | Content |
|---------|---------|
| `xlsx_multi_sheet` | Sheets `売上`, `Summary <#1>`, `Empty` (no cells) |
| `xlsx_single_sheet` | One sheet `OnlySheet` |
| `xlsx_hidden_sheet` | `Visible` + hidden `Secret` |
| `xlsx_chart_sheet` | `Data` worksheet + `Chart` chartsheet |
| `xlsx_over_cell_limit_path` | Exactly `MAX_XLSX_CELLS + 1` cells |
| `xlsx_large_for_timeout_path` | 5 sheets × 20,000 rows × 1 column = exactly `MAX_XLSX_CELLS` (passes the cell pre-check) |
| `pptx_multi_slide` | 3 slides with title + body |
| `docx_large_images_path` / `pptx_large_images_path` | 40–50 MiB, 11 random-pixel PNGs (incompressible) |
| `docx_encrypted` / `xlsx_encrypted` / `pptx_encrypted` | Agile-encrypted OOXML; password from the `office_password` fixture |
| `pdf_text` | 3 pages, `PDF page N` each |
| `pdf_user_password` | Needs the `pdf_password` fixture to open |
| `pdf_owner_password_only` | Permissions restricted only; opens without a password |
| `pdf_image_only` | One page with an image and no text |
| `pdf_corrupt` | `%PDF-` header followed by garbage |
| `docx_zip_bomb_path` | Small DOCX whose `word/document.xml` expands past `MAX_ARCHIVE_UNCOMPRESSED_MB` |
| `docx_deeply_nested` | DOCX with 100,000 nested `w:sdt` levels |
| `text_shift_jis` / `text_euc_jp` / `text_utf8_bom` | The same Japanese sample in each encoding |
| `odt` / `ods` / `odp` / `epub` / `rtf` | Assembled with `zipfile` / strings |
| `xls` | BIFF8 workbook (`First`, `Second`) written by `xlwt` |
| `legacy_doc` / `legacy_ppt` | Paths to the vendored files in `legacy/` |
