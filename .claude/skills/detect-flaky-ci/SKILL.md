---
name: detect-flaky-ci
description: Scan recent GROWI CI runs for flaky (non-deterministic) job/test failures and track them as GitHub issues. Detection only — never modifies source code. Usage - /detect-flaky-ci [--window-hours=N] [--vitest-threshold=N]
allowed-tools: Bash, Read, Grep
argument-hint: "[--window-hours=16] [--vitest-threshold=2]"
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
  created in the last N hours, rather than a fixed run count. Default `16`
  (twice this routine's 8-hour cron cadence — see "Why a time window, not a
  run count" below). Pass this explicitly when invoking standalone outside
  `/flaky-ci-routine`'s cron cadence.
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
failures on any day where the watched workflow runs more than 30 times —
those failures scroll out of the scanned range and are never seen at all,
with no error or warning. A time window sized to the routine's own cron
cadence closes this gap without needing any persisted state between runs
(consistent with this skill's "no memory between runs" design — see
Overview): as long as the window is at least **twice** the cron interval,
one entirely skipped cron fire (cloud environment failure, etc.) still gets
fully covered by the next successful one. `/flaky-ci-routine` runs every 8
hours, hence the default of 16.

This does mean a run created 15 hours ago gets scanned by up to two
consecutive routine runs (deliberate overlap for safety) — Step 4's
existing-issue reconciliation (backed by the Step 1.5 skip-list below)
already treats a previously-seen run as a no-op, so the second pass costs
a metadata check, not a re-read of that run's job logs.

## Three Confidence Tiers

Detection now produces one of three outcomes per candidate, cheapest evidence
first:

1. **`flaky/observing`** — a single vitest observation with no corroborating
   signal (see "Cheap Suspicion Mining" below). Passive: waits for a future
   run to repeat it (`--vitest-threshold`).
2. **`flaky/suspected`** — a vitest observation that also matches one or more
   of the four cheap, mechanical signals in "Cheap Suspicion Mining" (diff/PR
   mismatch, sandwich pattern, matrix divergence, or a targeted historical
   backfill hit). No LLM judgment is spent getting here — these are
   grep/diff-level checks against data this skill already fetched (or, for
   ④, a small bounded amount of extra targeted fetching). Handed to
   `investigate-flaky-test`, which spends exactly one rerun to turn this
   into empirical proof.
3. **`flaky/confirmed`** — either a Playwright in-run retry (unchanged from
   before: the retry already IS the empirical proof, no further rerun
   needed), or a `flaky/suspected` issue that `investigate-flaky-test`
   reran once with no code change and watched pass.

`detect-flaky-ci` only ever assigns tiers 1 and 3 (3 for Playwright only,
unchanged). Tier 2 is new. `investigate-flaky-test` is the only skill that
promotes tier 2 → tier 3 for vitest, because that promotion requires an
actual rerun, which is an investigation action, not a detection action.

## Cheap Suspicion Mining (vitest only)

Before falling back to passive `--vitest-threshold` accumulation, check each
vitest failure identity against four mechanical signals. All four are
grep/diff/API-field comparisons — no log-content reasoning beyond a literal
string search, no code reading. ①-③ run against a **fresh** observation
made during this scan; ④ runs once per scan against **existing**
`flaky/observing` issues regardless of whether anything new was observed
for them today (see its own subsection below for why it's structured
differently).

**Evaluate all of ①-③ for every fresh observation — do not stop at the
first hit.** All three reuse data already fetched in Steps 1-2 (no extra API
calls), so short-circuiting saves nothing. It also actively loses
information: ① (diff/PR mismatch) is the loosest of the three — it only
needs "the PR/commit diff doesn't touch this area" — so it tends to match
almost any isolated failure before ② or ③ get evaluated. Stopping at ①
means never learning whether the same failure also had a same-commit
matrix-divergence proof (③, arguably the strongest of the three — it's a
same-commit, same-code comparison, not an inference from an unrelated
diff) or a sandwich pattern (②). Left unrecorded, this makes ②/③ look like
they never fire in practice, when in fact they may be firing constantly
underneath ①'s wider net — record every check that matches, not just the
first:

- **Record every match.** Note in this run's evidence which of ①/②/③ hit,
  even when more than one did.
- **Report all matched checks in the issue**, not just one (see the issue
  body template below) — a reader deciding how much to trust "suspected"
  should see every corroborating signal, not whichever happened to be
  checked first.
- **When space forces picking a single headline reason** (e.g. a short
  status line), prefer the strongest evidence, not check order: ③ (same
  commit, same code, divergent outcome) > ② (disappears-and-reappears
  within the window) > ① (diff/PR mismatch, an inference rather than a
  direct comparison).

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

**② Sandwich pattern.** Within the `--window-hours` window already fetched
in Step 1, look for the same vitest identity key failing in two (or more) runs
with a run of the *same job* in between that succeeded. A failure that
disappears and reappears with an identical signature is stronger evidence of
non-determinism than two failures with nothing but other failures between
them (which looks more like an unfixed, ongoing regression). This does not
require a new API call — it's a re-read of the Step 1 run list plus the
Step 2 job results you already have from previous scans (this run's and, if
available, prior observation comments on an existing `flaky/observing`
issue, which already record run URLs/dates).

**③ Matrix divergence.** `ci-app-test-integration` runs a
node/MongoDB-version matrix (see any recent job name, e.g.
`ci-app-test-integration (24.x, 8.0, 8, 8.19.16)`). If the same commit's
other matrix cells for the same job **passed** while this one failed, that
is a same-commit, zero-wait signal — no need to wait for a future run at
all. Get sibling job results from the Step 2 jobs-list call you already made
for this run (`gh api repos/growilabs/growi/actions/runs/{RUN_ID}/jobs`) —
filter by job name prefix, compare conclusions.

If none of ①-③ hit for a fresh observation, fall through to the existing
passive `flaky/observing` / `--vitest-threshold` path unchanged.

**④ Targeted historical backfill (existing `flaky/observing` issues only).**
①-③ only look at data already in hand for *today's* observation. This one
runs the other direction: for each currently-OPEN `flaky/observing` issue
(you already fetch this list for Step 4's reconciliation — reuse it, do not
re-fetch), actively search further back than this scan's `--window-hours`
for an *earlier* occurrence of that same identity that was never recorded,
rather than passively waiting for a fresh one to show up in some future
scan. This is what closes the gap described in "Why a Time Window, Not a
Run Count" for the specific handful of tests that are already flagged as
interesting — it does not apply to fresh, never-before-seen failures (that
would mean deep-searching on every failure, which is the expensive,
rejected alternative to the time-window approach).

Bounded cost: this only runs per already-`flaky/observing` issue (typically
a handful at most), and only fetches logs for **failed** runs of the one
relevant workflow (vitest identities only ever come from `ci-app.yml`), not
every run in the deeper range:

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
for this identity's exact `FAIL {SPEC_PATH} > ... > {TEST_TITLE}` block. A
match is a genuine backfilled observation this issue never had:

```bash
gh issue comment {NUMBER} --repo growilabs/growi --body "$(cat <<'EOF'
### Backfilled observation (found during targeted historical search)

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}

```
{log excerpt}
```
EOF
)"
gh issue edit {NUMBER} --repo growilabs/growi --remove-label "flaky/observing" --add-label "flaky/suspected"
```

A backfill hit always escalates straight to `flaky/suspected` (never
`flaky/confirmed`) regardless of how many backfilled occurrences are
found — it is still mechanical suspicion, not an empirical rerun; the same
promotion rule as ①-③ applies. If the deeper search finds nothing, leave
the issue at `flaky/observing` and move on; this is not a required gate, it
is a best-effort extra pass.

Genuinely subtle flakiness that doesn't show up in any of ①-④ still needs
the old accumulation path (or a human/LLM eyeballing it later) — none of
these checks are exhaustive.

## Why vitest and Playwright are handled differently

- **Playwright** runs with `retries: 2` in CI (`apps/app/playwright.config.ts`).
  When a test fails and then passes on retry within the *same* job run, the
  job log prints an unambiguous `N flaky` summary line and `Retry #N` blocks
  for that spec. This is direct, single-run proof of non-determinism — no
  accumulation needed.
- **vitest** (`ci-app-test`, `ci-app-test-integration`) has no retry mechanism.
  A single failure is indistinguishable from a real regression. The only
  cheap, reliable signal is the same test failing across multiple *unrelated*
  runs while the surrounding suite is otherwise green — which requires
  accumulating observations over time via `--vitest-threshold`.

  The gold-standard signal — the same commit SHA re-run failing then passing
  (`run_attempt` N vs N+1) — does happen in this repo (confirmed via
  `repos/{owner}/{repo}/actions/runs?per_page=100`, look for `run_attempt > 1`)
  but is rare (manual reruns only) and cannot be the primary mechanism. When
  you do find a same-SHA attempt flip during a scan, treat it exactly like a
  Playwright signal — escalate immediately, no accumulation required.

## Step 1: List Candidate Runs

Watched workflows (by their GitHub Actions display name, not the file name):

- `Node CI for app development` — hosts `ci-app-test`, `ci-app-test-integration`
- `Node CI for app production` — hosts `run-playwright` (via the reusable
  `Reusable build and test app for production` workflow)

Query **each workflow separately** — do not pull the unfiltered
`actions/runs` list and filter client-side, the repo runs several other
workflows (CodeQL, Auto-labeling, Auto approve PR, ...) and a generic
window of recent runs across all of them can leave zero, or only a
handful, of the two workflows actually being watched.

**Use `gh api` against the workflow's own runs endpoint, not
`gh run list --json`.** `gh run list --json` validates the requested fields
against a fixed, gh-CLI-version-specific struct — this repo's cloud routine
runs gh 2.45.0, which does not know the `attempt` field
(`Unknown JSON field: "attempt"`) and fails the whole command outright, not
just that field. `gh api` has no such client-side field allowlist — it is a
thin passthrough to GitHub's REST response, which already includes
`run_attempt` (among everything else) regardless of gh CLI version.

**Page until you cross `--window-hours`, not a fixed count** (see "Why a
Time Window, Not a Run Count" above). `per_page=100`, walk pages newest
first, stop once a page's oldest run falls before the cutoff, and stop
early (report why) if `--max-runs-per-workflow` is hit first:

```bash
WINDOW_HOURS={window-hours, default 16}
MAX_RUNS={max-runs-per-workflow, default 300}
CUTOFF_EPOCH=$(( $(date -u +%s) - WINDOW_HOURS * 3600 ))

for WORKFLOW in ci-app.yml ci-app-prod.yml; do
  : > "/tmp/${WORKFLOW}-runs.jsonl"
  page=1
  total=0
  while :; do
    resp=$(gh api -X GET "repos/growilabs/growi/actions/workflows/${WORKFLOW}/runs" \
      -f status=completed -F per_page=100 -F "page=${page}")
    count=$(echo "$resp" | jq '.workflow_runs | length')
    [ "$count" -eq 0 ] && break
    echo "$resp" | jq -c '.workflow_runs[] | {databaseId: .id, conclusion, headSha: .head_sha, createdAt: .created_at, url: .html_url, event, attempt: .run_attempt}' \
      >> "/tmp/${WORKFLOW}-runs.jsonl"
    total=$((total + count))
    oldest_epoch=$(echo "$resp" | jq -r '.workflow_runs[-1].created_at' | date -u -f - +%s 2>/dev/null || date -u -d "$(echo "$resp" | jq -r '.workflow_runs[-1].created_at')" +%s)
    if [ "$oldest_epoch" -lt "$CUTOFF_EPOCH" ]; then break; fi
    if [ "$total" -ge "$MAX_RUNS" ]; then
      echo "TRUNCATED: ${WORKFLOW} hit --max-runs-per-workflow=${MAX_RUNS} before reaching the ${WINDOW_HOURS}h window boundary — report this explicitly in Step 5" >&2
      break
    fi
    page=$((page + 1))
  done
done
```

(`ci-app.yml` = "Node CI for app development", `ci-app-prod.yml` = "Node CI
for app production" — confirm with
`gh api repos/growilabs/growi/actions/workflows -q '.workflows[] | {name,path}'`
if these file names ever change. Adapt the date-parsing line to whatever
`date` implementation the runtime actually has; the point is "epoch seconds
of the oldest run's `created_at` in this page", however you get there.)

This naturally includes pull_request and merge-queue-triggered runs (the
merge queue is where today's investigation actually surfaced a failure — a
scan that only looked at "PR checks" would have missed it).

While you have this data, check for same-SHA reruns: group by `headSha`
within each workflow's result set and look for a `headSha` that appears more
than once with `attempt > 1` on the later one. If an earlier attempt for
that `headSha` failed and a later attempt succeeded, every job that flipped
between those two attempts is a confirmed flaky occurrence (see Step 3,
"confirmed" path) — skip Step 2 classification for it, a same-SHA pass/fail
flip has no infra-vs-product ambiguity to resolve. This is rare (confirmed
via manual inspection: 2 occurrences in the most recent 100 runs across the
whole repo) so do not spend excessive time hunting for it — a quick group-by
over the JSON you already fetched is enough; skip it under time pressure.

Keep only runs with `conclusion == "failure"` for the main Step 2 flow.

## Step 1.5: Known-Run Skip List

Fetch the existing flaky issues now (Step 4 needs this list anyway — do it
here instead so it's available before the expensive part of Step 2):

```bash
gh api -X GET repos/growilabs/growi/issues -f state=all -f labels="flaky/observing" --paginate -q '.[] | {number,title,state,body}'
gh api -X GET repos/growilabs/growi/issues -f state=all -f labels="flaky/suspected" --paginate -q '.[] | {number,title,state,body}'
gh api -X GET repos/growilabs/growi/issues -f state=all -f labels="flaky/confirmed" --paginate -q '.[] | {number,title,state,body}'
```

For each, also fetch its comments (`gh api repos/growilabs/growi/issues/{NUMBER}/comments --paginate`)
and extract every `actions/runs/{id}` URL appearing anywhere in the body or
comments into one set — this is the skip-list. In Step 2, if a failed run's
`RUN_ID` is already in this set, **do not re-fetch its job log at all** —
its evidence is already recorded on some issue, and nothing further needs
to happen for that run; just exclude it from Step 2 onward. This is what
keeps a shorter, more frequent cron cadence cheap: without this, every run
gets its full job log re-fetched by however many consecutive routine runs
its `--window-hours` overlap spans. (④'s deeper backfill search does its
own equivalent check per-issue, independently — the two skip-lists serve
different loops and aren't the same set.)

**Run ④'s targeted backfill now**, filtering this same issue list down to
open `flaky/observing` ones — see "Cheap Suspicion Mining" ④ above for the
procedure. It's independent of whatever Step 2-4 finds for fresh failures
in this scan's window, so there's no ordering dependency on doing it here
versus at the end; doing it now means it's out of the way before the
(usually larger) fresh-candidate loop below.

## Step 2: Fetch Failed Jobs and Classify Noise

`{RUN_ID}` below is the `databaseId` from Step 1. **Skip any `{RUN_ID}`
already in Step 1.5's skip-list before doing anything else in this step** —
its evidence is already recorded, so there is nothing new to extract from
it.

For each remaining failed run, list its jobs and keep the ones with
`conclusion == "failure"` (skip `cancelled` — those are pre-emptions by a
newer push, not evidence of anything):

```bash
gh api repos/growilabs/growi/actions/runs/{RUN_ID}/jobs -q '.jobs[] | select(.conclusion == "failure") | {id, name}'
```

Fetch each failed job's log using **whichever method Step 0 of
`flaky-ci-routine.md` decided for this run** (see that command's "Job Log
Fetch Method" probe — it is decided once, at the very start of the routine,
not re-decided per log). If invoked standalone (not via `/flaky-ci-routine`),
do that same one-time probe yourself before this step: check whether
`mcp__github__get_job_logs` appears in your available tools; if so, use it
for every job log fetch below; if not, use `gh run view --log-failed`. Do
not try one and fall back to the other per log — that produces
run-to-run-inconsistent behavior for no benefit, since the capability is a
property of the environment, not of any individual log fetch.

```bash
# gh path (devcontainer / any environment where the egress proxy allows
# results-receiver.actions.githubusercontent.com and *.blob.core.windows.net)
gh run view {RUN_ID} --repo growilabs/growi --job {JOB_ID} --log-failed
```

```
# MCP path (cloud routine — the blob-storage redirect above is Forbidden
# through this environment's egress proxy; the MCP tool fetches server-side
# instead)
mcp__github__get_job_logs(owner="growilabs", repo="growi", job_id={JOB_ID}, failed_only=true)
```

### Step 2b: also check successful `run-playwright` jobs for in-run flakes

A shard where a test failed and then passed on retry ends the *job* as
`success` — Playwright's own retries absorbed it before the job's exit code
was decided. The failed-job scan above never sees these, so it misses most
of Playwright's actual "free" flaky signal (the one case caught in this
skill's initial design review only surfaced because a *different* test in
the same shard genuinely failed). To catch these, additionally scan
successful `run-playwright` jobs from runs in the Step 1 list (any
conclusion, not just failed runs), grepping rather than reading the full log
to keep this cheap:

```bash
# gh path
gh run view {RUN_ID} --repo growilabs/growi --job {JOB_ID} --log \
  | grep -iE "flaky|Retry #|^:*error file="

# MCP path — fetch then grep the returned text the same way
mcp__github__get_job_logs(owner="growilabs", repo="growi", job_id={JOB_ID}, failed_only=false)
```

Use the same Step-0-decided method as the failed-job fetch above.

If this is empty, the shard had no flakiness — move on. If it has a
` flaky` count > 0, proceed to Step 3's Playwright extraction using this
grepped excerpt (it is sufficient; do not re-fetch the full log).

**Classify infrastructure noise first — do not track these as flaky.** Match
the log against this denylist (case-insensitive substring match). If any
pattern matches, log it in this run's report as "infra noise, skipped" and
move to the next job. This list is deliberately small and additive — extend
it when a genuine false positive is found, don't broaden matches speculatively:

- `ECONNREFUSED`
- `getaddrinfo ENOTFOUND`
- `No space left on device`
- `SIGKILL` / `exit code 137` (OOM-killed)
- `runner has received a shutdown signal` / `lost communication with the server`
- `docker: Error response from daemon`
- generic `curl` retry exhaustion (`--retry 60` blocks timing out, seen in
  `ci-app.yml` / `reusable-app-prod.yml` service-wait steps)

Everything that doesn't match is a candidate for Step 3.

## Step 3: Extract Test Identity and Evidence

### Playwright jobs (`run-playwright ...`)

Job names carry a shard number and MongoDB version that are **not stable
identity** — the same spec lands on a different shard number across runs
(sharding is just parallelization, reassigned each run), so including it in
the identity key would fragment one flaky spec into many never-deduped
issues. The browser (`chromium`/`firefox`/`webkit`) IS meaningful — the same
spec can be flaky in one engine and not another. Extract it from the job
name, e.g. `run-playwright (firefox, 1/2, 8.0)` → browser = `firefox`.

The reliable, structured signal is the trailing summary line (`N failed`,
`N flaky`, `N passed`) and the `::error file=...,title=...` annotations for
genuinely-failed specs. **Attributing a specific `flaky` count to a specific
spec name from the raw log is not reliable** — the CI reporter's console
output interleaves per-step Playwright debug traces (`pw:api ...`) with
retry/attachment lines in a way that does not cleanly pair a `Retry #N`
block with the spec it belongs to. Do not try to build a precise
adjacency/pairing heuristic here; it will misattribute. Use a two-tier
approach instead:

1. **Precise identity** — only when unambiguous: if the log's `::error`
   annotations account for exactly `N failed` and there is exactly one
   distinct spec/title referenced anywhere in retry-attachment paths
   (`playwright/output/{slug}.../test-failed-N.png`) that is **not** among
   the `::error`-annotated titles, that leftover slug is the flaky one —
   use `playwright:{BROWSER}:{SPEC_PATH}:{TEST_TITLE}` (recover the human
   title from the slug by matching it against spec files under
   `apps/app/playwright/` if needed). Always include `{BROWSER}`, per the
   "browser IS meaningful" rule above — every tracking issue this skill has
   created for a specific spec already carries it (e.g. #11785 is
   `playwright:webkit:playwright/20-basic-features/comments.spec.ts:...`);
   omitting it here would fork the identity key from the title format Step
   4 actually searches on, which is exactly the "title/search mismatch →
   duplicate" failure that section warns about.
2. **Fallback (job-level)** — in every other case (multiple candidates,
   nothing unambiguous), use `playwright:{BROWSER}` as the identity and say
   so explicitly in the issue body: "flaky test detected in this shard's log
   (see excerpt below) but the specific spec could not be isolated from the
   log alone — see the linked run for the full report." This is intentional:
   a coarser but honest identity beats a fabricated precise one.

Either tier counts as a **confirmed** occurrence (see Step 4) — Playwright
already retried in-run and still needed a retry to pass, regardless of
whether this skill can name the exact spec.

### Vitest jobs (`ci-app-test`, `ci-app-test-integration`)

Search the log for Vitest's failure block format (seen directly in this
repo's CI output):

```
FAIL {app-integration|...} {SPEC_PATH} > {SUITE} > {TEST_TITLE}
{ErrorType}: {message}
```

Identity key: `vitest:{SPEC_PATH}:{TEST_TITLE}`.

This is an **observation**, not a confirmation. Before proceeding to Step 4,
run it through "Cheap Suspicion Mining" above — a hit there makes this a
**suspected** occurrence (tier 2) instead of a plain observation (tier 1).
Either way, proceed to Step 4.

## Step 4: Reconcile Against Existing Issues

**The issue title IS the identity key, verbatim** — this is deliberate: it
guarantees the search below can never drift out of sync with what was
written at creation time. Do not use a separately-worded human-friendly
title with the identity key tucked into the body; a title/search mismatch
there means every scan sees "no existing issue" and creates a duplicate.

Title format (fixed):
`flaky: {IDENTITY_KEY}`

e.g. `flaky: vitest:src/features/external-user-group/server/service/external-user-group-sync.integ.ts:syncs groups and deletes groups that do not exist externally`
or `flaky: playwright:firefox` (job-level fallback identity).

**Use `gh api` (REST), not `gh issue list --json` / `--search`.** This
skill is expected to also run from a cloud routine whose `gh` session sits
behind an egress proxy that blocks `gh`'s GraphQL-backed commands — in
practice, every `gh` subcommand that accepts `--json` on issues/labels/PRs
(confirmed: `gh issue list --json`, `gh label list --json`) — while plain
REST calls (`gh api repos/{owner}/{repo}/...`) go through. GitHub's
Actions API (used in Steps 1–2 above) has no GraphQL equivalent at all, so
`gh run ...` commands are unaffected regardless of `--json`; this
restriction is specific to Issues/Labels/PRs commands.

You already fetched every issue carrying a flaky label (both states) in
Step 1.5 — reuse that list here rather than re-querying it; look for an
exact title match client-side, which is also more precise than GitHub's
fuzzy search tokenization would have been. (**Always pass `-X GET`
explicitly whenever `-f`/`-F` is used for a read** — `gh api` defaults to
`POST` the moment any `-f`/`-F` flag is present, even for an endpoint
that's semantically a read; confirmed live, the Step 1.5 queries without
`-X GET` fail with `422 ... "title" wasn't supplied", routed to the
issue-*creation* endpoint's validator.)

Treat an issue as the same tracking issue only if its `title` is **exactly**
`flaky: {IDENTITY_KEY}` — do not fuzzy-match.

### No existing issue found

Create one. Fetch exact label names first (names carry emoji prefixes and
drift — never hardcode), via REST rather than `gh label list --json`:

```bash
gh api repos/growilabs/growi/labels --paginate -q '.[].name'
```

```bash
gh issue create --repo growilabs/growi \
  --title "flaky: {IDENTITY_KEY}" \
  --label "type/bug" --label "{EXACT_PHASE_NEW_LABEL}" \
  --label "{TIER_LABEL}" \
  --body "$(cat <<'EOF'
## Detected by detect-flaky-ci

**Identity key**: `{IDENTITY_KEY}`
**Kind**: {playwright | vitest} {(strong evidence: passed on in-run retry) if confirmed} {(cheap suspicion: {every matched check among ① diff/PR mismatch, ② sandwich pattern, ③ matrix divergence, joined with " + ", e.g. "① + ③"}) if suspected}

### First observation

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}

### Evidence

```
{relevant log excerpt — the FAIL block or the ::error annotation + retry blocks}
```

{if suspected, include the specific mining evidence **for every check that matched, not just one** — one line per match, e.g.:
"① PR #{N} changed {files}, none overlap this spec's path or stack trace"
"② same identity failed in run {A}, passed in intervening run {B}, failed again here"
"③ sibling matrix job {NAME} on the same commit passed"
List whichever subset actually matched; omit lines for checks that didn't hit.}

### Status

{pick exactly one:
 - confirmed (Playwright): "Confirmed flaky from a single run (Playwright retry evidence)."
 - suspected (vitest, mining hit): "Suspected flaky ({every matched check, e.g. "① + ③", ordered strongest-first: ③ > ② > ①}) — handed directly to investigate-flaky-test for a one-time confirmation rerun, no threshold wait needed."
 - observing (vitest, no mining hit): "Observation 1/{VITEST_THRESHOLD} — needs {VITEST_THRESHOLD - 1} more independent occurrence(s) before this is handed to investigate-flaky-test."}
EOF
)"
```

`{TIER_LABEL}` is `flaky/confirmed` for Playwright, `flaky/suspected` for a
vitest observation that hit one of the three mining checks, `flaky/observing`
for a plain vitest observation with no mining hit.

### Attach the new issue to the dashboard as a sub-issue

Every issue this skill creates must become a GitHub sub-issue of the
tracking dashboard, growilabs/growi#11720 ("flaky-ci-routine: dashboard").
Being a sub-issue does **not** hide an issue from the default Issues list —
GitHub still lists it there. What it buys instead: anyone who wants the
non-flaky backlog without this noise can search
`is:issue is:open no:parent-issue` (verified — this qualifier excludes
every issue that has a parent), and the dashboard's own
`sub_issues_summary` (`total`/`completed`/`percent_completed`) gives a
progress rollup instead of the manual count kept in its body table today.

Use the REST sub-issues endpoint, not the GraphQL `addSubIssue` mutation —
this is the same reasoning as the REST-over-GraphQL rule earlier in Step 4:
the cloud routine's `gh` session sits behind an egress proxy that blocks
GraphQL-backed commands, and REST works in both environments.

Parse `{NEW_NUMBER}` from the URL `gh issue create` printed to stdout, then:

```bash
NEW_ISSUE_ID=$(gh api repos/growilabs/growi/issues/{NEW_NUMBER} -q '.id')
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
gh issue comment {NUMBER} --repo growilabs/growi --body "$(cat <<'EOF'
### Additional observation

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}

```
{log excerpt}
```
EOF
)"
```

Then check both escalation paths, in this order:

1. **Does this new observation hit any mining check** (evaluate all of
   ① / ② / ③ — re-run against the accumulated history now that there are 2+
   occurrences to compare; do not stop at the first hit, same as the fresh-
   observation path above)? If so, escalate straight to `flaky/suspected`,
   skipping the threshold wait entirely, and record every check that
   matched in the observation comment:
   ```bash
   gh issue edit {NUMBER} --repo growilabs/growi --remove-label "flaky/observing" --add-label "flaky/suspected"
   ```
2. Otherwise, count observation comments (initial issue body counts as
   observation 1) plus this new one. If the count reaches
   `--vitest-threshold`, escalate the old way — straight to
   `flaky/confirmed` (unchanged: two independent naturally-occurring
   observations without any mining hit is already the passive path's own
   confidence bar, no extra rerun gate added on top of it):
   ```bash
   gh issue edit {NUMBER} --repo growilabs/growi --remove-label "flaky/observing" --add-label "flaky/confirmed"
   ```

### Existing OPEN issue found, currently `flaky/suspected`

Still append the observation comment (useful evidence for
`investigate-flaky-test`'s confirmation rerun), but do not change labels —
it is already queued for investigation.

### Existing OPEN issue found, already `flaky/confirmed`

Still append the observation comment (useful evidence for
`investigate-flaky-test`), but do not change labels — it is already queued
for investigation or being investigated.

### Existing CLOSED issue found

New evidence against an identity whose tracking issue is already closed can
mean two different things, and they call for opposite actions: a genuine
regression that happened **after** the fix landed (reopen), or a failure
that actually happened **before** the fix landed and only surfaced now
because this scan's window/backfill reached far enough back to find it
(do not reopen — it's a historical record, not a new occurrence). Do not
reopen on title match alone — first determine which case this is by
comparing two timestamps.

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
`Fixed by #{PR_NUMBER}` (optionally followed by `, merged as {SHA}`), as
seen on #11711. This is **not** the structured `**Fix PR**: {URL}` marker
(Fix-PR Marker Convention) — that marker only appears on issues closed
after that convention shipped, so do not assume it exists on an issue this
old.

- If a comment names a PR number, fetch that PR's own merge time — use the
  PR's `merged_at`, not the SHA the comment may also quote, since
  `merged_at` is the authoritative resolution instant regardless of what
  the comment text happened to record:
  ```bash
  gh api -X GET repos/growilabs/growi/pulls/{PR_NUMBER} -q '.merged_at'
  ```
- If no such comment exists (an issue closed before even the free-text
  convention was adopted) and no other PR reference can be found in the
  issue body/comments either, the resolution time is unknown — fall
  through to the "genuine recurrence" branch below. Reopening on an
  unclear resolution record is safer than silently treating a real
  regression as pre-fix noise.

**Step C — decide.**

- **Evidence commit date is *before* the fix's `merged_at`** → this is the
  #11711 situation: pre-fix evidence surfacing late, not a new regression.
  Do **not** reopen and do **not** change any label. Record the evidence as
  a historical note instead, using the same comment shape as the ④
  backfill check above but with a heading that marks this as a live-scan
  discovery rather than a targeted historical search (keep the two
  headings distinct — they mark different discovery contexts):
```bash
gh issue comment {NUMBER} --repo growilabs/growi --body "$(cat <<'EOF'
### Backfilled observation (found during a later detect-flaky-ci scan)

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}
- Predates fix: this commit ({COMMIT_DATE}) is earlier than {FIX_PR_URL}'s merge ({MERGED_AT}); not reopened.

```
{log excerpt}
```
EOF
)"
```
- **Evidence commit date is *at or after* the fix's `merged_at`** (or Step
  B could not determine a resolution time at all) → genuine recurrence
  after a claimed fix. Reopen and escalate straight to `flaky/confirmed`
  (skip `flaky/observing` — a recurrence after a claimed fix is stronger
  evidence than a first-time observation), the same as before:
  ```bash
  gh issue reopen {NUMBER} --repo growilabs/growi
  gh issue edit {NUMBER} --repo growilabs/growi --add-label "flaky/confirmed" --remove-label "{EXACT_PHASE_RESOLVED_LABEL}" --add-label "{EXACT_PHASE_NEW_LABEL}"
  ```
  and append the usual `### Additional observation` comment (same shape as
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

This keeps the invariant self-healing: an issue that somehow lost its
parent (or was linked before this rule existed) gets relinked the next
time this skill touches it, with no separate backfill ever needed again.
The endpoint rejects a duplicate link with a `422` whose message contains
"may only have one parent" — treat that specific response as success
(already linked), not as a failure to log. Any other failure is non-fatal
(see Error Handling below).

A parent issue also has a cap on how many sub-issues it can hold (GitHub
does not publish an exact number in its docs; verify empirically if this
is ever suspected to be the cause of a link failure). Since this skill only
adds sub-issues and nothing ever removes one from #11720, that cap will
eventually be reached — when it is, the link attempt above fails and,
per the non-fatal handling already in place, issue creation/tracking
continues exactly as before; only the dashboard linkage is affected.

## Step 5: Report

Print a short summary of this run: which job-log fetch method Step 0 chose
(`gh` or `mcp`), the `--window-hours` covered and how many runs per
workflow fell in it (and whether `--max-runs-per-workflow` truncated that —
report this explicitly, never silently), how many runs were skipped via the
Step 1.5 skip-list (already-known, not re-fetched), how many jobs actually
scanned, how many classified as infra noise (with which pattern), how many
new issues created, how many existing issues updated, how many escalated to
`flaky/suspected` vs `flaky/confirmed`, and **a separate hit count for each
of the four mining checks** (①, ②, ③, ④'s backfill) — since all of ①-③ are
now evaluated for every observation rather than stopping at the first hit,
one suspected issue can match more than one check, so these four counts
will not sum to the total number of suspected issues. Report them
separately anyway; this is the data that answers "which of these checks is
actually pulling weight" over time. This is the only user-facing output —
do not create files.

## Error Handling

- Any `gh issue`/`gh label`/`gh pr` command fails with a GraphQL/proxy error
  (e.g. "This GraphQL query is not enabled for this session"): switch that
  specific call to its `gh api` REST equivalent (`-X POST`/`-X PATCH` for
  mutations, e.g. `gh api repos/growilabs/growi/issues -X POST -f title=... -f body=...`
  in place of `gh issue create`) and continue — this is an environment
  constraint, not a reason to stop the whole run.
- `gh api` rate limit hit: report how far the scan got and stop; do not retry
  in a tight loop.
- A job log too large to fit in context: use `--log-failed` (already filters
  to failed steps) rather than `--log`; if still too large, grep for `FAIL `,
  `::error`, and ` flaky` lines only instead of reading the full log.
- Ambiguous identity (test title changed between occurrences of the same
  underlying flake): do not attempt fuzzy matching — treat as a new issue.
  False negatives here (a missed dedupe) are cheap; false positives (wrongly
  merging two different flakes) are not.
- Job log content unreachable via either method (`gh run view --log*`
  returns Forbidden, or `mcp__github__get_job_logs` is not among your
  available tools): this is the known blob-storage-redirect restriction
  (see the Job Log Fetch Method note in Steps 2/2b) — it means the Step 0
  probe in `flaky-ci-routine.md` picked wrong, or this skill is running
  standalone in an environment with neither path available. Report which
  jobs could not be evidenced and continue with what you can read (run/job
  metadata, conclusions) rather than stopping the whole scan; do not
  silently skip affected runs without reporting them in Step 5.
- Cheap suspicion mining (① / ② / ③ / ④) finds no clean signal either way
  (e.g. a PR touches half the repo, or matrix siblings are also failing for
  unrelated reasons): do not force a tier — fall through to
  `flaky/observing` and let the passive threshold path handle it. These
  checks are a fast lane, not a required gate.
- `--max-runs-per-workflow` is hit before the `--window-hours` boundary is
  reached: this means CI volume for that workflow exceeded what the window
  was sized for. Report it explicitly in Step 5 (which workflow, how many
  runs were skipped as a result) — do not silently process a truncated set
  as if it were the full window. If this happens repeatedly, it's a signal
  to raise `--max-runs-per-workflow` or shorten the cron interval (which
  shrinks `--window-hours` too, since it's derived from it), not something
  to route around inside a single run.
