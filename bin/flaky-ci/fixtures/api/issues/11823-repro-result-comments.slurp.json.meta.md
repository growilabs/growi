# Source

- **Real.** `gh api "repos/growilabs/growi/issues/11823/comments?per_page=100" --paginate --slurp`
  against the real `growilabs/growi` repository.
- Issue: [#11823](https://github.com/growilabs/growi/issues/11823) — "flaky:
  vitest:.../g2g-transfer-key-keep-alive.integ.ts:...". Carries two
  `### Repro result` comments, one per commit (pre-fix confirmation SHA
  `b9a64ded...`, post-fix verification SHA `89af5caf...`) — used for the
  "read the tally for a given commit" cases in `expected/read-repro-result.md`.
- **Captured**: 2026-09-16.
