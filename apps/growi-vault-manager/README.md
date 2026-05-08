# growi-vault-manager

Exports GROWI pages to a git repository (vault) in Markdown format.

---

## Path-to-Filename Mapping Rules

`VaultPathMapper` converts a GROWI page path into a deterministic git-tree file path. The same `(pagePath, pageId)` pair always produces the same file path, so the vault can reconstruct any file path from a page record without a reverse-index collection.

These rules are versioned (v1) and are **immutable after the first release**.

### Encoding rules (applied in order)

| Rule | Trigger | Transform |
|------|---------|-----------|
| Windows reserved characters | `<` `>` `:` `"` `/` `\` `\|` `?` `*` appear in a segment | Percent-encode each character (e.g. `<` → `%3C`, `*` → `%2A`) |
| Control characters | U+0000–U+001F or U+007F (DEL) appear in a segment | Percent-encode each character |
| Leading / trailing spaces | Segment starts or ends with a space | Percent-encode the space (`%20`) |
| Windows reserved filename | Segment stem matches `CON`, `PRN`, `AUX`, `NUL`, `COM0-9`, `LPT0-9` (case-insensitive) | Prepend `_` to the segment (e.g. `CON` → `_CON`) |
| Uppercase letters anywhere in the full path | `pagePath !== pagePath.toLowerCase()` | Append `__<pageId[0..7]>` suffix to the **last** filename component before the `.md` extension |
| Orphan pages | Path is `/trash` or starts with `/trash/` | Prefix the entire relative path with `_orphaned/` |
| Extension | All pages | Append `.md` to the final filename component |

### Examples

| GROWI page path | pageId (first 8 chars) | Resulting file path |
|----------------|------------------------|---------------------|
| `/normal/page` | *(any)* | `normal/page.md` |
| `/Sandbox/Markdown` | `507f1f77` | `Sandbox/Markdown__507f1f77.md` |
| `/CON/notes` | `507f1f77` | `_CON/notes__507f1f77.md` |
| `/con/notes` | *(any)* | `_con/notes.md` |
| `/page<name` | *(any, lowercase)* | `page%3Cname.md` |
| `/page*name` | *(any, lowercase)* | `page%2Aname.md` |
| `/trash/old-page` | *(any, lowercase)* | `_orphaned/trash/old-page.md` |
| `/trash/A/B` | `507f1f77` | `_orphaned/trash/A/B__507f1f77.md` |

> **Note on `/`**: The forward-slash is GROWI's path separator and is split into segments before encoding. A literal `/` that appears inside a segment would be encoded as `%2F`, but GROWI path semantics make this impossible in practice.

### `mapPrefix` (directory prefix variant)

`mapPrefix(pagePath)` applies the same segment encoding and reserved-name prefixing but does **not** append `.md` and does **not** add the pageId suffix. It is used for rename-prefix and grant-change-prefix instructions where only the directory portion matters.

---

## Excluding `/user` pages with git sparse-checkout

To clone a vault while excluding all personal pages stored under `user/`, use git sparse-checkout:

```bash
git clone --no-checkout <url> my-growi-vault
cd my-growi-vault
git sparse-checkout init --cone
git sparse-checkout set '/*' '!/user'
git checkout HEAD
```

> **Important**: sparse-checkout only controls which files are materialized in your **working tree**. It does not affect the objects transferred from the server — the full history is still fetched. To limit server-side object delivery, a partial-clone filter (e.g. `--filter=blob:none`) is needed in addition to sparse-checkout.

---

## MVP Scope Limitations

The following items are **not supported** in the current MVP:

- **`git push` (write-back)** — the vault is read-only; changes made to Markdown files in the vault are not written back to GROWI.
- **Attachments** — binary files attached to pages are not exported.
- **Per-page metadata** — comments, likes, bookmarks, tags, and similar social/annotation metadata are not exported.
- **Revision history before feature activation** — only revisions created after the vault feature is enabled are captured; pre-existing history is not back-filled.
- **Drafts and unpublished pages** — only published pages are exported to the vault.
