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

  the second time echoed by the runner as a `##[notice]` annotation. Reading
  both would report `2 flaky` / `212 passed` for a shard that had one flaky
  test, so the run is read from the plain summary only and the echo is dropped
  as a whole.
- It also carries **no `::error` annotation at all** (the failure is reported
  as ` 1) [chromium] › …`): the flaky test is still returned, read from the
  end-of-run list.
- **Captured**: 2026-09-16.
