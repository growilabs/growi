---
name: investigate-flaky-test
description: Investigate a flaky-test tracking issue created by detect-flaky-ci - reproduce, find root cause, fix, and optionally PR. Usage: /investigate-flaky-test <issue-url-or-number> [--auto]
---

# /investigate-flaky-test

Invoke the `investigate-flaky-test` skill in **interactive mode** with the
given issue number or URL.

Pass `$ARGUMENTS` as-is (issue number, URL, or URL with `--auto`).

The issue must already carry the `flaky/confirmed` label (set by
`detect-flaky-ci` once it has enough evidence) — running this against a
`flaky/observing` issue will stop immediately rather than investigate on
weak evidence.

Append `--auto` for autonomous mode (stop gates crossed automatically at HIGH
confidence, same semantics as `/investigate-issue --auto`).
