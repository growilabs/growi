---
name: flaky-ci-routine
description: Full flaky-CI routine - detect flaky CI failures, then investigate/fix every newly-confirmed one. Designed to be run unattended from a cron schedule. Usage: /flaky-ci-routine [--window-hours=N] [--vitest-threshold=N]
---

# /flaky-ci-routine

Orchestrates the two flaky-CI skills in sequence. This command holds no
detection or investigation logic of its own — it only sequences
`detect-flaky-ci` and `investigate-flaky-test`, each of which is a
self-contained skill usable on its own. Keeping the sequencing here (rather
than inline in a cron prompt) means there is one place to read or edit the
chain, whether it's triggered by cron or run by hand.

## Step 0 — Ensure `gh` is available and can write via REST

Every step below depends on `gh`. This command is designed to also run from
an unattended cloud routine whose checkout may not have `gh` preinstalled.

```bash
if ! command -v gh >/dev/null 2>&1; then
  echo "gh not found — installing"
  # Prefer the system package manager: a cloud routine's egress proxy may
  # only allow GitHub access scoped to growilabs/growi, which blocks a
  # direct download from github.com/cli/cli's releases (confirmed: 403/404
  # in this project's cloud environment). apt's archive is a different host
  # and is not subject to that restriction.
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get install -y gh 2>&1 || apt-get install -y gh 2>&1
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "apt-get unavailable or failed — falling back to a static binary from github.com/cli/cli"
    GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -m1 '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')"
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz
    tar -xzf /tmp/gh.tar.gz -C /tmp
    export PATH="/tmp/gh_${GH_VERSION}_linux_amd64/bin:$PATH"
  fi
fi
gh --version
```

Then confirm actual write capability — **do not trust `gh auth status`
alone**: a cloud routine's `gh` session showed an "Active account: true"
with a token `gh auth status` itself calls invalid, which is confusing but
not the real signal to gate on either way. The real constraint (confirmed
empirically) is narrower and stranger than "authenticated or not": this
environment's `gh` sits behind an egress proxy that serves plain REST calls
to `repos/{owner}/{repo}/...` with real data, but rejects `gh`'s
GraphQL-backed commands — which includes `--json` on `gh issue`/`gh label`/
`gh pr` (NOT `gh run ...`, which is REST-only in GitHub's API regardless of
`--json`, and unaffected). So probe with plain REST, since that's what
every step in this routine actually uses (`detect-flaky-ci` and
`investigate-flaky-test` were rewritten to use `gh api` for all
issue/label/PR reads and writes for exactly this reason):

```bash
gh api repos/growilabs/growi/labels -q '.[0].name' \
  && echo "REST read ok" || { echo "gh api cannot read growilabs/growi via REST — stopping"; exit 1; }
```

If `gh` cannot be installed, or the REST probe above fails: **stop
immediately and report this clearly** — treat a missing prerequisite as a
stop condition, not something to route around by improvising a different
approach. Do not proceed to Step 1 without confirmed REST access, since
Step 1 onward creates issues/labels/PRs and a failure partway through is
harder to clean up than a clean stop before starting.

### Job Log Fetch Method — decide once, for the whole run

