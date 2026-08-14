---
name: detect-flaky-ci
description: Scan recent GROWI CI runs for flaky (non-deterministic) job/test failures and track them as GitHub issues. Detection only — never modifies source code. Usage - /detect-flaky-ci [--lookback=N] [--vitest-threshold=N]
allowed-tools: Bash, Read, Grep
argument-hint: "[--lookback=30] [--vitest-threshold=2]"
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
- `--lookback=N` — how many most-recent completed runs of each watched
  workflow to scan. Default `30`.
- `--vitest-threshold=N` — number of separate-run observations of the same
  vitest test failure required before escalating from `flaky/observing` to
  `flaky/confirmed`. Default `2`. (Playwright-detected flakiness always
  escalates on the first observation — see Step 3.)

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

Query **each workflow separately** with `gh run list --workflow` — do not
pull the unfiltered `actions/runs` list and filter client-side, the repo runs
several other workflows (CodeQL, Auto-labeling, Auto approve PR, ...) and a
generic `--lookback` window of recent runs across all of them can leave
zero, or only a handful, of the two workflows actually being watched:

```bash
gh run list --repo growilabs/growi --workflow "Node CI for app development" \
  --limit {LOOKBACK} --status completed \
  --json databaseId,conclusion,headSha,createdAt,url,event,attempt

gh run list --repo growilabs/growi --workflow "Node CI for app production" \
  --limit {LOOKBACK} --status completed \
  --json databaseId,conclusion,headSha,createdAt,url,event,attempt
```

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

## Step 2: Fetch Failed Jobs and Classify Noise

`{RUN_ID}` below is the `databaseId` from Step 1.

For each failed run, list its jobs and keep the ones with
`conclusion == "failure"` (skip `cancelled` — those are pre-emptions by a
newer push, not evidence of anything):

```bash
gh api repos/growilabs/growi/actions/runs/{RUN_ID}/jobs -q '.jobs[] | select(.conclusion == "failure") | {id, name}'
```

Fetch each failed job's log:

```bash
gh run view {RUN_ID} --repo growilabs/growi --job {JOB_ID} --log-failed
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
gh run view {RUN_ID} --repo growilabs/growi --job {JOB_ID} --log \
  | grep -iE "flaky|Retry #|^:*error file="
```

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
   use `playwright:{SPEC_PATH}:{TEST_TITLE}` (recover the human title from
   the slug by matching it against spec files under
   `apps/app/playwright/` if needed).
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

This is an **observation**, not a confirmation — proceed to Step 4 to decide
whether it crosses the threshold.

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

Fetch every issue carrying either flaky label (both states, so a resolved-
and-since-reopened issue is still found) and look for an exact title match
client-side — this is also more precise than GitHub's fuzzy search
tokenization would have been:

```bash
gh api repos/growilabs/growi/issues -f state=all -f labels="flaky/observing" --paginate -q '.[] | {number,title,state}'
gh api repos/growilabs/growi/issues -f state=all -f labels="flaky/confirmed" --paginate -q '.[] | {number,title,state}'
```

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
  --label "{flaky/confirmed if Step 3 evidence is already confirmed, else flaky/observing}" \
  --body "$(cat <<'EOF'
## Detected by detect-flaky-ci

**Identity key**: `{IDENTITY_KEY}`
**Kind**: {playwright | vitest} {(strong evidence: passed on in-run retry) if confirmed}

### First observation

- Run: {RUN_HTML_URL}
- Job: {JOB_NAME}
- Commit: {HEAD_SHA}
- Date: {CREATED_AT}

### Evidence

```
{relevant log excerpt — the FAIL block or the ::error annotation + retry blocks}
```

### Status

{"Confirmed flaky from a single run (Playwright retry evidence)." if confirmed else "Observation 1/{VITEST_THRESHOLD} — needs {VITEST_THRESHOLD - 1} more independent occurrence(s) before this is handed to investigate-flaky-test."}
EOF
)"
```

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

Count observation comments (initial issue body counts as observation 1) plus
this new one. If the count reaches `--vitest-threshold` (or this evidence
item is itself a "confirmed" one per Step 3), escalate:

```bash
gh issue edit {NUMBER} --repo growilabs/growi --remove-label "flaky/observing" --add-label "flaky/confirmed"
```

### Existing OPEN issue found, already `flaky/confirmed`

Still append the observation comment (useful evidence for
`investigate-flaky-test`), but do not change labels — it is already queued
for investigation or being investigated.

### Existing CLOSED issue found

The test regressed again after being marked resolved. Reopen it and add a
comment explaining the new occurrence, plus the label `flaky/confirmed`
(skip `flaky/observing` — a recurrence after a claimed fix is stronger
evidence than a first-time observation):

```bash
gh issue reopen {NUMBER} --repo growilabs/growi
gh issue edit {NUMBER} --repo growilabs/growi --add-label "flaky/confirmed" --remove-label "{EXACT_PHASE_RESOLVED_LABEL}" --add-label "{EXACT_PHASE_NEW_LABEL}"
```

## Step 5: Report

Print a short summary of this run: how many runs/jobs scanned, how many
classified as infra noise (with which pattern), how many new issues created,
how many existing issues updated, how many escalated to `flaky/confirmed`.
This is the only user-facing output — do not create files.

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
