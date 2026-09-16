---
name: detect-flaky-ci
description: Scan recent GROWI CI runs for flaky (non-deterministic) job/test failures and track them as GitHub issues. Detection only — never modifies source code. Usage - /detect-flaky-ci [--window-hours=N] [--vitest-threshold=N]
allowed-tools: Bash, Read, Grep, Write, mcp__github__get_job_logs
argument-hint: "[--window-hours=32] [--vitest-threshold=2]"
---

# detect-flaky-ci

## Overview

Scan a bounded window of recent CI runs on `growilabs/growi`, find failures that
look non-deterministic (flaky) rather than a real regression or infrastructure
noise, and record them as tracked GitHub issues.

**This skill never touches source code, opens no branch, and creates no PR.**
Its only outputs are: new issues, comments on existing issues, and label
changes on issues it created. Fixing is a separate skill
(`investigate-flaky-test`) invoked later, on a different issue, by the
`/flaky-ci-routine` command.

Because this is meant to run unattended from a cron routine (`schedule` skill)
with no memory between runs, **all state lives in GitHub issues and labels** —
this skill re-derives everything it needs by querying the tracker on each run.

## Input

`$ARGUMENTS` (all optional):
- `--window-hours=N` — scan every completed run of each watched workflow
  created in the last N hours, rather than a fixed run count. Default `32`
  (twice the longest gap between two consecutive cron fires of this routine
  — see "Why a time window, not a run count" below). Pass this explicitly
  when invoking standalone outside `/flaky-ci-routine`'s cron cadence.
- `--max-runs-per-workflow=N` — safety cap on how many runs within the
  window this skill will actually process per workflow, in case CI volume
  spikes far beyond what the window is sized for. Default `300`. If the
  window contains more than this, process the newest `N` and **say so
  explicitly** in Step 5 — never truncate silently.
- `--vitest-threshold=N` — number of separate-run observations of the same
  vitest test failure required before escalating from `flaky/observing` to
  `flaky/confirmed`. Default `2`. (Playwright-detected flakiness always
  escalates on the first observation — see Step 3.)

## Why a Time Window, Not a Run Count

A fixed run count (the old `--lookback=30`) silently stops covering older
failures on any day the watched workflow runs more than 30 times — they
scroll out of the scanned range with no error or warning. A window sized to
the routine's own cron closes that gap without persisting state between runs:
as long as it is at least **twice the longest gap between two consecutive
fires**, a skipped or late fire still leaves the next run's window
overlapping the previous one.

**Size it off the longest gap, not an average.** The routine's cron is
`0 0,16 * * *`, so the gaps alternate 16 hours and 8 hours — the longest is
16, hence the default of `32`. Taking the shorter gap (or an 8-hour
"cadence") would leave the 16-hour gap uncovered whenever a fire is missed.

The overlap is deliberate: a run created 30 hours ago gets scanned by up to
two consecutive routine runs, and the Step 1.5 skip-list makes the second
pass cost a metadata check rather than a re-read of that run's job logs.

## Three Confidence Tiers

Detection now produces one of three outcomes per candidate, cheapest evidence
first:

1. **`flaky/observing`** — a single vitest observation with no corroborating
   signal (see "Cheap Suspicion Mining" below). Passive: waits for a future
   run to repeat it (`--vitest-threshold`).
2. **`flaky/suspected`** — a vitest observation that also matches one or more
   of the five cheap, mechanical signals in "Cheap Suspicion Mining" (diff/PR
   mismatch, sandwich pattern, matrix divergence, a shared setup-hook timeout
   with cross-file slowdown, or a targeted historical backfill hit): grep/diff
   -level checks against data this skill already fetched, with no LLM judgment
   spent getting here. Handed to `investigate-flaky-test`, which spends one
   confirmation measurement (3 independent runs on the flaky-repro workflow)
   to turn this into empirical proof.
3. **`flaky/confirmed`** — either a Playwright in-run retry (the retry already
   IS the empirical proof, no further measurement needed), or a
   `flaky/suspected` issue that `investigate-flaky-test` measured with the
   flaky-repro workflow (3 runs, no code change) and saw at least one pass.

`detect-flaky-ci` only ever assigns tiers 1 and 3 (3 for Playwright only).
`investigate-flaky-test` is the only skill that promotes tier 2 → tier 3 for
vitest, because that promotion requires an actual measurement, which is an
investigation action, not a detection action.

## Cheap Suspicion Mining (vitest only)

Before falling back to passive `--vitest-threshold` accumulation, check each
vitest failure identity against five mechanical signals — grep/diff/API-field
comparisons, with no code reading and no qualitative log judgment. ⑤ needs
one extra log fetch (a nearby passing run of the same job) to compare numbers
against, but the comparison itself is still mechanical (duration deltas), not
reasoning about *why*. The numbering is legacy (④ was added before ⑤) and
does not reflect run order; what matters is which observation each check runs
against, and how strong its evidence is:

| Check | Runs against | Strength of its evidence |
|---|---|---|
| ⑤ Setup-hook timeout with cross-file slowdown | a **fresh** observation from this scan | strongest — a direct resource-contention measurement |
| ③ Matrix divergence | a **fresh** observation from this scan | same commit, same code, divergent outcome |
| ② Sandwich pattern | a **fresh** observation from this scan | disappears and reappears within the window |
| ① Diff / PR-description mismatch | a **fresh** observation from this scan | weakest — an inference from an unrelated diff |
| ④ Targeted historical backfill | **existing** `flaky/observing` issues, once per scan, whether or not anything new was observed for them today | see its own subsection below for why it is structured differently |

**Evaluate all of ①-③ and ⑤ for every fresh observation — do not stop at the
first hit — and record every check that matched**, not just the first. They
all reuse data already fetched in Steps 1-2 (⑤ adds one log fetch but no
extra run/job listing), so short-circuiting saves little, and stopping early
loses information: ① is the loosest of the four and tends to match almost any
isolated failure before ②, ③ or ⑤ are evaluated, which makes the stronger
three look like they never fire in practice when they may be firing
constantly underneath ①'s wider net.

- **Report all matched checks in the issue**, not just one (see the issue
  body template below) — a reader deciding how much to trust "suspected"
  should see every corroborating signal, not whichever happened to be
  checked first.
- **When space forces picking a single headline reason** (e.g. a short
  status line), prefer the strongest evidence, not check order: ⑤ > ③ > ② >
  ①, as ranked in the table above.

**① Diff / PR-description mismatch.** Fetch the commit's associated PR (if
any):

```bash
gh api repos/growilabs/growi/commits/{HEAD_SHA}/pulls -q '.[0].number'
```

If a PR exists, fetch its changed files and description:

```bash
gh api repos/growilabs/growi/pulls/{PR_NUMBER}/files --paginate -q '.[].filename'
gh api repos/growilabs/growi/pulls/{PR_NUMBER} -q '.body'
```

If the failing spec's `SPEC_PATH` (and the module paths appearing in the
failure's stack trace) are absent from the changed-files list, **and** the
PR description does not mention the failing area, this failure is very
likely unrelated to what the PR actually changed — suspicious. If the run
has no associated PR (a direct push to `master`, e.g. a merge-queue commit),
compare against that commit's own diff instead
(`gh api repos/growilabs/growi/commits/{HEAD_SHA} -q '.files[].filename'`)
and skip the description check.

**A `pnpm-lock.yaml` change is never "unrelated" by default — check it
before letting ① fire.** A dependency bump changes what the test actually
runs against, so a diff that touches nothing but the lockfile is not
evidence that the PR is innocent. Reading it as one has already caused a
failure that was deterministic on its dependabot branch to be tracked as
flaky across 13 observations. So whenever the failing run has an associated
PR, run:

```bash
node bin/flaky-ci/scripts/lockfile-overlap.ts \
  --sha {HEAD_SHA} --pr {PR_NUMBER} --log-excerpt-file {LOG_EXCERPT_FILE}
```

(`{LOG_EXCERPT_FILE}` is the same failure log excerpt already fetched for
Step 3.) The script fetches PR #`{PR_NUMBER}`'s `pnpm-lock.yaml` diff
itself and reports the package names on each side and their intersection
(`overlap[]`, `patchPackages[]`, `logPackages[]`) — see
`bin/flaky-ci/README.md`'s contract table for the exact fields. A PR that
doesn't touch `pnpm-lock.yaml` at all (the common case — most failing PRs
never touch the lockfile) is exit 0 with empty `overlap[]`/`patchPackages[]`,
same as a PR that touches it with no overlapping packages: in both cases ①
still runs its usual judgment, this check simply found nothing to suppress
it with. Exit code 2 means the fetch itself failed — the PR's changed files
could not be retrieved, or the log excerpt could not be read — treat that
as "not measured" per Step 6, not as "no overlap".

On a commit with no associated PR (a direct push to `master`, e.g. a
merge-queue commit), there is no `{PR_NUMBER}` to pass and this check is
skipped for that failure — that is not the same as proving the lockfile
unaffected, it simply cannot be checked without a PR-scoped diff. A
merge-queue commit that rolls up a dependabot PR lands here unguarded by
this check; ② / ③ / ⑤ still apply as usual.

**If `overlap` is non-empty, ① does not fire for this failure.** Do not
count it as a mining hit, do not name it in the Status line, and record why
in the issue body (see the template in Step 4) as:

```
- ① not applicable: lockfile changed `{overlap[0]}` and the failure's stack trace runs through it
```

(when `overlap` has more than one name, list all of them, comma-separated,
in place of `{overlap[0]}`)

