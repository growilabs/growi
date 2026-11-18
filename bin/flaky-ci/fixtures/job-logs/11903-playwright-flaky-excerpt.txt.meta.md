# Source

- **Real.** The fenced excerpt inside the `### Evidence` section of the body of
  [issue #11903](https://github.com/growilabs/growi/issues/11903), the tracking
  issue `detect-flaky-ci` created for that flake. Extracted with:
  `gh api -X GET repos/growilabs/growi/issues/11903 -q '.body'`, then the text
  between the fences of the `### Evidence` block, verbatim.
- **Why this one**: it is the `0 failed / 1 flaky` shape — the most common
  Playwright flake — and it pins one run with these facts:
  - `  1 flaky`, with **no `failed` line at all** — the absent line reads as
    `0` inside the run's counts;
  - `  106 passed (5.7m)`;
  - **no test line under `1 flaky`** (the excerpt was cut there), so the run's
    `flaky` list comes back `{ kind: "unreadable", reason: "count-mismatch" }`;
  - one `::error file=…,title=…` annotation printed mid-line, which is not read.
- **Note on the shape**: this excerpt was already ANSI-stripped and
  timestamp-stripped by the detect run that wrote the issue, so it exercises
  the "text that needs no normalization" path. The ESC-byte and caret-text
  paths are covered by `ci-app-test-100952911197-excerpt.txt` and
  `11849-repro-result-log-excerpt.txt` respectively.
- **Captured**: 2026-09-16.
