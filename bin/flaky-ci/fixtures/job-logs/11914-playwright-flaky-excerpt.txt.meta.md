# Source

- **Real.** The fenced excerpt inside the `### Evidence` section of the body of
  [issue #11914](https://github.com/growilabs/growi/issues/11914), extracted
  with `gh api -X GET repos/growilabs/growi/issues/11914 -q '.body'` and taken
  verbatim between the fences.
- **Why this one**: the shard's whole summary appears **twice** —

  ```
    1 flaky
      [chromium] › …
    106 passed (5.5m)
  ##[notice]  1 flaky
      [chromium] › …
    106 passed (5.5m)
  ```

  the second time echoed by the runner as a `##[notice]` annotation. Summing
  every matching count line would report `2 flaky` / `212 passed` for a shard
  that had one flaky test — the "single item counted twice" shape of the same
  bug class tasks 2.2 and 2.3 hit. `extractSummary` takes the first reading of
  each keyword.
- It also carries **no `::error` annotation at all** (the failure is reported
  as ` 1) [chromium] › …`), which is the zero-annotation case for
  `extractPlaywrightAnnotations`.
- **Captured**: 2026-09-16.
