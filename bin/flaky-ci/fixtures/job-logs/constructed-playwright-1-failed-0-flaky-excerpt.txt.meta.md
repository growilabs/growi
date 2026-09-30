# Source

- **Constructed.** The `1 failed / 0 flaky` shard shape — a Playwright test
  that failed on **every** attempt, which the procedure treats as an
  observation rather than a confirmation — has no usable real excerpt in the
  tracker: the tracking issues that mention "1 failed" quote either a vitest
  run's totals (#11817) or a `0 failed / 1 flaky` shard (#11903, #11914),
  because a shard that stays red fails its job and is reported through a
  different path.
- **What is copied from real data**: the annotation and summary shapes are
  #11903's and #11914's, with the spec, browser and test title taken from a
  real tracking issue for the same test
  ([#11713](https://github.com/growilabs/growi/issues/11713),
  `playwright:webkit:playwright/20-basic-features/comments.spec.ts:Successfully
  add comments`) — the annotation's `[webkit] › path:line:col › title` form,
  the `,line=,col=::` tail, the `test-failed-1.png` attachment path, and the
  two count lines indented by two spaces.
- **What is constructed**: the combination — `  1 failed` present and **no
  `flaky` line at all**, which is the mirror image of #11903 and pins that an
  absent line inside a captured summary reads as `0` in both directions.
- **Generated**: 2026-09-16.
