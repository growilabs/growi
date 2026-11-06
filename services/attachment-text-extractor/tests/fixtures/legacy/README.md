# Legacy binary fixtures (DOC / PPT)

Legacy Word 97-2003 (`.doc`) and PowerPoint 97-2003 (`.ppt`) files cannot be
generated with Python alone, so — as the documented exception in
`design.md` → *Allowed Dependencies* — these two small files are copied
unmodified from the Apache POI test data. Every other fixture is generated
inside the tests (see `tests/fixture_files.py`).

- Source repository: https://github.com/apache/poi
- Commit: `07f1631dd66f647aacf2f43e3f408fe033aac4d0` (trunk, 2026-10-27)
- License: Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0)
- Upstream NOTICE: [`NOTICE-apache-poi.txt`](NOTICE-apache-poi.txt) (copied from `legal/NOTICE` at the same commit)

`tests/test_fixture_files.py` checks each file against the SHA-256 below, so
update this table whenever a file is replaced.

| File | Upstream path | Size (bytes) | SHA-256 |
|------|---------------|--------------|---------|
| `simple-table.doc` | `test-data/document/simple-table.doc` | 19456 | `67d7fe8e0555c16516354498a5935f24eeef90beb5efbf526f93a1d6c734da43` |
| `text_shapes.ppt` | `test-data/slideshow/text_shapes.ppt` | 11264 | `70c63540abc705da64764a9bcb5380bde9655264c2c3f047c3ee4b7dded3de3f` |

Converted with `anydoc.to_markdown_bytes(data, "doc")` / `(data, "ppt")`
(firecrawl-anydoc 0.2.4), they yield:

- `simple-table.doc`: a paragraph, a 2×3 table (`Cell 1,1` … `Cell 2,3`), and `This text is below the table.`
- `text_shapes.ppt`: `Title Placeholder`, `Text in a TextBox`, `Rectangle`, `Ellipse`, `Octagon`
