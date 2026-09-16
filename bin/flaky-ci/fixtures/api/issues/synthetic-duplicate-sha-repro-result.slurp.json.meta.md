# Source

- **Synthetic.** Task 1.3 searched for a real issue with two
  `### Repro result` comments naming the *same* commit SHA (e.g. a manually
  re-run repro job) via
  `gh api -X GET search/issues -f q='repo:growilabs/growi "Repro result" in:comments'`.
  That search returns only 3 issues repo-wide that have ever carried such a
  comment (#11819, #11823, #11849); none has a same-SHA duplicate.
- Built by taking the real comment object `id: 5667125454` from
  `11823-repro-result-comments.slurp.json` (verbatim shape: every field,
  type and nesting is real) and adding a second comment for the *same*
  `- Commit: b9a64ded...` line, changed `id`/`created_at`/`body`
  (`- Failed: 1`, `- Per-run: pass, fail, pass`) only, to simulate a manual
  re-run 5 minutes later.
- **Captured/constructed**: 2026-09-16.
