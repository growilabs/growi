# Source

Both entries are **constructed**, not real — a deliberate search found no
real example of either shape currently open, closed, or ever titled that
way in `growilabs/growi`:

- **`playwrightJobLevel`**: `flaky: playwright:chromium` — the job-level
  fallback identity key `detect-flaky-ci/SKILL.md` documents for when it
  "could not isolate which spec was flaky from the CI log alone" (see
  `investigate-flaky-test/SKILL.md` Step 1's description of
  `playwright:{BROWSER}`). Searched with
  `gh api search/issues -f q='repo:growilabs/growi "flaky: playwright:" in:title' --paginate -q '.items[].title'`
  and grepped for a title ending in `:chromium` / `:firefox` / `:webkit`
  with nothing after — zero matches across the whole search index (open and
  closed). Every real `playwright:` title in `flaky-issue-titles.json`
  carries a full spec path.
- **`malformedVitest`**: `flaky: vitest:no-extension-anywhere-in-this-title`
  — a `vitest:` key whose remainder contains no source-file extension at
  all, so the spec-path regex cannot match. `investigate-flaky-test/
  SKILL.md` Step 1 states this case is never produced by `detect-flaky-ci`
  ("no `detect-flaky-ci` path produces one") — consistent with finding zero
  real examples of it. All 38 real `vitest:` titles in
  `flaky-issue-titles.json` parse as `precise`.

**Captured**: 2026-09-16 (constructed alongside the real-title search, same
session).
