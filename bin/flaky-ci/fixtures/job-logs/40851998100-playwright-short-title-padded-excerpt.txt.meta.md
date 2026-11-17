# Source

- **Real.** The job log of GitHub Actions run 40851998100, job 123375420086
  (`test-prod-node24 / run-playwright (chromium, 2/2, 8.0)`, run on 2026-10-29), fetched with:
  `gh api --allow-escape-sequences repos/growilabs/growi/actions/jobs/123375420086/logs`
  (re-fetching needs the log to still be within GitHub's retention window).
- **How it was cut**: Log lines 4827-4836, one contiguous range: the timestamped empty line before the summary, the summary itself (`1 failed` with its test line, `112 did not run`, `1 passed (1.8m)`), the runner's `##[notice]` echo of the same summary (its continuation lines carry no timestamp), and the `##[error]Process completed with exit code 1.` line after it. Every kept line is copied
  verbatim from the log — timestamp prefixes, the byte sequences of the `›`
  separators, and the run of `─` characters that ends each test line are all
  preserved. Nothing was retyped.
- **What it is meant to verify**: a listed test whose line is shorter than 100 columns. Playwright pads every list line to 100 columns (counting the leading indent) with one space and then `─` characters, so this line ends in ` ─────…` rather than in a single space. The identity key read from it must equal the title of issue #11955 (`flaky: playwright:users:playwright/users.setup.ts:provision filter test users`) with no `─` left on it. The job concluded as failure; the test is in a setup project (`users`), not a browser project.
- **Captured**: 2026-11-17.