Suppressing ① is **not** an exclusion — the failure still goes through
Step 4 as usual. ② / ③ / ⑤ are evaluated and stand on their own if they
matched; if nothing else matched, the identity falls through to the passive
`flaky/observing` path exactly as any other unremarkable observation does.
When the identity already has an open issue and ① is being re-evaluated in
Step 4's escalation path 1, the same suppression applies — put the line
above in that run's observation comment instead of the issue body.

A lockfile-only PR (dependabot regenerating `pnpm-lock.yaml`) is the typical
case here, and such a failure is usually **deterministic on that branch**
rather than flaky. The exclusion rule in "Failures the PR itself owns" below
does *not* remove it — that rule only fires when the PR changed the failing
spec file, which a lockfile-only PR by definition did not. Proving the cause
deterministic and closing the issue under
`### Closed: deterministic cause, not flaky` is `investigate-flaky-test`'s
job, not this skill's.

**② Sandwich pattern.** Within the `--window-hours` window already fetched in
Step 1, look for the same vitest identity key failing in two (or more) runs
with a run of the *same job* in between that succeeded — a failure that
disappears and reappears with an identical signature is stronger evidence of
non-determinism than two failures with nothing but other failures between
them. This needs no new API call: it is a re-read of the Step 1 run list plus
the Step 2 job results already in hand, including run URLs and dates recorded
on an existing `flaky/observing` issue's observation comments.

**③ Matrix divergence.** `ci-app-test-integration` runs a
node/MongoDB-version matrix (see any recent job name, e.g.
`ci-app-test-integration (24.x, 8.0, 8, 8.19.16)`). If the same commit's
other matrix cells for the same job **passed** while this one failed, that is
a same-commit, zero-wait signal. Get sibling job results from the Step 2
jobs-list call you already made (`gh api
repos/growilabs/growi/actions/runs/{RUN_ID}/jobs`) — filter by job name
prefix, compare conclusions.

**⑤ Setup-hook timeout with cross-file slowdown.** A failure whose error is
`Hook timed out in Nms` on a hook registered in a Vitest **project's
`setupFiles`** (not a spec file's own `beforeAll`/`afterAll`) is shared
across every spec file the pool assigns to whichever worker hit it, so the
failing spec file is often incidental, not the cause. Do not classify this as
a problem with the named hook (or, worse, propose a bare timeout bump on it)
without checking whether the whole run was under unusual load, which this
signal measures directly:

1. Get the failing job's per-file duration lines (the reporter's own
   `✓ |app-integration| path/to/file.integ.ts (N tests) NNNNms` lines —
   strip ANSI codes first: `sed -E 's/\x1b\[[0-9;]*m//g'`).
2. Find a **passing** run of the *same job* (same workflow, same matrix
   cell) close in time — the sibling matrix cell from ③'s check often
   already qualifies; otherwise the nearest earlier passing run of the same
   job name.
3. Compare 3-5 *unrelated* files' durations between the two runs. If they are
   consistently and substantially slower in the failing run (2.6-3.4x in the
   measured case), that is direct evidence the whole run — not the named hook
   — was under unusual load. If they run at roughly the same speed in both,
   this signal does not fire; do not force it.

Do **not** use per-line `console.log` timestamps from the raw CI log to
reason about *when within the run* something happened — Vitest/CI log
capture can buffer a worker's stdout and flush it in one burst near the
job's end, so dozens of unrelated timestamps landing in the same
one-second window is an artifact of that buffering, not proof of
tail-of-run clustering — a pattern that has already been misread once as
"failures cluster at the end of the run". The reporter's own summary
`Duration`/per-file `NNNNms` figures
are computed by Vitest's internal timer, not from log-line timestamps, and
remain trustworthy for the comparison in step 3.

If none of ①-③ or ⑤ hit for a fresh observation, fall through to the
existing passive `flaky/observing` / `--vitest-threshold` path unchanged.

**④ Targeted historical backfill (existing `flaky/observing` issues only).**
①-③ only look at data already in hand for *today's* observation; this one
runs the other direction. For each currently-OPEN `flaky/observing` issue
(you already fetch this list for Step 4's reconciliation — reuse it, do not
re-fetch), actively search further back than this scan's `--window-hours` for
an *earlier* occurrence of that same identity that was never recorded. That
closes the gap described in "Why a Time Window, Not a Run Count" for the
handful of tests already flagged as interesting; it deliberately does not
apply to fresh, never-before-seen failures, which would mean deep-searching
on every failure.

Bounded cost: it runs only per already-`flaky/observing` issue (a handful at
most) and only fetches logs for **failed** runs of the one relevant workflow
(vitest identities only ever come from `ci-app.yml`):

```bash
# Deeper, failure-only search for this identity's workflow, going back
# further than this scan's window (e.g. 14 days) — still only the runs the
# API says failed, so this is cheap even at a much deeper range than the
# main window. `created` uses GitHub's search qualifier syntax (`>DATE`),
# passed via -f so gh api URL-encodes it correctly.
#
# This endpoint's `status` parameter is overloaded to also accept a
# conclusion value directly (`failure`, `success`, ...) — there is no
# separate `conclusion` parameter. `-f status=completed -f conclusion=failure`
# looks like it filters to failures but doesn't: `conclusion` isn't a real
# query param here, so it's silently ignored and every completed run
# (success/failure/cancelled alike) comes back. Use `status=failure` alone
# (confirmed empirically: this returns only conclusion=="failure" runs).
gh api -X GET repos/growilabs/growi/actions/workflows/ci-app.yml/runs \
  -f status=failure -f "created=>{FOURTEEN_DAYS_AGO_ISO8601}" --paginate \
  -q '.workflow_runs[] | {databaseId: .id, headSha: .head_sha, createdAt: .created_at, url: .html_url}'
```

For each failed run returned, skip it if its `url` already appears in the
issue's body or any of its comments (already recorded — re-reading it would
be wasted work and could double-count an observation). For the rest, fetch
the relevant job(s)' log (same Step-0-decided method as Step 2) and grep
for this identity's exact `FAIL {SPEC_PATH} > ... > {TEST_TITLE}` block.

**A grep hit is not yet an observation — put it through the same two filters
a fresh failure goes through**, and only what survives both counts here:

- **Infra noise** (Step 2's denylist), at the same per-failure granularity
  Step 2 defines: the hit is noise when a denylist string appears in that
  `FAIL` block's own excerpt, or when the job log carries a denylist match
  inside a shared `test/setup/**` hook failure.
- **Failures the PR itself owns** (the check between Step 3 and Step 4): the
  hit is excluded when the run's head commit is **not an ancestor of
  `master`** *and*, on top of that, either a PR the commit belongs to changed
  the failing spec file, or the commit belongs to no PR at all. Not being an
  ancestor of `master` is a precondition of **both** arms, not just the
  first: a commit already merged into `master` is never excluded on this
  ground, whether or not a PR can be found for it. What the fresh path
  excludes there is excluded here too.

Both checks are written further down this file because that is where the
fresh-failure path meets them; they apply here all the same, even though ④
runs earlier (Step 1.5). Read them now rather than treating them as "not
reached yet" — skipping them lets a backfill hit escalate an issue to
`flaky/suspected` on evidence the rest of this skill has already ruled out,
which also takes it out of the routine's auto-close set (`flaky/observing`
only). That has been measured (research.md →
「過去にさかのぼって見つけた失敗も、新しい失敗と同じ 2 つの判定を通す」).

A hit that survives both filters is a genuine backfilled observation this
issue never had:

```bash
BODY_FILE="${TMPDIR:-/tmp}/flaky-backfill-body-{NUMBER}.md"

cat > "$BODY_FILE" <<'EOF'
### Backfilled observation (found during targeted historical search)

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}

```
{log excerpt}
```

_Generated by [Claude Code](https://claude.ai/code)_
EOF

gh api "repos/growilabs/growi/issues/{NUMBER}/comments" -X POST -F body=@"$BODY_FILE"

gh api "repos/growilabs/growi/issues/{NUMBER}/labels" -X POST -f 'labels[]=flaky/suspected'
gh api "repos/growilabs/growi/issues/{NUMBER}/labels/flaky%2Fobserving" -X DELETE
```

**Every write this skill makes is REST (`gh api`), never a `gh issue …`
subcommand** — see `flaky-ci-routine.md` → Shared constants → Reading
conventions. The comment body goes to a file first so that multi-paragraph
Markdown, the fenced log excerpt included, stays out of the argument list.
Both tier labels here are plain names, so the additive `POST /labels` plus a
percent-encoded `DELETE /labels/{name}` is the right pair; the whole-array
`PATCH` form appears later in this file only where a phase label's leading
emoji rules `DELETE` out.

A backfill hit always escalates straight to `flaky/suspected`, never
`flaky/confirmed`, however many backfilled occurrences are found — it is
still mechanical suspicion, not an empirical rerun. If the deeper search
finds nothing, or only hits the two filters discard, leave the issue at
`flaky/observing`, post no comment, change no label, and move on: this is a
best-effort extra pass, not a required gate.

Genuinely subtle flakiness that shows up in none of ①-⑤ still needs the
accumulation path — these checks are not exhaustive.

## Why vitest and Playwright are handled differently

- **Playwright** runs with `retries: 2` in CI (`apps/app/playwright.config.ts`),
  so a test that fails then passes on retry within the *same* job run prints
  an `N flaky` summary line and `Retry #N` blocks — direct, single-run proof
  of non-determinism, no accumulation needed.
