# Source

- **Real.** The job log of GitHub Actions run 39935584265, job 120355439616
  (`test-prod-node24 / run-playwright (firefox, 1/2, 6.0)`, run on 2026-10-23), fetched with:
  `gh api --allow-escape-sequences repos/growilabs/growi/actions/jobs/120355439616/logs`
  (re-fetching needs the log to still be within GitHub's retention window).
- **How it was cut**: Log lines 5728-5729 (the `##[error]` annotation line and its untimestamped continuation line), 15466-15477 (the end of the test output and the summary: the `2 flaky` heading, its two test lines, `118 passed`, and the `##[notice]` echo of the same) and 15594-15598 (the summary of the guest-mode execution, `3 passed`). Every kept line is copied
  verbatim from the log — timestamp prefixes, the byte sequences of the `›`
  separators, and the single trailing space that ends every test line of a
  list are all preserved. Nothing was retyped.
- **What it is meant to verify**: a summary whose `2 flaky` heading is followed by exactly two test lines, one from each of two different spec files, so the number of list entries equals the heading count and each entry yields its own `path:line:col` position and title (the second title is long and contains `;`).
- **Captured**: 2026-11-17.
