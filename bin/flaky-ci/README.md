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
| `read-repro-result` | `--issue <number> --sha <sha>` | — | `runs`, `failed`, `perRun[]`, `workflowRunUrl`, `commentUrl` | `0` facts produced; `2` no `### Repro result` comment on the issue carries that commit | `investigate-flaky-test/SKILL.md` 2-D/2-E's tally table |
| `newest-observation` | `--issue <number>` | — | `newest` (ISO-8601 UTC), `source` (`"body"`, or the id of the comment it came from) | `0` facts produced; `2` no `Date:` line could be read from the body's `### First observation` section or any `### Additional observation` / `### Backfilled observation` comment | `flaky-ci-routine.md` 4-B/4-D/4-E's close-vs-leave-open decision |
| `awaiting-decision-rows` | `--issue <number>` (repeatable) | — | `rows[]`, one per `--issue`: `issue`, `pausedAt` (ISO-8601 UTC or `null`), `pausedAtStatus` (`"ok"` or `"unavailable"`), `recommendation` (string or `null`), `recommendationSource` (`"in-window"`, `"widened"` or `"none"`), `newObservations` (number or `null`) | `0` facts produced (a per-issue `pausedAtStatus: "unavailable"` never fails the whole call); `2` no `--issue` was given | `flaky-ci-routine.md` Step 5's `## Awaiting human decision` table cells — whether to prefix `(may be stale) ` (only when `recommendationSource` is `"widened"`) and the "never re-pick" stability rule stay in the procedure |
| `lockfile-overlap` | `--sha <sha> --pr <number> --log-excerpt-file <path>` | — | `overlap[]`, `patchPackages[]`, `logPackages[]` (all sorted arrays) | `0` PR #`<number>` doesn't touch `pnpm-lock.yaml` (empty `overlap`/`patchPackages` — the common case) or touches it with no overlap; `2` PR #`<number>`'s changed files could not be fetched, or `--log-excerpt-file` could not be read | `detect-flaky-ci/SKILL.md`'s ① check — whether a non-empty `overlap` suppresses ① for this failure |
| `parse-job-log` | none | one job log, whole | `vitest.failBlocks[]` (`project`, `specPath`, `testTitle` — `null` for a file-level FAIL line, `sharedSetupHook`, `excerpt`), `playwright.annotations[]` (`file`, `title`, both raw and either possibly `null`; repeats kept, in the order printed, so the reader can count *distinct* ones), `playwright.summary` (`failed`/`flaky`/`passed`/`skipped`, or `null` when the log carried no count line at all), `denylistHits[]` (`blockIndex`, `specPath`, `testTitle`, `pattern`, `needle`, `scope`) | `0` facts produced (no failure in the log is `ok:true` with empty arrays); `2` stdin was empty or whitespace only | `detect-flaky-ci/SKILL.md` Step 2's noise classification (a `scope: "failure"` hit drops that failure, a `scope: "job"` hit drops the job log) and Step 3's identity tier — plus where collateral and cascaded failures are folded |
| `parse-identity-key` | `--title <issue title>` | — | `kind` (`"vitest"` / `"playwright"` / `null`), `browser` (string or `null` — `null` for `vitest`, and possibly `null` even for a precise `playwright` key that carries no browser segment), `specPath` (string or `null`), `testTitle` (string, verbatim including any further `:`, or `null`), `shape` (`"precise"` / `"playwright-job-level"` / `"malformed"`) | `0` facts produced (a job-level fallback or malformed key is itself a fact, never a failure); `2` `--title` was not given | `investigate-flaky-test/SKILL.md` Step 1 — which of the three shapes leads to reading the linked run's Playwright report first, proceeding straight to Step 2, or stopping and reporting a precondition failure |
| `list-candidate-runs` | `--workflow <file.yml> --window-hours <n> --max-runs <n>` | — | `runs[]`, one per completed run created within the trailing `--window-hours`, newest first: `id`, `conclusion`, `headSha`, `createdAt`, `url`, `event`, `attempt`; `truncated` (boolean) | `0` facts produced (zero runs in the window is `ok:true` with an empty `runs[]`, not a failure; a later page failing after earlier pages already produced runs also reports `ok:true` with `truncated: true`, on the same reasoning as the `--max-runs` case — some of the window was read, not none of it); `2` a required argument is missing or not a positive integer, or no run at all could be fetched (the GitHub API failed before any page was read) | `detect-flaky-ci/SKILL.md` Step 1 — reporting the truncation when `truncated` is `true`, and treating a same-`headSha` `attempt` reversal within `runs[]` as a confirmed flaky occurrence |
| `fetch-flaky-issues` | `--labels <name>` (repeatable; defaults to the three tier labels, `flaky/observing`/`flaky/suspected`/`flaky/confirmed`) | — | `issues[]`, one per issue (state=all) carrying any of `--labels`, deduplicated and sorted ascending by number: `number`, `title`, `state`, `body`, `labels[]` (label names), `comments[]` (`id`, `body` — full text), `commentsStatus` (`"ok"` or `"unavailable"` — that issue's `comments[]` could not be fetched, so it is empty rather than complete; the rest of the row is still reported); `labelFetchFailures[]` — the requested labels (if any) whose list fetch failed outright, so a label with zero matching issues can be told apart from a label whose fetch failed and is simply missing from `issues[]` | `0` facts produced (a label with zero matching issues is `ok:true` with that label absent from `labelFetchFailures`; a per-issue `commentsStatus: "unavailable"` never fails the whole call; nor does a non-empty `labelFetchFailures`, as long as at least one label succeeded); `2` no issue could be fetched for any of the requested labels (`labelFetchFailures` covers every requested label) | `detect-flaky-ci/SKILL.md` Step 1.5 — extracting the `actions/runs/{id}` skip-list from `body`/`comments[].body`, and every later reuse of this issue list (setup-hook path/state matching, collateral-candidate rows, exact-title lookup, Step 5's skip count); a non-empty `labelFetchFailures` is reported via Step 5's incomplete-data sentence, not Step 6's script-failures line |
| `mining-signals` | `--runs-file <path> --identity <path>` | — | `sandwich` (`hit`, `evidence`) — this same vitest identity failed in an earlier run within the window, a run of the same workflow in between passed, and it failed again in the run being classified; `matrixSplit` (`hit`, `evidence`) — a sibling matrix cell of the same job (same name before its `(...)` parameters) on the same commit passed while this job failed. `--runs-file` is `list-candidate-runs.ts`'s saved stdout for this identity's workflow; `--identity` is a JSON file the procedure assembles (`specPath`, `testTitle`, `targetRun` — `id`/`headSha`/`createdAt`/`url` — `priorFailingRunIds[]`, `jobName`, `siblingJobs[]` — `name`/`conclusion`). Makes no `gh api` call of its own — both inputs are re-reads of data fetched elsewhere this scan | `0` facts produced (`hit: false` on either signal is a normal fact, not a failure — including when `priorFailingRunIds` is empty or no sibling matrix job exists); `2` `--runs-file`/`--identity` missing, or either file could not be read or does not parse into the expected shape | `detect-flaky-ci/SKILL.md`'s Cheap Suspicion Mining ② and ③ checks — which checks matched feeds the issue body's evidence lines and the tier/Status-line wording, both left in the procedure |
| `pr-owns-failure` | `--sha <sha> --spec-path <path>` (`--spec-path` may be `''` for a Playwright job-level identity with no spec path) | — | `ancestryStatus` (`identical`/`behind`/`ahead`/`diverged`, GitHub's raw `compare` status); `pulls[]`, one per PR associated with the commit — `number`, `base` (`null` for a merge-queue-derived entry), `state` (`null` likewise), `touchesSpec` (this PR's own changed files match `--spec-path`); `touchesSpec` (`pulls.some(p => p.touchesSpec)`); `noPr` (`pulls.length === 0`). `pulls[]` is gathered by `GET commits/{sha}/pulls` first, falling back — only when that is empty — to every literal `Merge of #{N}` line in `GET commits/{sha}`'s commit message (a Mergify merge-queue commit's direct PR association is gone by the time the queue entry closes). **Path rooting**: a PR's `files[].filename` from GitHub is repository-root-relative (`apps/app/src/....ts`); pass `--spec-path` in the same `apps/app`-relative form a vitest identity's spec path already is (`src/....ts`) — the script matches by suffix (`filename === specPath \|\| filename.endsWith('/' + specPath)`), never equality, so passing the repository-root-relative form here would silently make `touchesSpec` false forever | `0` facts produced (`noPr: true` and `touchesSpec: false` are both normal facts, not failures); `2` the compare call, the commits/pulls call, the commit-message fallback call, or any PR's files call failed | `detect-flaky-ci/SKILL.md`'s "Failures the PR itself owns" check — `ancestryStatus` decides ancestor vs. not, `noPr`/`touchesSpec` decide exclude vs. continue, and exit 2 is fail-open (continue, note in Step 5) |
| `check-runs-facts` | `--sha <sha>` | — | `checks[]`, the commit's check-runs deduped to the newest per name (`id`, `name`, `status`, `conclusion`, `startedAt`) — a name gets more than one run once a PR exists (a `push` event and a `pull_request` event both fire it), and "newest" is decided by `startedAt` then, on an exact tie, the larger `id` (`lib/check-runs.ts`, shared with `pr-gate-facts`); `ciApp` — `total` (deduped `ci-app-*` check-run count) and `notSuccess[]` (those whose `conclusion` is not `"success"`, including one still in progress, whose `conclusion` is `null`); `flakyRepro` — `status` (`"absent"` when no check-run named `flaky-repro` exists on the commit yet) and `conclusion`. Single-shot: makes one round of calls and returns what it sees right now — it does not wait or poll | `0` facts produced (`ciApp.total: 0` and `flakyRepro.status: "absent"` are both normal facts, not failures); `2` the check-runs call failed outright | `investigate-flaky-test/SKILL.md` 2-C and 6-A's wait loops — whether to keep polling or stop, read from `checks[]`'s `status` fields and `flakyRepro.status`, stays in the procedure |
| `pr-gate-facts` | `--issue <number> --sha <sha> [--base <ref>]` (`--base` defaults to `origin/master`) | — | `tally` — `null`, or `runs`/`failed`/`perRun[]`/`workflowRunUrl`/`commentUrl` for the newest `### Repro result` comment pinned to `--sha` (`lib/repro-result.ts`'s `selectNewestMatch`, shared with `read-repro-result`); `ciApp` — `total`/`notSuccess[]` for `--sha`'s deduped `ci-app-*` check-runs (`lib/check-runs.ts`, shared with `check-runs-facts`); `changedFiles[]` — `git diff --name-only <base>...<sha>` (three-dot, local git — the one script here that is not `gh api`-only, since 6-A already assumes a checked-out fix branch) | `0` facts produced (`tally: null` and `ciApp.total: 0` are both normal facts — "not measured yet" and "nothing ran", not errors); `2` the issue-comments call, the check-runs call, or the local `git diff` failed outright | `investigate-flaky-test/SKILL.md` 6-B's PR gate conditions 1 and 2 — condition 3 (whether `changedFiles[]` stays inside what Step 3 identified) and the HIGH/MEDIUM/LOW table stay in the procedure |

## Shared library

`lib/` holds the pure functions and the two adapters the scripts share; it has no
barrel, and scripts import the file they need directly.

| Module | Role |
|---|---|
| `output.ts` | The single way a script reports success or failure |
| `gh.ts` | The single GitHub REST read entry point (`gh api -X GET`, paginated in JS) |
| `constants.ts` | The fixed strings of the procedures, in machine-readable form |
| `time.ts` | ISO-8601 (UTC) comparison, subtraction and day counts |
| `ansi.ts` | Job-log normalization (ANSI sequences written as an ESC byte *or* as literal `^[` caret text, end-of-line carriage returns) |
| `job-log.ts` | vitest failure blocks, Playwright `::error` annotations, and a shard's count summary (`null` when no count line was captured) |
| `denylist.ts` | The infrastructure-noise list as data, and the per-failure match that says whether it reaches the failure or the whole job |
| `repro-result.ts` | Parses one `### Repro result` comment body against a target commit SHA, and picks the newest matching comment (`created_at`→`id`) across a whole comment list (`selectNewestMatch`); shared by `read-repro-result.ts` and `pr-gate-facts.ts` |
| `lockfile.ts` | Extracts package names from a `pnpm-lock.yaml` diff and from a log excerpt's stack-trace frames, and intersects the two sets |
| `identity.ts` | Decomposes a flaky-tracking issue title into kind / browser / spec path / test title, and which of the three identity-key shapes it is |
| `check-runs.ts` | Dedupes a commit's check-runs to the newest per name (`startedAt`→`id`) and aggregates the `ci-app-*` subset (`total`, `notSuccess[]`); shared by `check-runs-facts.ts` and `pr-gate-facts.ts` |

Tests sit next to each module (`*.spec.ts`) and run with
`turbo run test --filter=./bin`. `constants.spec.ts` checks every constant
against the procedure text it came from, so changing a fixed string in only one
of the two places fails the test.