- **vitest** (`ci-app-test`, `ci-app-test-integration`) has no retry
  mechanism, so a single failure is indistinguishable from a real regression.
  The only cheap, reliable signal is the same test failing across multiple
  *unrelated* runs while the surrounding suite is green, which requires
  accumulating observations via `--vitest-threshold`.

  The gold-standard signal — the same commit SHA re-run failing then passing
  (`run_attempt` N vs N+1) — does happen here but is rare (manual reruns
  only) and cannot be the primary mechanism. When you do find a same-SHA
  attempt flip during a scan, treat it exactly like a Playwright signal:
  escalate immediately, no accumulation required.

## Step 1: List Candidate Runs

Watched workflows (by their GitHub Actions display name, not the file name):

- `Node CI for app development` — hosts `ci-app-test`, `ci-app-test-integration`
- `Node CI for app production` — hosts `run-playwright` (via the reusable
  `Reusable build and test app for production` workflow)

Query **each workflow separately** — do not pull the unfiltered
`actions/runs` list and filter client-side: the repo runs several other
workflows (CodeQL, Auto-labeling, Auto approve PR, …), so a generic window of
recent runs can contain almost none of the two being watched.

Call, once per watched workflow file (`ci-app.yml` = "Node CI for app
development", `ci-app-prod.yml` = "Node CI for app production" — confirm with
`gh api repos/growilabs/growi/actions/workflows -q '.workflows[] | {name,path}'`
if these file names ever change):

```bash
node bin/flaky-ci/scripts/list-candidate-runs.ts \
  --workflow ci-app.yml \
  --window-hours {window-hours, default 32} \
  --max-runs {max-runs-per-workflow, default 300}
```

Output fields (exit 0): `runs[]` — one per completed run created within the
trailing `--window-hours`, newest first, each with `id`, `conclusion`,
`headSha`, `createdAt`, `url`, `event`, `attempt` — and `truncated` (boolean).
Exit 2: no run at all could be fetched for this workflow (the GitHub API
failed before any page was read) — report it as a script failure in Step 6,
the same as any other script's exit 2.

**A `truncated: true` result is not a script failure** — the script still
exits 0, so it does not belong in Step 6's "Script failures" line (that line
is gated on non-zero exit; see Step 5 below for where this fact is reported
instead). It means either `--max-runs-per-workflow` was reached before the
`--window-hours` window was exhausted, or a later page failed after some
runs were already read. Either way this workflow's candidate list may be
missing older failures still inside the window, and the reader should treat
it as an incomplete scan for this run of the routine, not an empty one.

This naturally includes pull_request and merge-queue-triggered runs; a scan
that only looked at "PR checks" would miss the failures that surface in the
merge queue, which has happened.

While you have this data, check for same-SHA reruns: group `runs[]` by
`headSha` within each workflow's result and look for one appearing more than
once with `attempt > 1` on the later entry. If an earlier attempt failed and a
later one succeeded, every job that flipped between them is a confirmed flaky
occurrence (Step 3, "confirmed" path) — skip Step 2 classification for it,
since a same-SHA pass/fail flip has no infra-vs-product ambiguity to resolve.
This is rare (2 occurrences in the most recent 100 runs, measured), so a quick
group-by over the returned `runs[]` is enough; skip it under time pressure.

Keep only runs with `conclusion == "failure"` for the main Step 2 flow.

## Step 1.5: Known-Run Skip List

Fetch the existing flaky issues now (Step 4 needs this list anyway — do it
here instead so it's available before the expensive part of Step 2):

```bash
node bin/flaky-ci/scripts/fetch-flaky-issues.ts
```

Output fields (exit 0): `issues[]` — one per issue currently carrying
`flaky/observing`, `flaky/suspected` or `flaky/confirmed` (both open and
closed — the default `--labels`), each with `number`, `title`, `state`,
`body`, `labels[]` (label names), `comments[]` (each `id`, `body` — full
text, not an excerpt), `commentsStatus` (`"ok"`, or `"unavailable"` when
that one issue's comments could not be read — treat its `comments[]` as
incomplete, not as "no comments", and do not drop the row); `labelFetchFailures[]`
— which of the three labels' list fetch failed outright. Exit 2: no issue
could be fetched for any of the three labels.

**A non-empty `labelFetchFailures` means `issues[]` is incomplete, not that
the named tier genuinely has zero issues right now** — a label whose fetch
failed contributes no rows at all, so any tracking issue that only carries
that label is silently missing from `issues[]` for the rest of this run
(the skip-list below, and Step 4's exact-title lookup, both read from
`issues[]`). This still exits 0, so it does not belong in Step 6's "Script
failures" line (that line is gated on non-zero exit) — report it via Step
5's incomplete-data sentence instead, the same place `list-candidate-runs`'s
`truncated` is reported.

For each issue, extract every `actions/runs/{id}` URL appearing anywhere in
its `body` or any `comments[].body` into one set — the skip-list. In Step 2,
if a failed run's `RUN_ID` is already in this set, **do not re-fetch its job
log at all**: its evidence is already recorded on some issue, so exclude it
from Step 2 onward. This is what keeps a frequent cron cadence cheap, since
every overlapping window would otherwise re-fetch the same job logs. (④'s
backfill does its own equivalent check per-issue — the two skip-lists serve
different loops.)

**Run ④'s targeted backfill now**, filtering this same issue list down to open
`flaky/observing` ones — see "Cheap Suspicion Mining" ④ above. It is
independent of whatever Steps 2-4 find, so doing it here just gets it out of
the way before the larger fresh-candidate loop.

## Step 2: Fetch Failed Jobs and Classify Noise

`{RUN_ID}` below is the `id` from Step 1's `runs[]`. **Skip any `{RUN_ID}`
already in Step 1.5's skip-list before doing anything else in this step** —
its evidence is already recorded, so there is nothing new to extract from
it.

For each remaining failed run, list its jobs and keep the ones with
`conclusion == "failure"` (skip `cancelled` — those are pre-emptions by a
newer push, not evidence of anything). The run id selects the jobs; the
`{JOB_ID}` it returns is what every log fetch below is addressed by, for the
attempt reason spelled out below.

```bash
gh api repos/growilabs/growi/actions/runs/{RUN_ID}/jobs -q '.jobs[] | select(.conclusion == "failure") | {id, name}'
```

Fetch each failed job's log using **whichever method Step 0 of
`flaky-ci-routine.md` decided for this run** (decided once at the start of the
routine, not re-decided per log). If invoked standalone, do that same one-time
probe yourself first: if `mcp__github__get_job_logs` appears in your available
tools use it for every job log fetch below, otherwise use the `gh` path — and
apply the routine's Reading conventions as well (REST `gh api` only, `-X GET`
whenever `-f`/`-F` is passed, `--paginate -q` folds per page). Do
not try one and fall back to the other per log — the capability is a property
of the environment, not of any individual log fetch.

Both paths end the same way: the log lands in a file, and
`node bin/flaky-ci/scripts/parse-job-log.ts` reads that file on stdin —
never a path or a job id — which is exactly why the two fetch methods can
converge on one call (Requirement 3.2). Neither path needs a separate ANSI
strip or grep pass; the script does both internally.

```bash
# gh path (devcontainer / any environment where the egress proxy allows
# results-receiver.actions.githubusercontent.com and *.blob.core.windows.net)
LOG_FILE="${TMPDIR:-/tmp}/flaky-job-{JOB_ID}.log"
gh api --allow-escape-sequences "repos/growilabs/growi/actions/jobs/{JOB_ID}/logs" > "$LOG_FILE"
```

**Never use `gh run view --job {JOB_ID} --log-failed` to read a specific
attempt's log.** When a run has been re-run, that command exits 0 and prints
a full log — but it is the **latest** attempt's log, whatever attempt the job
id belongs to, and nothing warns you. Measured: on a run whose attempt 1
failed and attempt 2 succeeded, asking for attempt 1's failed job returned
attempt 2's successful log, so the evidence read `150 passed` — silently
destroying the same-SHA attempt flip above, the one gold-standard vitest
signal this skill has. The `actions/jobs/{JOB_ID}/logs` endpoint is addressed
by job id rather than by run, so it returns that job's own attempt.

`--allow-escape-sequences` is required on the `gh api` call above, or `gh`
refuses with exit 1 and `the response contains terminal escape sequences;
pass --allow-escape-sequences to output it anyway`.

```
# MCP path (cloud routine — the blob-storage redirect above is Forbidden
# through this environment's egress proxy; the MCP tool fetches server-side
# instead). Save the tool's result to the same kind of file with Write —
# parse-job-log.ts only ever reads a file on stdin, so this is the one extra
# step the MCP path needs that the gh path (which already redirects to a
# file above) does not.
mcp__github__get_job_logs(owner="growilabs", repo="growi", job_id={JOB_ID}, failed_only=true)
# → Write the returned text to "${TMPDIR:-/tmp}/flaky-job-{JOB_ID}.log"
```

```bash
node bin/flaky-ci/scripts/parse-job-log.ts < "$LOG_FILE"
```

Output fields (see `bin/flaky-ci/README.md`'s contract table for the exact
shape): `vitest.failBlocks[]` (`project`, `specPath`, `testTitle`,
`sharedSetupHook`, `excerpt`), `playwright.annotations[]` (`file`, `title`),
`playwright.summary` (`failed`/`flaky`/`passed`/`skipped`, or `null` when the
log carried no count line at all — Step 3's tier-1 rule below depends on
telling that `null` apart from a captured `0`), `denylistHits[]`
(`blockIndex`, `specPath`, `testTitle`, `pattern`, `needle`, `scope`). Exit
code `2` means stdin was empty or unreadable — treat that job's evidence as
"could not be measured" per Requirement 3.4 (report it in Step 5, do not
guess at its content from anywhere else) rather than as "no failures".

### Step 2b: also check successful `run-playwright` jobs for in-run flakes

