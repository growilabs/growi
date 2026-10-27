# Source

- **Real.** `gh api -X GET repos/growilabs/growi/issues -f state=all -f labels=flaky/observing -f per_page=2 -f page=1` against `growilabs/growi`.
- 2 issues: #11870 (closed, 0 comments), #11800 (closed, 2 comments) — deliberately non-overlapping with the `flaky/confirmed` page above, to exercise fetch-flaky-issues.ts merging distinct per-label results.
- **Captured**: 2026-09-16.
