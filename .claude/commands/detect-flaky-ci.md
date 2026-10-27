---
name: detect-flaky-ci
description: Scan recent CI runs for flaky failures and track them as GitHub issues (detection only, no code changes). Usage: /detect-flaky-ci [--lookback=N] [--vitest-threshold=N]
---

# /detect-flaky-ci

Invoke the `detect-flaky-ci` skill with `$ARGUMENTS` passed through as-is.

This only reads CI history and writes to GitHub issues/labels — it never
touches source code. To act on what it finds, run `/investigate-flaky-test
<issue>` on an issue it escalates to `flaky/confirmed`, or run
`/flaky-ci-routine` to chain both steps automatically.