A shard where a test failed and then passed on retry ends the *job* as
`success`, because Playwright's own retries absorbed it before the exit code
was decided, so the failed-job scan above never sees it and misses most of
Playwright's "free" flaky signal. Additionally scan successful
`run-playwright` jobs from runs in the Step 1 list (any conclusion) — cheap
the same way as the failed-job scan above, since `parse-job-log.ts` returns
only the extracted JSON facts, never the raw log, to this procedure.

**Select those jobs with `contains("run-playwright")`, not a prefix match.**
The job runs through the reusable `Reusable build and test app for
production` workflow, and GitHub prefixes the calling job's name onto it, so
the real names read `test-prod-node24 / run-playwright (chromium, 1/2, 8.0)`.
A prefix match on the job name matches none of them and turns this whole step
into a silent no-op — measured on one scan, the same run list yielded 0 jobs
by prefix and 61 by substring. As in Step 2, the run id selects the jobs and
each returned `{JOB_ID}` is what the log fetch is addressed by:

```bash
gh api repos/growilabs/growi/actions/runs/{RUN_ID}/jobs \
  -q '.jobs[] | select(.name | contains("run-playwright")) | select(.conclusion == "success") | {id, name}'
```

Use the same Step-0-decided method, the same file-then-`parse-job-log.ts`
shape as the failed-job fetch above, and the same `LOG_FILE` naming
(`${TMPDIR:-/tmp}/flaky-job-{JOB_ID}.log`):

```bash
# gh path
gh api --allow-escape-sequences "repos/growilabs/growi/actions/jobs/{JOB_ID}/logs" > "$LOG_FILE"
# MCP path
mcp__github__get_job_logs(owner="growilabs", repo="growi", job_id={JOB_ID}, failed_only=false)
# → Write the returned text to "$LOG_FILE"

node bin/flaky-ci/scripts/parse-job-log.ts < "$LOG_FILE"
```

If `playwright.annotations` is empty **and** `playwright.summary` is either
`null` or has `flaky: 0`, the shard had no flakiness — move on. Otherwise
proceed to Step 3's Playwright extraction using this same output (there is
no separate excerpt to re-fetch — the whole log already went through the
script once). Note for Step 3's count test: these jobs concluded `success`,
and a test that is still failing after its last retry fails the job, so
`N failed` is 0 by construction here and the shard's count sum is the
`N flaky` number alone.

For the issue body's Evidence section (Step 4's template), quote the lines
around the matching annotation directly from `$LOG_FILE` — it is still on
disk from the fetch above.

**Classify infrastructure noise first — do not track these as flaky.** Read
`denylistHits[]` from `parse-job-log.ts`'s output (already fetched above; the
list itself is not repeated here — see below) before treating anything as
flaky. Each hit names the `blockIndex` of the `vitest.failBlocks[]` entry it
matched, plus which `pattern` and `needle` fired. Log each hit in this run's
report as "infra noise, skipped", naming its `pattern`.

**Read the hit's `scope` to know how far it reaches** — this is the one
judgment the script does not make for you:

- `scope: "failure"` drops only that one failure. The script matches per
  failure's own excerpt, never the whole job log, on purpose: matching the
  whole log on one unrelated line would have dropped 96 unrelated failures
  along with the one real infra failure (research.md → 「infra noise は失敗
  ごとに判定する（ジョブログ全体で判定しない）」).
- `scope: "job"` — the match is inside a hook registered under
  `test/setup/**` (the shared setup-hook shape Step 3 defines) — means every
  failure in this job log is noise, because that hook ran before all of them
  and the whole job was starved by the same infrastructure problem. Nothing
  else in a job log has that reach.

**The list is data, in `bin/flaky-ci/lib/denylist.ts`'s `INFRA_NOISE_PATTERNS`
— read it there, do not expect a copy in this procedure.** Widening it stays
a judgment the script does not make: keep it small and additive, and add an
entry only when a genuine false positive is found, never broaden matches
speculatively.

**One shape never became a literal pattern, and `denylistHits[]` will never
report it: generic `curl` retry exhaustion** (`--retry 60` blocks timing out,
seen in `ci-app.yml` / `reusable-app-prod.yml` service-wait steps). It names
no fixed string a log can be matched against — inventing one (`curl`, or an
exit-code number) would over-match ordinary product failures that merely
mention curl over an unrelated retry. When a failure's own excerpt looks like
this shape, classify it as infra noise by judgment, the same way as before;
the script has nothing to say about it.

Everything that has no `denylistHits[]` entry and does not look like the
curl-exhaustion shape above is a candidate for Step 3.

## Step 3: Extract Test Identity and Evidence

### Playwright jobs (`run-playwright ...`)

Job names carry a shard number and MongoDB version that are **not stable
identity** — the same spec lands on a different shard number across runs, so
including it would fragment one flaky spec into many never-deduped issues.
The browser (`chromium`/`firefox`/`webkit`) IS meaningful, since the same spec
can be flaky in one engine and not another. Extract it from the job name, e.g.
`test-prod-node24 / run-playwright (firefox, 1/2, 8.0)` → browser = `firefox`
(the `test-prod-node24 / ` part is the reusable workflow's calling job).

The reliable, structured signal is `parse-job-log.ts`'s `playwright.summary`
(`failed`/`flaky`/`passed`/`skipped`, or `null` when the log carried no count
line at all) and `playwright.annotations[]` (`file`, `title` — repeats kept,
in the order printed). **Attributing a specific `flaky` count to a specific
spec name from the raw log is not reliable**: the reporter interleaves
`pw:api` debug traces with retry/attachment lines in a way that does not
cleanly pair a `Retry #N` block with its spec, so a precise adjacency
heuristic will misattribute. Use a two-tier approach instead.

**A test that failed and then passed on retry is annotated too.** Playwright
emits an `::error file=...,title=...` annotation for it just as it does for a
test that ended failed, and the summary line then reads `0 failed` /
`1 flaky` — the *most common* shape of a Playwright flake, so the flaky test
is in the annotation list, not left over beside it.

1. **Precise identity (tier 1)** — use it when **both** of these hold in that
   shard's `parse-job-log.ts` output:

   - `playwright.annotations` contains **exactly one distinct** entry (by
     `file` + `title` together), and
   - `playwright.summary` is not `null`, and its `flaky` plus `failed` equals
     1. `playwright.summary` being `null` means the log carried no count line
     at all — both counts are unknown, not zero, and this test does not
     apply; fall back to the job-level identity below rather than reading the
     gap as a zero. A *captured* summary already carries `0` for any count
     line the shard didn't print (a successful shard prints no `failed`
     line), so once `playwright.summary` is non-`null` there is no separate
     "missing line" case left to reason about.

   The two together are what make the attribution safe: the counts say the
   shard produced exactly one non-clean test result, and the single
   annotation is the only thing that names one.

   **Do not require a retry attachment path.** `apps/app/playwright.config.ts`
   sets `screenshot: 'only-on-failure'`, so a test whose retry *passes*
   writes failure artifacts for the first attempt only and the retry's own
   output directory never appears in the log. Since a retry that passes is
   the most common flake shape, an attachment-path test would be empty almost
   every time and tier 2 would fire on exactly the cases tier 1 exists for.

   The identity is then `playwright:{BROWSER}:{SPEC_PATH}:{TEST_TITLE}`,
   with both halves **normalized** — the annotation's raw values are not the
   identity:

   - `{SPEC_PATH}` — the annotation's `file` field with the leading
     `apps/app/` removed.
   - `{TEST_TITLE}` — the annotation's `title` field with the leading
     `[{browser}] › ` removed, then the `{path}:{line}:{col} › ` location
     segment that follows it removed, then **every remaining ` › ` replaced
     by ` > `**.

   Worked example, the annotation that produced issue #11903
   (`{file: "apps/app/playwright/20-basic-features/inline-comment.spec.ts",
   title: "[chromium] › playwright/20-basic-features/inline-comment.spec.ts:4758:3 › Inline comment - visual refresh: mockup cross-check captures › Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)"}`):

   normalizes to this identity key (what #11903's title carries today):

   ```
   playwright:chromium:playwright/20-basic-features/inline-comment.spec.ts:Inline comment - visual refresh: mockup cross-check captures > Capture popover states 5 (normal) and 6 (edit mode) in DARK mode (Req 4.4)
   ```

   Normalizing is not cosmetic: Step 4 searches for an existing issue by
   this exact title, so an un-normalized key (with `apps/app/`, with the
   `[chromium] › file:line:col › ` prefix, or with ` › ` left in place) does
   not match the issue the previous run created and files a duplicate
   instead. Note that a title may itself contain `:` — #11903's does — so
   never rebuild the key by splitting the normalized title on punctuation.

   Always include `{BROWSER}`, per the "browser IS meaningful" rule above —
   every tracking issue this skill has created for a specific spec already
   carries it, and omitting it here would fork the identity key from the
   title format Step 4 actually searches on, which is exactly the
   "title/search mismatch → duplicate" failure that section warns about.
2. **Fallback (tier 2, job-level)** — use `playwright:{BROWSER}` as the
   identity in each of these three cases, which are exactly the cases tier 1
   does not cover:

   - **more than one distinct entry in `playwright.annotations`** — several
     tests are named and which one the count refers to is genuinely unknown;
   - **the counts do not add up to the annotation count** (`playwright.
     summary.flaky` + `.failed` is not 1 against a single annotation) — the
     log is describing more, or fewer, non-clean results than it names, so
     the one annotation cannot be assumed to account for the shard's count;
   - **the annotation's `title` is `null`** — there is then a file but no
     test to name.

   Say so explicitly in the issue body: "flaky test detected in this shard's
   log (see excerpt below) but the specific spec could not be isolated from
   the log alone — see the linked run for the full report." This is
   intentional: a coarser but honest identity beats a fabricated precise one.

Either tier counts as a **confirmed** occurrence (see Step 4) **when the
shard's summary reports `N flaky` ≥ 1** — Playwright already retried in-run
and the test still needed a retry to pass, regardless of whether this skill
can name the exact spec. That is the Step 2b shape (`0 failed / 1 flaky`).

The one shape tier 1 admits that this does **not** cover is `1 failed /
0 flaky` on the Step 2 failed-job path: the counts still sum to 1 and the
annotation still names the test, so the precise identity is right, but the
test failed on **every** attempt — nothing about that is retry-proven. Treat
such a result exactly like a vitest failure, per the Vitest section below:
the identity is precise, and the result is an **observation**, not a
confirmation. Run it through "Cheap Suspicion Mining" — ①, ② and ③ apply
(⑤ does not: it is about a Vitest project's `setupFiles` hook, which a
`run-playwright` job has no counterpart for) — a hit makes it a
**suspected** occurrence (tier 2), otherwise it is a plain observation
(tier 1, the passive `flaky/observing` path). **Either way, proceed to
Step 4.** Never record a failed-every-attempt Playwright result as
`confirmed`.

### Vitest jobs (`ci-app-test`, `ci-app-test-integration`)

Each entry in `parse-job-log.ts`'s `vitest.failBlocks[]` is one FAIL block:
`project`, `specPath`, `testTitle` (`null` for a file-level FAIL line, which
names no test at all), `sharedSetupHook` (see below), and `excerpt` (the
`FAIL` line plus the error and stack lines printed under it — this is the
evidence text the issue body quotes).

Identity key: `vitest:{SPEC_PATH}:{TEST_TITLE}`.

This is an **observation**, not a confirmation. Before proceeding to Step 4,
run it through "Cheap Suspicion Mining" above — a hit there makes this a
**suspected** occurrence (tier 2) instead of a plain observation (tier 1).
Either way, proceed to Step 4.

**But not every FAIL block is its own identity.** One cause routinely
produces many FAIL blocks in a single job log: a shared setup hook that
times out takes down every spec file the pool handed it, and the first
failing test in a spec file can poison the rest of that file. The three
subsections below fold those into one identity **before** anything reaches
Step 4. Apply them in this order — they are what keeps the tracker's issue
count equal to the number of causes:

1. Shared setup-hook timeouts (one identity per hook, not per spec file)
2. Collateral timeouts in the same job log
3. Cascaded failures in the same spec file and job log

### Shared setup-hook timeouts: one identity per hook, not per spec file

A hook registered in a Vitest **project's `setupFiles`** (e.g.
`test/setup/migrate-mongo.ts`) runs for every spec file assigned to the
worker, so when it times out, the spec files that report `FAIL` are
incidental — they are the files that happened to be in flight, not N
separate flaky tests. (This is the same phenomenon mining check ⑤
measures; ⑤ decides the *tier*, this decides the *identity*.)

