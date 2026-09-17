# Source

- **Synthetic.** No real flaky-tracking issue lacks a `Date:` line: every
  open/closed `flaky/*` issue checked was filed by `detect-flaky-ci`'s
  template, which always writes a `### First observation` section with a
  `Date:` line. This fixture simulates a hand-labeled issue (never touched
  by `detect-flaky-ci`) that has neither a body Date nor any observation
  comment — the "date cannot be read" exit-2 case for `newest-observation`.
- Shape (all fields other than `number`/`id`/`html_url`/`title`/`body`)
  copied verbatim from the real `11900-issue.json` response above.
- **Captured/constructed**: 2026-09-16.
