# Source

- **Real.** The job log of GitHub Actions run 43419616882, job 131867595740
  (`test-prod-node24 / run-playwright (firefox, 1/2, 8.0)`, run on 2026-11-13), fetched with:
  `gh api --allow-escape-sequences repos/growilabs/growi/actions/jobs/131867595740/logs`
  (re-fetching needs the log to still be within GitHub's retention window).
- **How it was cut**: Log lines 6953-6957 (the two `##[error]` annotation lines of the flaky test, each followed by its untimestamped continuation lines), 16363-16370 (the summary of the first Playwright execution, the normal run) and 16488-16492 (the summary of the second execution, the guest-mode run); the gaps between them are the non-summary lines of the real log. Every kept line is copied
  verbatim from the log — timestamp prefixes, the byte sequences of the `›`
  separators, and the single trailing space that ends every test line of a
  list are all preserved. Nothing was retyped.
- **What it is meant to verify**: one job log contains the summaries of **two** Playwright executions — the normal run (`1 flaky` / `119 passed`) and the guest-mode run (`3 passed`) — and each summary appears twice, as the plain list and as the runner's `##[notice]` echo of it (the echo's continuation lines carry no timestamp). The flaky test is reported by an `##[error]` annotation only; there is no `::error file=` form. A reader must treat each execution's list as a separate run and must not read the echo as a second set of tests.
- **Captured**: 2026-11-17.
