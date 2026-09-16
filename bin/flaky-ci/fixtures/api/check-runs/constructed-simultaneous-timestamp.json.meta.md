# Source

- **Constructed**. Two check-runs, same name, identical `started_at`
  (`2026-09-16T09:19:17Z`, GitHub's timestamps are second-resolution so an
  exact tie is a real possibility, not just a test artifact) and different
  `id` and `conclusion`. Covers tasks.md 3.8's named test case: the tie-break
  must fall through to the larger `id` (id `100000000002`, `success`), not
  keep whichever entry the API happened to list first. No real example of
  this exact tie was found in a deliberate search of the fixture shas already
  captured for this spec (`0d1a319a`, `807c3628`, `235dd237`, `b9a64ded`) —
  none has two same-named runs with an identical second-resolution
  `started_at`.
- **Captured**: 2026-09-16 (constructed, not fetched).
