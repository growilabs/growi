# Source

- **Real.** The job log of GitHub Actions run 41984122671, job 127102413308
  (`test-prod-node24 / run-playwright (chromium, 1/2, 8.0)`, run on 2026-11-05), fetched with:
  `gh api --allow-escape-sequences repos/growilabs/growi/actions/jobs/127102413308/logs`
  (re-fetching needs the log to still be within GitHub's retention window).
- **How it was cut**: Log lines 11096-11097 (the first `##[error]` annotation line of the failing test and its untimestamped continuation line) and 17172-17184 (the end of the test output and the summary: `1 failed` with its test line, `1 did not run`, `118 passed`, and the `##[notice]` echo of the same). Every kept line is copied
  verbatim from the log — timestamp prefixes, the byte sequences of the `›`
  separators, and the single trailing space that ends every test line of a
  list are all preserved. Nothing was retyped.
- **What it is meant to verify**: a test that failed on every attempt: the summary has a `1 failed` heading with its list and **no `flaky` heading**, plus a `1 did not run` count line that has no list lines under it. The job (and its run) concluded as failure.
- **Captured**: 2026-11-17.