**How to tell a shared setup-hook timeout from a spec file's own hook:**
read the FAIL block's `sharedSetupHook` field from `parse-job-log.ts`'s
output — `true` when that block's own excerpt carries a stack frame
resolving under `test/setup/` (the frame printed directly under the error,
not the `FAIL` line), `false` otherwise. That frame is the only reliable
discriminator (an example of each, for context — this is what the field is
reading):

```
Error: Hook timed out in 20000ms.
 ❯ test/setup/migrate-mongo.ts:52:1      ← under test/setup/ → sharedSetupHook: true
```

```
Error: Hook timed out in 10000ms.
 ❯ src/server/service/user-group.integ.ts:60:3   ← a spec file → sharedSetupHook: false
```

The field decides the routing on its own:

- **`sharedSetupHook: true`** → shared setup-hook timeout. Every spec file in
  this job log failing with the same error and the same frame collapses into
  **one** identity. List the affected spec files inside the issue body /
  observation comment's log excerpt; do not open one issue per file.
- **`sharedSetupHook: false`** → this is that spec file's own
  `beforeAll`/`beforeEach` and **not** a shared setup-hook timeout, even when
  the hook body calls a helper defined under `test/setup/` (the
  `getInstance()` timeouts are exactly this case: the helper lives in
  `test/setup/crowi.ts`, but the hook is registered in the spec file and the
  frame says so). Route it as an ordinary identity — or, if this job log also
  has a shared setup-hook timeout, as collateral (next subsection). A hook has
  no test title, so spell the identity's `{TEST_TITLE}` part as
  `beforeAll hook timeout ({N}ms) — {the call on the frame line, e.g. getInstance()}`
  (substitute `beforeEach`/`afterAll`/`afterEach` as the log says). Existing
  tracking issues already use that spelling, so the exact-title match in
  Step 4 — including promoting a collateral candidate to its own issue
  (Requirement 7.2) — lands on the same issue instead of a duplicate.

Identity key for a shared setup-hook timeout (used when creating a new
issue):

`vitest:{SETUP_FILE_PATH}:{HOOK_NAME} setup hook timeout ({N}ms) during {JOB_NAME_WITHOUT_MATRIX}`

e.g. `vitest:test/setup/migrate-mongo.ts:beforeAll setup hook timeout (20000ms) during ci-app-test-integration`.

**Reconciliation exception, for shared setup-hook identities only.** Step 4's
exact-title match works because an identity key is reproduced
character-for-character from the log every time — true of
`vitest:{SPEC_PATH}:{TEST_TITLE}`, but *not* of the descriptive wording
above. So for this one kind of identity, look up the tracking issue by the
setup file's path instead: among the flaky-labelled issues already fetched in
Step 1.5 — **both states, open and closed** (that query is `state=all`, so
this needs no new API call) — find those whose title contains this setup
file's path, then split them by `state` and take the first rule that applies.

- **Exactly one OPEN match** → that is this hook's tracking issue. Take the
  appropriate existing-issue branch in Step 4 against it; do not create
  anything.
- **More than one OPEN match** → create nothing, comment the observation on
  the lowest-numbered open match, and report the ambiguity (issue numbers,
  setup file) in Step 5 so a human can merge them.
- **No open match, but one or more CLOSED matches** → hand the
  lowest-numbered closed match to Step 4's **CLOSED-issue branch** and let its
  two-timestamp comparison decide between reopening and recording a historical
  note. Do not create a new issue here, and do not reopen on the path match
  alone. Report any extra closed numbers in Step 5 as the ambiguous-open case
  does.
- **No match in either state** → create a new issue with the identity key
  above.

An open match always wins over a closed one, since the question is "what
tracks this hook right now". The lookup still has to cover closed issues,
because the CLOSED-issue branch is otherwise reached only by an exact title
match that a descriptive setup-hook title never satisfies — without that
route, the first recurrence after such an issue is closed would file a
duplicate and split the hook's history across two issues.

This exception is scoped to setup-hook identities and nothing else: every
other identity keeps exact-title matching, and the "do not fuzzy-match" rule
in Step 4 and the ambiguous-identity rule in Error Handling are unchanged.
The `### Collateral candidate` comment is unaffected too — it is not an
observation, so it is posted whatever the issue's state, and it never enters
the reopen decision.

### Collateral timeouts in the same job log

When a job log contains at least one shared setup-hook timeout, the whole
worker pool in that job was starved for time, so other files timing out in the
same log are most likely victims of that starvation rather than flaky in their
own right. Filing them separately is what makes one cause look like four,
which has already happened to three tracking issues.

**Collateral set** — in a job log that has a shared setup-hook timeout,
every *other* failure in **that same job log** whose error is:

- `Hook timed out in Nms` with a frame resolving into a spec file, or
- `Test timed out in Nms` (a test body, always attributed to its spec file)

**Never collateral**, no matter what else is in the log — these have no
load-based explanation, so they go through Step 4 as ordinary identities:

- assertion failures (`AssertionError`, `expected … to …`)
- unhandled rejections
- connection / socket errors (`ECONNREFUSED`, `MongoNetworkError`, …)
- another shared setup-hook timeout (frame under `test/setup/`) — each
  shared hook keeps its own identity and its own tracking issue

**Scope is one job log, not one run.** A run's jobs are separate processes on
separate runners; `ci-app-test`'s failures are not collateral of
`ci-app-test-integration`'s starved hook. Compute the collateral set per job
log and record the run URL only as a reference.

**Order of work.** Route this log's shared setup-hook identity (or
identities) through Step 4 first, so the tracking issue exists, then post
**one** `### Collateral candidate` comment per job log listing every
collateral entry from that log — and none at all when the log has a shared
setup-hook timeout but zero collateral entries. Two shared setup hooks in one
log still go through Step 4 separately (two identities, two tracking issues),
but the collateral comment remains a single comment.

**Which issue receives the comment**, when a log has more than one shared
setup-hook timeout: the one accounting for the **most affected spec files**
in this job log; on a tie, the one whose first FAIL block appears earliest.
Post it even if that issue is closed — it is not an observation, so it must
**not** go through the CLOSED-issue reopen decision, and it changes no labels
and no tier.

```bash
BODY_FILE="${TMPDIR:-/tmp}/flaky-collateral-body-{NUMBER}.md"

cat > "$BODY_FILE" <<'EOF'
### Collateral candidate

Not filed as separate issues: this job log also carried a shared setup-hook
timeout (this issue's identity), so these timeouts are most likely victims of
the same starvation rather than flaky in their own right.

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}

| Spec file | Test / hook | Timeout |
|---|---|---|
| {SPEC_PATH} | {TEST_TITLE, or the hook, e.g. `beforeAll`} | {N}ms |

_Generated by [Claude Code](https://claude.ai/code)_
EOF

gh api "repos/growilabs/growi/issues/{NUMBER}/comments" -X POST -F body=@"$BODY_FILE"
```

