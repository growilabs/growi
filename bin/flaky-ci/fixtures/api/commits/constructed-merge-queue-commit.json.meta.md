# Source

- **Constructed** (see `constructed-empty-pulls.json.meta.md` for why a real
  Mergify merge-queue commit could not be captured).
- Shape follows `detect-flaky-ci/SKILL.md`'s documented merge-queue commit
  message format: first line `Merge of #{PR_NUMBER}` (here `#12345`), used
  by `pr-owns-failure.ts` as the fallback source of `pulls[]` when
  `GET commits/{sha}/pulls` returns `[]`. The body deliberately includes
  `Refs #999` and `Fixes #1` — arbitrary `#{N}` tokens that must NOT be
  picked up by the extraction regex, per the procedure's existing warning
  ("Do not scrape arbitrary `#{N}` tokens from the rest of the message").
- **Captured**: 2026-09-16 (constructed, not fetched).
