# Source

- **Real, trimmed.** `gh api -X GET repos/growilabs/growi/compare/master...0d1a319a106b2a791e883170782e856f88b0e178 -q .status`
  returned `identical` (this commit *is* `master`'s tip at capture time). The
  full comparison response is ~1.2 MB (it embeds every commit and file diff
  between the two refs); `pr-owns-failure.ts` reads only `.status`, so only
  that field is kept here — the trimming does not change what the real API
  returned for that field.
- Commit `0d1a319a106b2a791e883170782e856f88b0e178` = "Merge pull request
  #11920 from growilabs/support/i18n-commynity-translation" on `master`.
- **Captured**: 2026-09-16.
