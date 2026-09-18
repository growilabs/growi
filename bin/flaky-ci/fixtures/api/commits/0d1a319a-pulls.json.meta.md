# Source

- **Real.** `gh api -X GET repos/growilabs/growi/commits/0d1a319a106b2a791e883170782e856f88b0e178/pulls`.
- Full raw response (1 PR: #11920, base `master`, state `closed`). Used
  together with `../compare/master-identical-0d1a319a.json` as the
  "ancestor exists, PR exists" test row — `pr-owns-failure.ts` computes
  `pulls[]`/`touchesSpec` unconditionally even when `ancestryStatus` is
  `identical` (see Implementation Notes for why).
- **Captured**: 2026-09-16.
