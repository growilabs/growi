# Source

- **Constructed.** Modelled on the real excerpt
  `43419616882-playwright-flaky-two-runs-excerpt.txt` (run 43419616882, job
  131867595740): its lines 6-13 are copied unchanged, except that the heading
  `1 flaky` is changed to `2 flaky` in both the plain summary and the
  `##[notice]` echo. Timestamps, indentation and the trailing space on the
  test line are those of the real log.
- **Why no real example**: one real excerpt with a heading/line-count mismatch
  exists — the fixture derived from issue #11903
  (`11903-playwright-flaky-excerpt.txt`, taken from an issue body), where
  `1 flaky` is followed by zero test lines. The other shape — at least one
  test line, but fewer than the heading says (`2 flaky` over one line) —
  appears in none of the real logs examined (runs 43419616882, 39935584265 and
  41984122671). This fixture is a real excerpt with that single defect
  introduced.
- **What is constructed**: the one deliberate defect — the heading says
  `2 flaky` but only one test line follows it.
- **What it is meant to verify**: when a heading's count and the number of
  list entries disagree, the list is reported as unreadable with a reason
  instead of being trusted.
- **Generated**: 2026-11-17.