`detect-flaky-ci` and `investigate-flaky-test` both need to read CI job
logs. `gh run view --log-failed` / `--log` works by following a signed
redirect to a different domain (`results-receiver.actions.githubusercontent.com`
/ `*.blob.core.windows.net`); a cloud routine's egress proxy blocks that
redirect target regardless of whether the request comes from `gh` or a raw
`gh api` call (confirmed empirically — this is a network policy on the
redirect's destination domain, not a `gh`-vs-REST distinction). The GitHub
MCP server's `mcp__github__get_job_logs` tool fetches the same content
server-side and is not subject to that restriction.

Decide the method **exactly once, here**, and pass it down rather than
letting each skill probe (or worse, try-and-fall-back) independently per
log fetch — the capability is a property of this environment for the whole
run, not of any individual log:

```
if `mcp__github__get_job_logs` appears among your available tools: JOB_LOG_METHOD=mcp
else: JOB_LOG_METHOD=gh
```

State `JOB_LOG_METHOD` explicitly when invoking `detect-flaky-ci` and
`investigate-flaky-test` below (e.g. as a line in the prompt: "Job log
fetch method for this run: {JOB_LOG_METHOD}"), and include it in this
command's own Step 4 report.

## Step 1 — Detect

Invoke the `detect-flaky-ci` skill with `$ARGUMENTS` passed through
(`--window-hours`, `--max-runs-per-workflow`, `--vitest-threshold`) plus the
`JOB_LOG_METHOD` decided in Step 0. If `--window-hours` isn't in
`$ARGUMENTS`, don't force a value here — let `detect-flaky-ci`'s own
default (twice its cron cadence) apply. Let it finish and report its
summary.

## Step 2 — Select newly-actionable issues

List issues that are confirmed-or-suspected flaky AND not already past the
"new" stage (so an issue already mid-investigation, WIP, or resolved from a
prior routine run is not re-processed):

```bash
gh api repos/growilabs/growi/labels --paginate -q '.[].name'
```

REST's `labels` query parameter is an AND filter on comma-separated names
(an issue must carry every listed label), which is exactly "{tier} AND
still new". Run it once per tier and merge the two lists — a single query
can't OR two different tier labels together:

```bash
gh api -X GET repos/growilabs/growi/issues -f state=open -f labels="flaky/confirmed,{EXACT_PHASE_NEW_LABEL}" --paginate -q '.[] | {number,title}'
gh api -X GET repos/growilabs/growi/issues -f state=open -f labels="flaky/suspected,{EXACT_PHASE_NEW_LABEL}" --paginate -q '.[] | {number,title}'
```

(`-X GET` is required whenever `-f`/`-F` is used for a read — `gh api`
otherwise defaults to `POST`, which a read endpoint like this rejects with
a confusing "title wasn't supplied" 422.)

If this combined list is empty, report that and stop — there is nothing to
investigate this run.

## Step 3 — Investigate each, autonomously

For each issue number found, invoke the `investigate-flaky-test` skill with
`--auto`, passing the same `JOB_LOG_METHOD` decided in Step 0:

```
investigate-flaky-test {ISSUE_NUMBER} --auto
(Job log fetch method for this run: {JOB_LOG_METHOD})
```

Run these **sequentially, one issue at a time** — not in parallel. Each
investigation may modify the working tree (branch, files, commits); running
several concurrently in the same checkout would corrupt each other's work.
If a genuinely parallel routine is ever needed, that requires per-issue
worktree isolation, which is out of scope for this command as written.

Autonomous mode means most issues resolve without stopping (HIGH-confidence
gates cross automatically), but a MEDIUM/LOW gate inside
`investigate-flaky-test` will still stop and ask — since this command may be
running unattended from cron, treat any such stop as "pause this issue and
move to the next one" rather than blocking the whole routine: note it in the
final report as needing human attention and continue with the next issue in
the list.

## Step 4 — Update the dashboard

Run this step **even if Step 3 stopped one or more issues for human
decision.** "ルーティンの実行が完了した場合" (Requirement 5.1 — "when a run
of the routine has completed") means this routine cycle reaching its end,
not every individual investigation having finished. An issue that Step 3
paused on still has a current tier label (`flaky/observing` /
`flaky/suspected` / `flaky/confirmed`); it simply appears in the dashboard
table with that tier, same as any other active issue.

1. **Re-fetch the active issue set.** Do not reuse the list Step 2 built —
   labels may have changed while Step 3 was running. Fetch fresh, `open`,
   one tier at a time (same AND-filter reasoning as Step 2 — a single query
   can't OR two tier labels together):

   ```bash
   gh api -X GET repos/growilabs/growi/issues -f state=open -f labels="flaky/observing" --paginate -q '.[] | {number,title,created_at,labels}'
   gh api -X GET repos/growilabs/growi/issues -f state=open -f labels="flaky/suspected" --paginate -q '.[] | {number,title,created_at,labels}'
   gh api -X GET repos/growilabs/growi/issues -f state=open -f labels="flaky/confirmed" --paginate -q '.[] | {number,title,created_at,labels}'
   ```

2. **Build one row per issue** with columns `Identity | Tier | First seen |
   Last seen | Occurrences | Tracking issue | Fix PR`:
   - Identity: the issue title with the `flaky: ` prefix removed.
   - Tier: `observing` / `suspected` / `confirmed`, from the label found above.
   - First seen: the issue's `created_at`.
   - Last seen: the most recent of the issue's own updates and its
     qualifying comments (see Occurrences below).
   - Occurrences: **1** (the tracking issue's own body, i.e. the first
     observation) **plus** the count of comments on that issue whose
     heading matches `### Additional observation` or
     `### Backfilled observation` (prefix match on the comment's first
     line). Do **not** count every comment — identity corrections, the
     Fix-PR marker comment, and human notes do not represent additional
     observations and must be excluded. (These two heading strings must
     stay in sync with what `detect-flaky-ci/SKILL.md` actually writes; if
     that wording ever changes, update both files together.)
   - Tracking issue: a link to the issue.
   - Fix PR: **forward-only**. Populate this only if the issue carries a
     `**Fix PR**: {URL}` marker comment (written by `investigate-flaky-test`
     Step 6-A). If no such marker comment exists — including for tracking
     issues created before this convention existed — write `—` (em dash).
     Do **not** scan the issue body or other comments for a PR URL as a
     fallback: those free-form mentions can reference unrelated PRs (e.g.
     the PR an evidence commit originally came from), and guessing wrong is
     worse than leaving the cell blank.

3. **Search for the dashboard issue** by exact title match on
   `flaky-ci-routine: dashboard` (same exact-title pattern `detect-flaky-ci`
   already uses for tracking issues):

   ```bash
   gh api -X GET repos/growilabs/growi/issues -f state=all -f labels="flaky/dashboard" --paginate -q '.[] | select(.title == "flaky-ci-routine: dashboard") | {number,created_at}'
   ```

   - **0 results** → create a new issue titled exactly
     `flaky-ci-routine: dashboard`, labeled `flaky/dashboard`, with the
     table built in step 2 as its body.
   - **1 result** → replace that issue's body **entirely** with the freshly
     built table (never append — a full replace is what makes resolved
     issues disappear from the table on the very next run, and what makes
     a zero-active-issues run show an empty table instead of stale content).
   - **2+ results (anomaly)** → this should not happen; treat the oldest
     (lowest `created_at`) as canonical and update it as above. Do not
     auto-merge or delete the others. Note the anomaly (issue numbers found)
     at the top of the dashboard body and in this routine's Step 5 report.

4. **If the table is at risk of exceeding GitHub's ~65536-character body
   limit**, sort the remaining rows by confidence tier (confirmed >
   suspected > observing) then by most-recent-last-seen, keep as many rows
   from the top as fit, and state explicitly at the top of the body how
   many rows were truncated and why. Never truncate silently.

## Step 5 — Report

Summarize the run: which `JOB_LOG_METHOD` Step 0 selected, how many issues
were newly confirmed vs newly suspected by Step 1 (and, of the suspected
ones, how many `investigate-flaky-test` promoted to confirmed via its
one-time rerun vs left at suspected pending human review), how many were
investigated in Step 3, how many resulted in a PR, how many were left
pending human decision (and why), and how many were quarantined. Also
report Step 4's outcome: whether the dashboard issue was created or updated,
how many rows it now lists, and whether any rows were truncated (and if so,
how many). This is the routine's output — nothing else needs to be written.
