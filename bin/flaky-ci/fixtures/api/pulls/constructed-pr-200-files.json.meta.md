# Source

- **Constructed** (see `../commits/constructed-two-prs-pulls.json.meta.md`).
  PR #200's changed files — matches the test's `--spec-path` by suffix
  (`apps/app/`-rooted filename vs. the `apps/app`-relative `--spec-path`).
  Only this **later** PR in `pulls[]` matches, which is the regression this
  fixture pair exists to prove `pr-owns-failure.ts` does not miss by
  short-circuiting on the first PR.
- **Captured**: 2026-09-16 (constructed, not fetched).