Collateral entries create no issues and are not observations — see "Which
comment headings count as an occurrence" below.

**When a collateral candidate turns out to be flaky on its own.** If one of
these spec+test pairs fails in a job log with **no** shared setup-hook
timeout, that failure is ordinary evidence: take it through Step 4 as any
other identity. Before creating, re-read the `### Collateral candidate`
comments on the tracking issues whose identity names a path under
`test/setup/` (already in hand from Step 1.5) for a row naming this spec file
and title; if one exists, add its run URL to the new issue's body as prior
context:

```
- Prior collateral sighting: {RUN_HTML_URL} (recorded on #{N} on {DATE}; prior context, not an observation)
```

Use the earliest matching row, and do **not** move `### First observation`
back to that date or count it toward `--vitest-threshold` — it was explicitly
not counted as an occurrence when it was recorded.

### Cascaded failures in the same spec file and job log

Once a test fails, the rest of its spec file can fail for the same reason — a
poisoned React `act()` queue, a torn-down fixture, a connection the first test
left broken — so those later failures carry no independent information. Three
tracking issues have already been filed for followers of a single failure.

**Cascade** = two or more FAIL blocks for the **same spec file** in the
**same job log**. The **identity is the first one in log order**; every
later FAIL block for that file in that log is a cascaded failure and gets no
issue of its own.

Read the order from the reporter's per-file block — the `×` lines, which are
printed in the file's own execution order:

```
 ❯  app-components  src/client/.../AdminCodeEditor.spec.tsx (9 tests | 4 failed) 232ms
   × AdminCodeEditor > theme following > applies the dark theme when in dark mode   ← identity
   × AdminCodeEditor > accessible label > ...                                       ← cascaded
   × AdminCodeEditor > editing aids > ...                                           ← cascaded
   × AdminCodeEditor > controlled value > ...                                       ← cascaded
```

If that block is not in the log, fall back to the order of the
`FAIL {SPEC_PATH} > {SUITE} > {TITLE}` blocks in the `Failed Tests` section.

Cascaded titles go in the `Cascaded in the same run` section of the issue body
(new issue) or of the `### Additional observation` comment (existing issue) —
see Step 4 for both shapes.

Two limits keep this from swallowing real evidence:

- **One spec file only.** Unlike collateral, a cascade never spans files. Two
  files failing in one log are two identities (unless the collateral rule
  applies).
- **One job log only.** The same title failing in another job log, or in
  another run, is an independent observation and reaches Step 4 on its own.

### Which comment headings count as an occurrence

`.claude/commands/flaky-ci-routine.md` Step 5 item 3 defines the count: **1**
for the issue body, plus the comments whose **first line** prefix-matches
`### Additional observation` or `### Backfilled observation`. Two
consequences the rules above depend on, which must not be "simplified" away:

- Never rename `### Collateral candidate` to anything starting with
  `### Additional observation` — its first line not matching is the whole
  mechanism keeping collateral entries off the dashboard.
- Always nest a cascade list **inside** the observation comment, under a
  `Cascaded in the same run` heading in the middle of the body. Never post
  one observation comment per cascaded test (that would multiply the count),
  and never post the cascade list as a comment of its own (nothing would
  count it and nothing would link it to the identity).

### Failures the PR itself owns: exclude before Step 4

A tracking issue is only worth having if it describes something that fails
non-deterministically **on `master`**. A spec file a PR is in the middle of
writing fails on that PR's own branch for the most ordinary reason there is,
and that failure will never be seen again once the branch is gone — filing it
produces an issue nobody can act on, which has happened twice.

Run this check **once per identity that survives the folding above**, between
Step 3 and Step 4, for both vitest and Playwright identities. Per identity,
not per run: the same run can carry one failure the PR owns and another it
does not, and only the first is excluded. Cascaded followers and collateral
entries are already folded away, so they live or die with the identity they
were folded into.

**Step A — is the failing commit on `master` at all?**

```bash
gh api -X GET repos/growilabs/growi/compare/master...{HEAD_SHA} -q .status
```

- `behind` or `identical` → the commit **is** an ancestor of `master`; the
  failure happened on code that actually shipped. Skip the rest of this
  check and go to Step 4 normally.
- `ahead` or `diverged` → the commit is **not** an ancestor of `master`
  (`ahead` = it carries commits `master` doesn't; `diverged` = both sides
  carry their own). Continue with Step B.

**Step B — find every PR the commit belongs to.**

```bash
gh api repos/growilabs/growi/commits/{HEAD_SHA}/pulls \
  -q '.[] | {number, base: .base.ref, state}'
```

Consider **every** PR this returns, not `.[0]` — ①'s `-q '.[0].number'` is
fine for picking one description to read, but it is wrong here. A real
failing commit belonged to two PRs at once, one based on `master` and one on
a feature branch, both of which changed the failing spec; `.[0]` would have
reported only one of them. Do **not** filter by base branch either — a PR
targeting a feature branch is exactly the case this rule exists for.

If the endpoint returns nothing, the commit may still belong to a PR by
another route:

- **Merge-queue commits.** Mergify names the branch
  `mergify/merge-queue/{hash}` — a hash, **not** the PR number — and the
  commit drops its PR association once the queue entry is done, so
  `commits/{sha}/pulls` comes back empty (verified on a real queue commit).
  The PR number is in the commit message instead:

  ```bash
  gh api repos/growilabs/growi/commits/{HEAD_SHA} -q '.commit.message'
  ```

  Its first line reads `Merge of #{PR_NUMBER}`. Match only that literal
  `Merge of #{N}` pattern, and take every occurrence — Mergify can batch
  several PRs into one queue commit. Do **not** scrape arbitrary `#{N}`
  tokens from the rest of the message: a squashed body's `Refs #...` /
  `Fixes #...` names an issue or an unrelated PR, and fetching that PR's
  files would exclude a real flake. A merge-queue commit is never an ancestor
  of `master`, so treat it like any other non-ancestor commit.
- **Still no PR.** A direct push to a feature branch. Skip Step C and
  **exclude** the failure: the commit is not on `master` and there is no PR
  whose files could vindicate it, so there is nothing a tracking issue could
  ever be checked against. Report it in Step 5 with the head branch name in
  place of a PR number.

**Step C — did any of those PRs change the failing spec file?**

```bash
gh api repos/growilabs/growi/pulls/{PR_NUMBER}/files --paginate -q '.[].filename'
```

Reuse the files already fetched for the PR ① looked at; fetch
`pulls/{n}/files` for any other PR the commit belongs to. ① only ever reads
`.[0]`'s files, so on a commit with more than one associated PR — the
two-PR case above — the others have not been fetched yet.

**Match by path suffix, not by equality.** The two sides are rooted
differently: PR `files[].filename` is relative to the repository root
(`apps/app/src/features/backlinks/server/services/page-link-lifecycle.integ.ts`),
while a vitest identity's `{SPEC_PATH}` is what the reporter prints, which is
relative to `apps/app`
(`src/features/backlinks/server/services/page-link-lifecycle.integ.ts`). A
PR file matches when its filename **equals `{SPEC_PATH}` or ends with
`/{SPEC_PATH}`**. Comparing the two for equality finds nothing and quietly
turns this whole check into a no-op — do not "simplify" it to `==`.

- **Any PR changed the failing spec file** → **exclude**. Create no issue,
  post no comment on an existing issue for this identity, change no label and
  add no occurrence: it does not enter Step 4 at all. Count it in Step 5 and
  list the PR number(s) that matched.
- **No PR changed it** → go to Step 4 normally. (A dependency bump that broke
  the spec without touching it lands here — see ①'s lockfile check, which
  stops ① from calling such a failure "unrelated" but does not exclude it.)
- **A Playwright job-level fallback identity** (`playwright:{BROWSER}`, no
  spec path) has nothing to match against, so Step C can never exclude it.
  Let it through to Step 4.

**Fail open.** If Step A's compare returns an error (a merge-queue commit can
be garbage-collected before the scan reaches it, giving `404`) or the
PR/files fetch fails, **do not exclude** — go to Step 4 as usual and note the
unresolved check in Step 5. Losing a real flake to an API hiccup on an
unattended run is far worse than carrying one issue a human can close.

## Step 4: Reconcile Against Existing Issues

**Every comment this skill posts ends with the automated signature line**
`_Generated by [Claude Code](https://claude.ai/code)_` (defined once in
`flaky-ci-routine.md` → Shared constants). When the routine runs under a
human maintainer's token its author check cannot help, so an unsigned
observation comment on a `flaky/needs-decision` issue would be read as the
human's answer and wrongly resume the investigation. The templates below
already carry the line — keep it when editing them.

**The issue title IS the identity key, verbatim** — deliberately, so the
search below can never drift out of sync with what was written at creation
time. Do not use a separately-worded human-friendly title with the identity
key tucked into the body: a title/search mismatch means every scan sees "no
existing issue" and creates a duplicate.

Title format (fixed):
`flaky: {IDENTITY_KEY}`

e.g. `flaky: vitest:src/features/external-user-group/server/service/external-user-group-sync.integ.ts:syncs groups and deletes groups that do not exist externally`
or `flaky: playwright:firefox` (job-level fallback identity).

**Use `gh api` (REST), not `gh issue list --json` / `--search`** — see
`flaky-ci-routine.md` → Shared constants → Reading conventions, which also
covers the `-X GET` requirement every read below depends on.

