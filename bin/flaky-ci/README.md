# `bin/flaky-ci`

Small scripts that return **facts** to the flaky-CI procedures
(`.claude/commands/flaky-ci-routine.md`, `.claude/skills/detect-flaky-ci/SKILL.md`,
`.claude/skills/investigate-flaky-test/SKILL.md`). Every judgment — which tier an
issue gets, whether to close it, whether to open a PR — and every write to GitHub
stays in those procedures. Nothing here writes anything.

Run them directly, with no build step and no dependencies beyond Node 24 and the
`gh` CLI:

```bash
node bin/flaky-ci/scripts/<name>.ts [--key value …]
```

## Output contract

Every script ends in one of two ways:

| Outcome | stdout | stderr | Exit code |
|---|---|---|---|
| Facts produced | one line of JSON, `{"ok":true, …}` | empty | `0` |
| A precondition could not be met | empty | one line saying why | `2` |
| Unexpected exception | empty | stack trace | `1` (procedures treat it as `2`) |

- **Zero rows is a success**, not a failure: `ok:true` with an empty array. "Could
  not be read" is always exit `2`.
- A script that returns **several rows** marks a single unreadable value on that
  row (for example `pausedAtStatus: "unavailable"`) and still exits `0`; it exits
  `2` only when no row at all could be produced.
- The definition of both lives in `lib/output.ts`.

## Script contracts

One row per script: what it is called with, what it reads from stdin, which
fields it puts in the JSON, how it can fail, and which judgment in the procedures
consumes the output. Rows are added by the task that adds the script.

| Script | Arguments | stdin | Output fields | Exit codes | Judgment that reads it |
|---|---|---|---|---|---|
| `read-repro-result` | `--issue <number> --sha <sha>` | — | `runs`, `failed`, `perRun[]`, `workflowRunUrl`, `commentUrl` | `0` facts produced; `2` no `### Repro result` comment on the issue carries that commit | `investigate-flaky-test/SKILL.md` 2-E's tally table, and 6-B condition 1 |
| `newest-observation` | `--issue <number>` | — | `newest` (ISO-8601 UTC), `source` (`"body"`, or the id of the comment it came from) | `0` facts produced; `2` no `Date:` line could be read from the body's `### First observation` section or any `### Additional observation` / `### Backfilled observation` comment | `flaky-ci-routine.md` 4-B/4-D/4-E's close-vs-leave-open decision |
| `awaiting-decision-rows` | `--issue <number>` (repeatable) | — | `rows[]`, one per `--issue`: `issue`, `pausedAt` (ISO-8601 UTC or `null`), `pausedAtStatus` (`"ok"` or `"unavailable"`), `recommendation` (string or `null`), `recommendationSource` (`"in-window"`, `"widened"` or `"none"`), `newObservations` (number or `null`) | `0` facts produced (a per-issue `pausedAtStatus: "unavailable"` never fails the whole call); `2` no `--issue` was given | `flaky-ci-routine.md` Step 5's `## Awaiting human decision` table cells — whether to prefix `(may be stale) ` (only when `recommendationSource` is `"widened"`) and the "never re-pick" stability rule stay in the procedure |

## Shared library

`lib/` holds the pure functions and the two adapters the scripts share; it has no
barrel, and scripts import the file they need directly.

| Module | Role |
|---|---|
| `output.ts` | The single way a script reports success or failure |
| `gh.ts` | The single GitHub REST read entry point (`gh api -X GET`, paginated in JS) |
| `constants.ts` | The fixed strings of the procedures, in machine-readable form |
| `time.ts` | ISO-8601 (UTC) comparison, subtraction and day counts |
| `ansi.ts` | Job-log normalization (ANSI sequences, end-of-line carriage returns) |
| `repro-result.ts` | Parses one `### Repro result` comment body against a target commit SHA |

Tests sit next to each module (`*.spec.ts`) and run with
`turbo run test --filter=./bin`. `constants.spec.ts` checks every constant
against the procedure text it came from, so changing a fixed string in only one
of the two places fails the test.
