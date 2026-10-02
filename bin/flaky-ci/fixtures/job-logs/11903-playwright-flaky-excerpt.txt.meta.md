# Source

- **Real.** The fenced excerpt inside the `### Evidence` section of the body of
  [issue #11903](https://github.com/growilabs/growi/issues/11903), the tracking
  issue `detect-flaky-ci` created for that flake. Extracted with:
  `gh api -X GET repos/growilabs/growi/issues/11903 -q '.body'`, then the text
  between the fences of the `### Evidence` block, verbatim.
- **Why this one**: it is the `0 failed / 1 flaky` shape — the most common
  Playwright flake — and it carries all three facts `parse-job-log` has to
  return for a Playwright shard in one place:
  - one `::error file=…,title=…` annotation printed **mid-line** (the
    annotation's message follows on the same line after `::`), whose `title=`
    value contains `›`, `:` and parentheses;
  - `  1 flaky`, with **no `failed` line at all** — the absent line reads as
    `0` inside a captured summary;
  - `  106 passed (5.7m)`.
- **Note on the shape**: this excerpt was already ANSI-stripped and
  timestamp-stripped by the detect run that wrote the issue, so it exercises
  the "text that needs no normalization" path. The ESC-byte and caret-text
  paths are covered by `ci-app-test-100952911197-excerpt.txt` and
  `11849-repro-result-log-excerpt.txt` respectively.
- **Captured**: 2026-09-16.