Reuse the Step 1.5 list of every flaky-labelled issue (both states) rather
than re-querying, and look for an exact title match client-side, which is
also more precise than GitHub's fuzzy search tokenization. Treat an issue as
the same tracking issue only if its `title` is **exactly**
`flaky: {IDENTITY_KEY}` — do not fuzzy-match.

### No existing issue found

Create one. Fetch exact label names first (names carry emoji prefixes and
drift — never hardcode), via REST rather than `gh label list --json`:

```bash
gh api repos/growilabs/growi/labels --paginate -q '.[].name'
```

```bash
ISSUE_BODY_FILE="${TMPDIR:-/tmp}/flaky-new-issue-body.md"

cat > "$ISSUE_BODY_FILE" <<'EOF'
## Detected by detect-flaky-ci

**Identity key**: `{IDENTITY_KEY}`
**Kind**: {playwright | vitest} {(strong evidence: passed on in-run retry) if confirmed} {(cheap suspicion: {every matched check among ① diff/PR mismatch, ② sandwich pattern, ③ matrix divergence, joined with " + ", e.g. "① + ③"}) if suspected}

### First observation

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}
{if this identity was previously recorded as a collateral candidate, add — see Step 3:
"- Prior collateral sighting: {RUN_HTML_URL} (recorded on #{N} on {DATE}; prior context, not an observation)"}

### Evidence

```
{relevant log excerpt — the FAIL block or the ::error annotation + retry blocks}
```

{if this spec file had more than one FAIL block in this job log, add the
cascade section — heading and wording fixed, see Step 3:

"### Cascaded in the same run

The same spec file's later failures in this job log, folded into this issue
rather than filed separately (they follow from the failure above, not from
independent flakiness):

- {SUITE} > {TITLE}
- {SUITE} > {TITLE}"}

{if ① was suppressed by the lockfile check (see ① in "Cheap Suspicion Mining"), add this line regardless of which tier this issue ends up at, naming every package in `lockfile-overlap`'s `overlap[]`, comma-separated:
"- ① not applicable: lockfile changed `{PKG}` and the failure's stack trace runs through it"}

{if suspected, include the specific mining evidence **for every check that matched, not just one** — one line per match, e.g.:
"① PR #{N} changed {files}, none overlap this spec's path or stack trace"
"② same identity failed in run {A}, passed in intervening run {B}, failed again here"
"③ sibling matrix job {NAME} on the same commit passed"
List whichever subset actually matched; omit lines for checks that didn't hit.}

### Status

{pick exactly one:
 - confirmed (Playwright): "Confirmed flaky from a single run (Playwright retry evidence)."
 - suspected (vitest, mining hit): "Suspected flaky ({every matched check, e.g. "① + ③", ordered strongest-first: ③ > ② > ①}) — handed directly to investigate-flaky-test for a confirmation measurement (3 independent runs on the flaky-repro workflow), no threshold wait needed."
 - observing (vitest, no mining hit): "Observation 1/{VITEST_THRESHOLD} — needs {VITEST_THRESHOLD - 1} more independent occurrence(s) before this is handed to investigate-flaky-test."}
EOF

NEW_ISSUE_JSON=$(gh api repos/growilabs/growi/issues -X POST \
  -f title="flaky: {IDENTITY_KEY}" \
  -F body=@"$ISSUE_BODY_FILE" \
  -f 'labels[]=type/bug' \
  -f 'labels[]={EXACT_PHASE_NEW_LABEL}' \
  -f 'labels[]={TIER_LABEL}')

NEW_NUMBER=$(jq -r '.number' <<<"$NEW_ISSUE_JSON")
```

Repeating `-f 'labels[]=…'` is how `gh api` sends a JSON array field, so all
three labels land in the single creation call with no follow-up label write.
`$NEW_NUMBER` comes straight out of the response, not parsed from stdout text,
and `$NEW_ISSUE_JSON` holds the rest (`.html_url` for the Step 5 report, `.id`
for the sub-issue call). Keep that variable in scope: a separate tool call
starts a fresh shell that has none of these values.

`{TIER_LABEL}` is `flaky/confirmed` for Playwright, `flaky/suspected` for a
vitest observation that hit one of the three mining checks, `flaky/observing`
for a plain vitest observation with no mining hit.

### Attach the new issue to the dashboard as a sub-issue

Every issue this skill creates must become a GitHub sub-issue of the tracking
dashboard, growilabs/growi#11720 ("flaky-ci-routine: dashboard"). It does
**not** hide the issue from the default Issues list; what it buys is that
`is:issue is:open no:parent-issue` gives the non-flaky backlog without this
noise (verified), and the dashboard's own `sub_issues_summary` gives a
progress rollup.

Use the REST sub-issues endpoint, not the GraphQL `addSubIssue` mutation
(`flaky-ci-routine.md` → Shared constants → Reading conventions, again). Read
the numeric id back from the issue itself, by the `{NEW_NUMBER}` the create
call returned, so this snippet does not depend on a variable from an earlier
shell:

```bash
NEW_ISSUE_ID=$(gh api "repos/growilabs/growi/issues/{NEW_NUMBER}" -q '.id')
gh api repos/growilabs/growi/issues/11720/sub_issues -X POST -F sub_issue_id="$NEW_ISSUE_ID"
```

(`sub_issue_id` is the numeric database id from `.id`, not the issue
number and not the GraphQL node id — these are three different values for
the same issue.)

If this call fails, treat it the same as any other `gh` failure (see Error
Handling below): non-fatal, log it, continue the run. Do not block issue
creation on it and do not retry in a loop.

### Existing OPEN issue found, currently `flaky/observing`

Do not create a duplicate. Append an observation comment:

```bash
BODY_FILE="${TMPDIR:-/tmp}/flaky-observation-body-{NUMBER}.md"

cat > "$BODY_FILE" <<'EOF'
### Additional observation

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}

```
{log excerpt}
```

_Generated by [Claude Code](https://claude.ai/code)_
EOF

gh api "repos/growilabs/growi/issues/{NUMBER}/comments" -X POST -F body=@"$BODY_FILE"
```

**This comment shape is the single definition** used by every existing-issue
branch below (`flaky/suspected`, `flaky/confirmed`, and the reopened-CLOSED
path), including the addition that follows — do not restate a variant of it
per branch.

**Addition when this job log carried a cascade** (Step 3: two or more FAIL
blocks for this spec file in one job log). Append this section to the same
comment's body — one comment for the run, never one per cascaded test, and
never a comment of its own:

```markdown
### Cascaded in the same run

The same spec file's later failures in this job log, folded into this
observation rather than filed separately:

- {SUITE} > {TITLE}
- {SUITE} > {TITLE}
```

The comment still counts as exactly one occurrence, because the dashboard
prefix-matches only its first line — see "Which comment headings count as an
occurrence" in Step 3.

Then check both escalation paths, in this order:

1. **Does this new observation hit any mining check** — evaluate all of
   ① / ② / ③ against the accumulated history now that there are 2+
   occurrences, not stopping at the first hit. If so, escalate straight to
   `flaky/suspected`, skipping the threshold wait, and record every check
   that matched in the observation comment:
   ```bash
   gh api "repos/growilabs/growi/issues/{NUMBER}/labels" -X POST -f 'labels[]=flaky/suspected'
   gh api "repos/growilabs/growi/issues/{NUMBER}/labels/flaky%2Fobserving" -X DELETE
   ```
2. Otherwise, count observation comments (the issue body is observation 1)
   plus this new one. If the count reaches `--vitest-threshold`, escalate
   straight to `flaky/confirmed` — two independent naturally-occurring
   observations are the passive path's own confidence bar, with no extra
   rerun gate on top:
   ```bash
   gh api "repos/growilabs/growi/issues/{NUMBER}/labels" -X POST -f 'labels[]=flaky/confirmed'
   gh api "repos/growilabs/growi/issues/{NUMBER}/labels/flaky%2Fobserving" -X DELETE
   ```

### Existing OPEN issue found, currently `flaky/suspected` or `flaky/confirmed`

Still append the observation comment — useful evidence for
`investigate-flaky-test` — but do not change labels: the issue is already
queued for investigation, or already being investigated.

### Existing CLOSED issue found

**How this branch is reached.** Normally by the exact title match above; for
a shared setup-hook identity, also by Step 3's path lookup handing over its
lowest-numbered closed match. The decision below is identical either way —
the path match says *which* issue this is, never that it should be reopened.

New evidence against an identity whose tracking issue is already closed can
mean two different things, and they call for opposite actions: a genuine
regression that happened **after** the fix landed (reopen), or a failure that
happened **before** it landed and only surfaced now because this scan's
window or backfill reached far enough back (do not reopen — a historical
record, not a new occurrence). Do not reopen on title match alone; determine
which case this is by comparing two timestamps.

