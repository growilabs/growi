---
name: investigate-issue
description: Investigate a GitHub issue - fetch info, update labels, analyze code/reproduce, report findings, and optionally fix. Usage: /investigate-issue <issue-url-or-number>
---

# /investigate-issue

Invoke the `investigate-issue` skill in **interactive mode** with the given issue number or URL.

Pass `$ARGUMENTS` as-is to the skill (issue number, URL, or URL with `--auto`).

Interactive mode preserves the original stop-gate behavior: the skill will pause and ask for your direction at each decision point (version mismatch, fix decision, PR decision).

To run in autonomous mode — where the skill makes decisions independently when confidence is HIGH and only stops when confidence is MEDIUM or LOW — append `--auto`:

```
/investigate-issue 12345 --auto
```
