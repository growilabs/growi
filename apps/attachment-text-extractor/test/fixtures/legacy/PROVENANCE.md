# Legacy binary fixtures (DOC / PPT)

Legacy Word 97-2003 (`.doc`) and PowerPoint 97-2003 (`.ppt`) files are the only
test documents that are committed instead of generated (design.md, D5). Every
other fixture is built by the generators in `test/fixtures/`.

These two files are copied unmodified from the Apache POI test data. They were
first vendored for the Python service and copied here from
`services/attachment-text-extractor/tests/fixtures/legacy/` (introduced in
commit `8b4942f26c`), byte for byte.

- Source repository: https://github.com/apache/poi
- Commit: `07f1631dd66f647aacf2f43e3f408fe033aac4d0` (trunk, 2026-10-27)
- License: Apache License 2.0 ([`LICENSE-apache-2.0.txt`](LICENSE-apache-2.0.txt), https://www.apache.org/licenses/LICENSE-2.0)
- Upstream NOTICE: [`NOTICE-apache-poi.txt`](NOTICE-apache-poi.txt) (copied from `legal/NOTICE` at the same commit)

`legacy.spec.ts` checks each file against the SHA-256 below, so update this
table whenever a file is replaced.

| File | Upstream path | Size (bytes) | SHA-256 |
|------|---------------|--------------|---------|
| `simple-table.doc` | `test-data/document/simple-table.doc` | 19456 | `67d7fe8e0555c16516354498a5935f24eeef90beb5efbf526f93a1d6c734da43` |
| `text_shapes.ppt` | `test-data/slideshow/text_shapes.ppt` | 11264 | `70c63540abc705da64764a9bcb5380bde9655264c2c3f047c3ee4b7dded3de3f` |

Converted with anydoc 0.2.4 (`toMarkdownBytes(data, 'doc')` / `(data, 'ppt')`),
they yield:

- `simple-table.doc`: a paragraph, a 2×3 table (`Cell 1,1` … `Cell 2,3`), and `This text is below the table.`
- `text_shapes.ppt`: `Title Placeholder`, `Text in a TextBox`, `Rectangle`, `Ellipse`, `Octagon`
