# Source

- **Constructed.** Modelled on the real excerpt
  `43419616882-playwright-flaky-two-runs-excerpt.txt` (run 43419616882, job
  131867595740): its lines 6-13 are copied unchanged, except that the
  position `:23:3` is removed from the test line (in the plain list and in the
  `##[notice]` echo), leaving `…/create-page-button.spec.ts › Create page …`.
  Timestamps, indentation and the trailing space are those of the real log.
- **Why no real example**: every list line in the real logs examined (runs
  43419616882, 39935584265 and 41984122671) and in the real-derived fixtures
  in this directory carries `path:line:col`, so no real example of this defect
  exists. This fixture is a real excerpt with that single defect introduced.
- **What is constructed**: the one deliberate defect — a list entry that has
  no `path:line:col` position.
- **What it is meant to verify**: an entry that cannot be split into
  project, file, line, column and title makes the list unreadable, reported
  with a reason, instead of producing a partial or guessed entry.
- **Generated**: 2026-11-17.
