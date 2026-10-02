# Source

- **Real**: `gh api repos/growilabs/growi/commits/b9a64ded27e0ce4cc30a0563d5be5133db0f027a/check-runs?per_page=100`.
  Same commit as `read-repro-result.spec.ts`'s `CASE1_SHA` (issue #11823's
  confirmation measurement) — a `flaky-repro/**` branch's empty commit, so
  this is the one real example that carries a `flaky-repro` check-run
  (`completed` / `success`) and nothing else (no `ci-app-*` runs start on a
  `flaky-repro/**` branch).
- **Captured**: 2026-09-16.
