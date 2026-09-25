# Source

- **Constructed.** `detect-flaky-ci/SKILL.md`'s Step B narrative names a real
  past incident ("A real failing commit belonged to two PRs at once, one
  based on `master` and one on a feature branch, both of which changed the
  failing spec"), but no sha for that incident was recorded anywhere this
  task could find, so the shape is reconstructed rather than re-fetched.
- Used with `../pulls/constructed-pr-100-files.json` (does not touch the
  spec path) and `../pulls/constructed-pr-200-files.json` (does) to prove
  `pr-owns-failure.ts` checks **every** PR in `pulls[]`, not just `.[0]` —
  the exact regression the procedure's own comment warns against
  ("Consider every PR this returns, not `.[0]`").
- **Captured**: 2026-09-16 (constructed, not fetched).
