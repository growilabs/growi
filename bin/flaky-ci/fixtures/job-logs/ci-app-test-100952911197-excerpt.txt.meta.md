# Source

- **Real.** Two excerpts of the log of job `100952911197`
  (`ci-app-test (24.x, 8.0)`) of run
  [33702741691](https://github.com/growilabs/growi/actions/runs/33702741691)
  (`Node CI for app development`, conclusion `failure`, 2026-09-03), fetched
  byte-for-byte with the command the procedure itself uses:

  ```bash
  gh api --allow-escape-sequences "repos/growilabs/growi/actions/jobs/100952911197/logs"
  ```

  The file is lines 4026–4048 followed by lines 4594–4678 of that response,
  concatenated with no other edit — **no `sed`, no re-colouring, no
  re-indentation**. Escape sequences are therefore true ESC bytes (`0x1b`),
  and every line carries the endpoint's `2026-09-04T07:59:07.xxxxxxxZ `
  timestamp prefix.

- **Why these two ranges**, out of a 517 KiB log:
  - **4026–4048** carry three lines that begin `FAIL ` but are **not** vitest
    failure blocks — the i18n-audit tool printing its own result through a
    test's stdout/stderr (`FAIL unused-key count 80 exceeds baseline 10
    (Requirement 2)`, `FAIL status --unused: …`, `FAIL status ko_KR: …`).
    The procedure's `grep 'FAIL '` cannot tell these from a real failure
    block; `job-log.extractFailBlocks` must, which is what the fixture pins.
  - **4594–4678** are the five real vitest failure blocks of that job (all
    from `export-pages-to-fs-async.spec.ts`, `MissingSchemaError`), each
    followed by vitest's `⎯⎯[n/5]⎯` divider, and then vitest's own run
    totals — ` Test Files  1 failed | 309 passed (310)` and
    ` Tests  5 failed | 4151 passed (4156)`. Those two lines are the reason
    the ranges end where they do: they contain the words `1 failed` and
    `5 failed`, and reading either as a Playwright shard summary would fire
    the tier-1 count test on a vitest job. `extractSummary` must return
    `null` for this file.

- **Captured**: 2026-09-16.