**Step A — get the new evidence's timestamp.** Use the failing run's
**commit** date, not the run's `CREATED_AT` — a run can execute well after
its underlying commit (e.g. a delayed re-run), so commit date is the
reliable one (same reasoning as ④'s backfill check above):

```bash
gh api -X GET repos/growilabs/growi/commits/{HEAD_SHA} -q '.commit.committer.date'
```

**Step B — get the fix's resolution timestamp.** Fetch every comment on
the closed issue:

```bash
gh api -X GET repos/growilabs/growi/issues/{NUMBER}/comments --paginate -q '.[].body'
```

Look for the free-text resolution record actually in use today —
`Fixed by #{PR_NUMBER}` (optionally followed by `, merged as {SHA}`). This is
**not** the structured `**Fix PR**: {URL}` marker (Fix-PR Marker Convention),
which only appears on issues closed after that convention shipped, so do not
assume it exists on an older issue.

- If a comment names a PR number, use that PR's `merged_at` as the
  resolution instant — not the SHA the comment may also quote:
  ```bash
  gh api -X GET repos/growilabs/growi/pulls/{PR_NUMBER} -q '.merged_at'
  ```
- If no such comment exists and no other PR reference can be found in the
  issue body or comments, the resolution time is unknown — fall through to
  the "genuine recurrence" branch below. Reopening on an unclear resolution
  record is safer than silently treating a real regression as pre-fix noise.

**Step C — decide.**

- **Evidence commit date is *before* the fix's `merged_at`** → pre-fix
  evidence surfacing late, not a new regression, which has happened for real.
  Do **not** reopen and do **not** change any label. Record it as a historical
  note instead, using the ④ backfill comment shape but with the heading that
  marks a live-scan discovery — keep the two headings distinct:
```bash
BODY_FILE="${TMPDIR:-/tmp}/flaky-latescan-body-{NUMBER}.md"

cat > "$BODY_FILE" <<'EOF'
### Backfilled observation (found during a later detect-flaky-ci scan)

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}
- Predates fix: this commit ({COMMIT_DATE}) is earlier than {FIX_PR_URL}'s merge ({MERGED_AT}); not reopened.

```
{log excerpt}
```

_Generated by [Claude Code](https://claude.ai/code)_
EOF

gh api "repos/growilabs/growi/issues/{NUMBER}/comments" -X POST -F body=@"$BODY_FILE"
```
- **Evidence commit date is *at or after* the fix's `merged_at`** (or Step
  B could not determine a resolution time at all) → genuine recurrence
  after a claimed fix. Reopen and escalate straight to `flaky/confirmed`
  (skip `flaky/observing` — a recurrence after a claimed fix is stronger
  evidence than a first-time observation). Reopening also puts the issue back
  at the "new" phase, and **whichever phase label it currently carries has to
  come off** — not `{EXACT_PHASE_RESOLVED_LABEL}` alone, because a closed
  tracking issue can instead hold `{EXACT_PHASE_WONTFIX_LABEL}` from
  `investigate-flaky-test`'s deterministic-cause close
  (`### Closed: deterministic cause, not flaky`). Removing only the resolved
  one would leave the reopened issue reading "we decided not to fix this":

  ```bash
  gh api "repos/growilabs/growi/issues/{NUMBER}" -X PATCH -f state=open

  LABELS_FILE="${TMPDIR:-/tmp}/flaky-reopen-labels-{NUMBER}.json"

  # Drop every phase/* label the issue happens to carry, then add the new-phase
  # one and the confirmed tier. The whole-array PATCH is used instead of
  # `--remove-label` for the reason 6-C of `investigate-flaky-test` gives: phase
  # label names begin with an emoji (`1️⃣`, `5️⃣`, `⏏`), which a DELETE would have
  # to carry percent-encoded in the URL path, while PATCH keeps the name in the
  # JSON body. PATCH replaces the entire set, so compute it from the labels read
  # immediately before it — that is also what preserves the issue's other labels
  # (`type/bug`, and any `flaky/*` already on it).
  gh api "repos/growilabs/growi/issues/{NUMBER}" -q '[.labels[].name]' \
    | jq -c --arg add '{EXACT_PHASE_NEW_LABEL}' \
        '{labels: ((map(select(contains("phase/") | not)) + ["flaky/confirmed", $add]) | unique)}' \
    > "$LABELS_FILE"

  gh api "repos/growilabs/growi/issues/{NUMBER}" -X PATCH --input "$LABELS_FILE"
  ```

  Match on `phase/` as a substring rather than on an exact name: the emoji
  prefix is what drifts, `phase/` is the stable part, and the exact names
  fetched at the top of Step 4 are only needed for the label being *added*.

  Then append the usual `### Additional observation` comment (same shape as
  the OPEN-issue path above) so the reopened issue carries this evidence
  in its normal place.

### Link to the dashboard (all branches)

Whichever branch above you just took — new issue, an existing open issue at
any tier, or a reopened closed issue — end it with the same dashboard-link
attempt described in "Attach the new issue to the dashboard as a
sub-issue", using that issue's own number:

```bash
ISSUE_ID=$(gh api repos/growilabs/growi/issues/{NUMBER} -q '.id')
gh api repos/growilabs/growi/issues/11720/sub_issues -X POST -F sub_issue_id="$ISSUE_ID"
```

This keeps the invariant self-healing: an issue that lost its parent, or was
linked before this rule existed, gets relinked the next time this skill
touches it. The endpoint rejects a duplicate link with a `422` whose message
contains "may only have one parent" — treat that specific response as success
(already linked), not as a failure to log. Any other failure is non-fatal.

A parent issue also has an unpublished cap on how many sub-issues it can hold,
and since nothing ever removes one from #11720 it will eventually be reached.
When it is, the non-fatal handling above means only the dashboard linkage is
affected, not issue creation or tracking.

## Step 5: Report

Print a short summary of this run: which job-log fetch method Step 0 chose
(`gh` or `mcp`), the `--window-hours` covered and how many runs per workflow
fell in it (and whether `--max-runs-per-workflow` truncated that, a later
page's fetch failed after some runs were already read, or Step 1.5's
`fetch-flaky-issues` reported a non-empty `labelFetchFailures` — meaning the
known-issue list itself is missing one tier's rows — report whichever of
these happened explicitly, never silently), how many runs were skipped via
the Step 1.5 skip-list, how many jobs were scanned, how many **failures** were classified
as infra noise and with which pattern (counted per `FAIL` block, per Step 2's
granularity), and how many **whole jobs** were discarded on the
`test/setup/**` exception. Then: how many new issues created, how many
existing issues updated, how many escalated to `flaky/suspected` vs
`flaky/confirmed`, and **a separate hit count for each of the five mining
checks** (①, ②, ③, ⑤, ④'s backfill). One suspected issue can match more than
one check, so these five counts will not sum to the number of suspected
issues; report them separately anyway, since this is the data that answers
"which of these checks is actually pulling weight" over time.

Also report what Step 3's aggregation folded together, so the difference
between "causes" and "failures" stays visible:

- how many `### Collateral candidate` comments were posted, and how many
  tests they list in total (and on which tracking issues)
- how many cascaded failures were folded into an identity rather than filed
  (and for which spec files)
- how many spec files were folded into each shared setup-hook identity
- any shared setup-hook lookup that matched more than one tracking issue
  (setup file and the matching issue numbers, and whether the matches were
  open or closed) — this needs a human to merge them

Then report what never became a tracking issue at all, so that a shrinking
issue count can be told apart from a check that quietly stopped working:

- **excluded as PR-owned failures** — how many identities "Failures the PR
  itself owns" (Step 3) kept out of Step 4, each with the PR number(s) whose
  files matched the failing spec, or the head branch name when the commit had
  no PR. One exclusion can name more than one PR, so these numbers do not line
  up one-to-one with the count.
- **① suppressed by a lockfile match** — how many failures had ① stopped
  because a package in the PR's `pnpm-lock.yaml` patch also appeared in the
  failure's stack trace, and which packages. These were *not* excluded (they
  went through Step 4 like any other), so report them separately.
- any identity whose PR-owned check could not be completed because the
  compare or PR fetch failed (fail-open, so it was tracked anyway)

This is the only user-facing output — do not create files.

## Error Handling

- A GraphQL/proxy error (e.g. "This GraphQL query is not enabled for this
  session") means a `gh issue`/`gh label`/`gh pr` subcommand was used
  somewhere it should not have been (`flaky-ci-routine.md` → Shared
  constants → Reading conventions). Rewrite that one call in the REST form
  the Step 3 and Step 4 templates already use and continue; this is an
  environment constraint, not a reason to stop the run.
- `gh api` rate limit hit: report how far the scan got and stop; do not retry
  in a tight loop.
- `parse-job-log.ts` exits `2` (stdin was empty or unreadable) for a job's
  log: this job's evidence could not be measured, not "no failures" — report
  it in Step 5 alongside any other script failure, and move on to the next
  job rather than guessing at its content from the run/job metadata alone.
  A job log this large no longer risks overflowing the model's own context,
  since the script reads it directly from a file and only its JSON output
  (never the raw log) reaches this procedure.
- Ambiguous identity (test title changed between occurrences of the same
  underlying flake): do not attempt fuzzy matching — treat as a new issue.
  A missed dedupe is cheap; wrongly merging two different flakes is not.
- Job log content unreachable via either method (`gh api
  .../actions/jobs/{JOB_ID}/logs` returns Forbidden, or
  `mcp__github__get_job_logs` is not among your available tools): the Step 0
  probe in `flaky-ci-routine.md` picked wrong, or this skill is running
  standalone with neither path available. Report which jobs could not be
  evidenced and continue with what you can read (run/job metadata,
  conclusions); do not silently skip affected runs.
- Cheap suspicion mining (① / ② / ③ / ④ / ⑤) finds no clean signal either way
  (e.g. a PR touches half the repo, or matrix siblings are also failing for
  unrelated reasons): do not force a tier — fall through to `flaky/observing`
  and let the passive threshold path handle it. These checks are a fast lane,
  not a required gate.
- `--max-runs-per-workflow` is hit before the `--window-hours` boundary is
  reached: CI volume for that workflow exceeded what the window was sized
  for. Report it explicitly in Step 5 (which workflow, how many runs were
  skipped) — never process a truncated set as if it were the full window. If
  it happens repeatedly, raise `--max-runs-per-workflow` or shorten the cron
  interval rather than routing around it inside a single run.
