---
name: investigate-flaky-test
description: Investigate a GROWI flaky-test tracking issue (created by detect-flaky-ci) - reproduce, find the root cause, decide test-fix vs product-fix vs quarantine, and optionally open a PR. Usage - /investigate-flaky-test <issue-url-or-number> [--auto]
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion
argument-hint: <issue-url-or-number> [--auto]
---

# investigate-flaky-test

## Overview

Investigate a GitHub issue created by `detect-flaky-ci` and labeled
`flaky/confirmed`: reproduce the non-determinism, find the root cause,
classify it, and — if approved — fix it and open a PR.

This mirrors `investigate-issue`'s shape (confidence-gated stop points,
`phase/*` label lifecycle, branch/PR conventions) so both skills feel like
the same tool. **It is a separate skill, not a mode of `investigate-issue`**,
because the actual investigation content is unrelated: no reported version to
check, no browser reproduction of user-facing steps, and the fix taxonomy
(test-side vs. product-side vs. quarantine) does not apply to ordinary bug
reports.

Supports the same two execution modes as `investigate-issue`:
- **interactive** (default): stop at every decision gate
- **autonomous** (`--auto`, or invoked from `/flaky-ci-routine`): cross a gate
  automatically at HIGH confidence, stop at MEDIUM or LOW

## Input

`$ARGUMENTS` is an issue URL or number, optionally with `--auto`. Parse the
issue number and mode the same way `investigate-issue` does.

**Precondition**: the issue must carry `flaky/confirmed` **or**
`flaky/suspected` (fetch exact label names with
`gh api repos/growilabs/growi/labels --paginate -q '.[].name'` before
comparing — never hardcode, and use REST here, not `gh label list --json`,
which a cloud routine's proxy-restricted `gh` session rejects — see Error
Handling). If it is still `flaky/observing`, stop and report that
`detect-flaky-ci` has not gathered enough evidence yet; do not attempt to
lower the bar by investigating early.

These two accepted labels mean different things and change Step 2:

- **`flaky/confirmed`** — already empirically proven (Playwright's in-run
  retry already IS the proof, or a prior vitest threshold-accumulation
  already reached two independent observations). No confirmation rerun is
  owed here before proceeding to root-cause work — go straight into Step 2's
  existing evidence-gathering.
- **`flaky/suspected`** — `detect-flaky-ci`'s cheap mechanical mining (diff/
  PR mismatch, sandwich pattern, or matrix divergence) found this, but
  nothing has actually reproduced it live yet. This skill owes it exactly
  **one** confirmation rerun (not the 2-3 tally used elsewhere in this
  skill — that budget is for a different purpose, see Step 2) before
  treating the flakiness itself as real. See "Step 2, `flaky/suspected`
  path" below.

---

## Confidence Framework

Same three levels and same autonomous/interactive behavior as
`investigate-issue` (HIGH → proceed autonomously and state the evidence,
MEDIUM/LOW → stop and ask with a recommendation). Applied at two gates in
this skill: the fix-classification gate (Step 4) and the PR gate (Step 6).

---

## Step 1: Fetch Issue Evidence

Use REST (`gh api`), not `gh issue view --json` — the latter is
GraphQL-backed and rejected by a cloud routine's proxy-restricted `gh`
session (see Error Handling):

```bash
gh api repos/growilabs/growi/issues/{ISSUE_NUMBER}
gh api repos/growilabs/growi/issues/{ISSUE_NUMBER}/comments --paginate
```

The first call gives `title`, `body`, `labels[].name`, `html_url`, `state`;
the second gives every comment (each observation `detect-flaky-ci` appended
after the first).

The title is `flaky: {IDENTITY_KEY}` (set by `detect-flaky-ci`), where
`IDENTITY_KEY` is one of:
- `vitest:{SPEC_PATH}:{TEST_TITLE}` — reproduce with vitest, precise identity.
- `playwright:{SPEC_PATH}:{TEST_TITLE}` — reproduce with Playwright, precise identity.
- `playwright:{BROWSER}` — a **job-level fallback identity**: `detect-flaky-ci`
  could not isolate which spec was flaky from the CI log alone. The issue
  body's evidence section will say so explicitly. In this case, do not guess
  a spec — read the linked run's full Playwright report first (the run URL
  in the "First observation" section) to find the actual flaky spec before
  attempting Step 2 reproduction. If the report is no longer available
  (artifact retention expired), report LOW confidence at Step 4 rather than
  guessing.

Parse the identity key from the title (split on the first `:` and then on the
last `:` to isolate `SPEC_PATH`/`TEST_TITLE` — `SPEC_PATH` values here are
project-relative paths and never contain a bare `:`, so this is unambiguous).
Collect every observation block from the body and comments (run URLs,
commits, log excerpts) — later
observations may show the failure mode drifting or repeating identically,
which is itself evidence for Step 3.

Mark as under investigation, same as `investigate-issue`:

```bash
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "{EXACT_PHASE_NEW_LABEL}" --add-label "{EXACT_PHASE_UNDER_INVESTIGATION_LABEL}"
```

---

## Step 2: Gather Evidence

### `flaky/suspected` path: kick off the confirmation rerun first, in parallel

If the issue's label is `flaky/suspected` (see Precondition), start its
one-time confirmation rerun **before** doing anything else in this step, so
it executes in the background while the static analysis below reads:

```bash
gh run rerun {RUN_ID} --repo growilabs/growi --failed
```

where `{RUN_ID}` is the run cited in the issue's "First observation" (or
the mining evidence, if a later comment's observation is what triggered the
mining hit). Do not wait for it here — proceed immediately to the static
analysis below, and only come back to check this rerun's result at the end
of this step, right before Step 3. This is a single rerun, not the 2-3
tally used in the "second tier" below — that tally is a different budget
for a different purpose (root-cause confidence), spent later, in Step 4/6.

When you check back: if the rerun **passed** with no code change, that is
empirical proof of flakiness — escalate the label before continuing:

```bash
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "flaky/suspected" --add-label "flaky/confirmed"
```

If it **failed again**, you cannot yet tell "still flaky, unlucky twice"
from "actually a real regression that only looks CI-specific" with a single
data point — do not silently treat this as confirmed. Carry it into Step 4
as an explicit caveat (same handling as "reruns failed 100% of the time" in
that step's confidence table) rather than assuming the mining hit was
correct.

### Primary tier — CI log analysis (always available, no live services needed)

This skill is expected to run unattended, including from a cloud routine
whose checkout has no MongoDB replica set, no Elasticsearch, and no
browsers. Do not make CI-log analysis a fallback for when reproduction
"isn't available" — treat it as the normal, primary path, and treat live
reproduction (below) as a bonus when the current environment happens to
support it.

Pull more history than what's already in the issue, using the same tools
`detect-flaky-ci` uses (the `gh api .../actions/workflows/{file}/runs` REST
calls from its Step 1 — not `gh run list --json`, for the same
version-fragility reason given there):

```bash
# Vitest: how often does this exact test appear as FAIL across recent runs
# of the job that hosts it?
gh api "repos/growilabs/growi/actions/workflows/ci-app.yml/runs?per_page=50&status=completed" \
  -q '.workflow_runs[] | {databaseId: .id, conclusion, headSha: .head_sha, createdAt: .created_at}'

# Playwright: how often does this spec/browser show up in Retry#/flaky
# evidence across recent run-playwright jobs?
gh api "repos/growilabs/growi/actions/workflows/ci-app-prod.yml/runs?per_page=50&status=completed" \
  -q '.workflow_runs[] | {databaseId: .id, conclusion, headSha: .head_sha, createdAt: .created_at}'
```

For each candidate run, fetch the relevant job's log (same method Step 0 of
`flaky-ci-routine.md` decided — `gh run view --log*` or
`mcp__github__get_job_logs`, whichever this run is using; see
`detect-flaky-ci` Step 2/2b) and grep for the test title. Build a picture of:
how often it fails, whether the failure mode is identical every time (points
to a deterministic race, easier to fix) or varies (points to genuine timing
noise), and — critically — read the **stack trace / error origin** in each
occurrence: an error surfacing from a service/model file (not the spec
itself) is your first clue toward a product-code race (see Step 3).

Read the spec file and the code path it exercises. For Playwright specs,
static-analyze for timing-dependent patterns (missing
`await expect(...).toBeVisible()` before interaction, reliance on fixed
`waitForTimeout`, selectors matching multiple elements — see the
`comments.spec.ts` "strict mode violation: resolved to 2 elements" pattern,
a real example already seen in this repo's CI).

**Second tier — actively re-run the real CI job (always available, no local
services needed, and stronger than local reproduction).** `detect-flaky-ci`
noted that a same-SHA rerun flipping from failure to success is the
gold-standard flaky signal, but treated it as rare because it only happens
when a human manually reruns. This skill does not have to wait for that —
it can trigger it directly, using GitHub Actions' own real MongoDB replica
set / Elasticsearch / browsers instead of whatever local environment this
skill happens to be running in:

```bash
gh run rerun {RUN_ID} --repo growilabs/growi --failed
```

where `{RUN_ID}` is a run cited in the issue's evidence. Wait for it to
complete (`gh run watch {RUN_ID} --repo growilabs/growi`), then fetch the
new attempt's job log exactly as in Step 1/`detect-flaky-ci` Step 2. Repeat
2-3 times to build a same-commit pass/fail tally — e.g. "failed 1/4 reruns"
is meaningfully different evidence from "failed 4/4 reruns" for both the
root-cause read (the former looks like real non-determinism, the latter
looks more like a deterministic bug that merely presents as CI-only) and
for Step 4's confidence assessment. This costs CI minutes on the real repo,
so do not loop indefinitely — 2-3 reruns is enough signal; stop earlier if a
clear pattern emerges (e.g. it fails every single time — that increasingly
looks like a real regression, not a flake, and is worth flagging as such
even though `detect-flaky-ci` escalated it).

**Bonus tier — live reproduction, only if the current environment supports
it.** Probe rather than assume:

```bash
# vitest / integ tests need a real MongoDB replica set
mongosh --eval "db.adminCommand('ping')" 2>/dev/null || echo "no mongo"
# playwright needs installed browsers
pnpm exec playwright --version 2>/dev/null && ls ~/.cache/ms-playwright 2>/dev/null
```

If available:

```bash
# vitest
cd apps/app && pnpm vitest run {SPEC_PATH_PARTIAL} --repeat=20

# playwright
cd apps/app && pnpm playwright test {SPEC_PATH_PARTIAL} --repeat-each=10
```

A local reproduction (or local pass after a fix) is strictly additional
confirmation on top of the CI-log evidence — never required to reach HIGH
confidence, and its absence is never grounds to lower confidence below what
the accumulated CI evidence alone supports.

---

## Step 3: Root-Cause and Classify

Determine which category the flake belongs to — this decides the fix
strategy in Step 4. Do not default to "just flaky, add a retry" — a race
condition in product code surfaced by a test is a real bug, not a test
problem, even though it *manifests* as flakiness. The same discipline
applies to "Environment timing": do not default to "just bump the
timeout" either — see the guardrail below.

| Category | Signature | Fix belongs in |
|---|---|---|
| **Shared/leaked state** | Test passes alone, fails alongside siblings; order-dependent; touches DB/fixtures another test also mutates | Test (isolate fixtures, don't disable parallelism — see `feedback_integ_test_isolation_per_worker` precedent: per-worker isolation, not disabling parallel execution) |
| **Missing await / race in the test** | Assertion runs before an async side effect completes; timing-dependent selector waits (Playwright) | Test |
| **Race in product code** | A fire-and-forget or unsynchronized async operation in application code (not the test) can observably run after the test's cleanup/assertion — e.g. a post-write side effect racing the same request's response | Product code |
| **Environment timing** | Legitimately slow CI runner, no logic bug, but still worth quarantine if disruptive | See guardrail below — usually a test redesign, not a bare timeout bump; quarantine only when no redesign is possible |

Use `git log --oneline -20 -- {SPEC_PATH}` and read the code under test to
tell "shared state" from "product race" — a test that fails only when run
after a specific sibling usually points at a fixture; a test that fails with
an error surfaced from a service/model file (not the spec file itself) in
the log's stack trace usually points at a product-code race worth reading
carefully before dismissing as test flakiness.

### Guardrail — a bare timeout increase is a stopgap; find what's actually driving the cost first

A numeric timeout bump (`}, 15_000)` → `}, 20_000)` and so on) is the
cheapest possible edit, and that is exactly the problem: it is easy to
reach for as *the* fix without ever asking what made the operation slow.
Left unexamined, it tends to become the default "Environment timing" fix —
and because it never touches the actual driver of the cost, it is usually
a way of avoiding the root-cause work rather than doing it. It doesn't
remove the underlying slowness; it just moves the load level at which the
test starts failing again a bit higher, and the next CI-busy period trips
it once more. Treat a bare bump as a **last resort**, not a first move —
before proposing one, identify what is actually driving the observed
duration. Two drivers show up repeatedly in this codebase; neither is
fixed by a bigger number:

**Driver 1 — the test's own wall time scales with a parameter of the
test** (a loop count, a data size, an iteration count) rather than being a
fixed cost that merely got unlucky under load. Read the test body, not
just the failing assertion. If it issues `N` real round-trips (network,
DB, filesystem) where `N` is `maxRequests`, a loop bound, or similar, and
the assertions of interest only concern the *boundary* (a limit being
reached/exceeded, a count saturating, a last-element condition), that is a
redesign opportunity, not an environment-timing dead end:

- Seed the precondition directly instead of looping to it — many
  libraries expose a lower-level primitive that reaches the same state in
  one call (e.g. `rate-limiter-flexible`'s `penalty(key, n)` reaches
  `n` consumed points through the identical internal upsert path
  `consume()` uses, in a single round-trip, instead of looping `consume()`
  `n` times — see the `consume-points.integ.ts` fix for issue #11718/PR
  #11719 for a worked example. The general shape: find the state-setting
  primitive the library already ships, confirm it goes through the same
  code path as the operation under test, and use it to jump straight to
  one step before the boundary).
- Exercise only the transition itself (the call(s) at and past the
  boundary) through the real code under test.
- This turns an O(N) cost into an O(1) cost, which removes the test's
  sensitivity to CI load rather than buying temporary headroom against it.

**Driver 2 — the cost scales with concurrent worker count, not a test-local
parameter.** A `beforeAll`/`afterAll` in a `setupFiles` entry (migration
replay, a singleton service cold-init, etc.) runs once per Vitest
**worker**, and its timeout applies to every spec file that worker happens
to run — not to one test. "This hook's own cost doesn't loop over
anything, so there's nothing to redesign" sounds like it forces driver 1's
dead end, but it doesn't: the cost still scales with **how many workers
pay it at the same moment**, since sibling workers on the same CI runner
compete for the same CPU while each does its own heavy cold-start work
(spawning a migration subprocess, initializing a singleton, etc.). A
same-commit failure across several unrelated spec files that all timed out
on the identical `beforeAll` line, with no code change near that line, is
the signature of this shape (see `test/setup/crowi.ts`'s `getInstance()` /
`test/setup/migrate-mongo.ts` in GROWI's own `apps/app` for a worked
example — PR #11824 misclassified exactly this as "nothing to redesign,
so a bump is fine"). Where this applies:

- **Measure the unloaded baseline.** Run the failing spec(s) alone (no
  sibling workers contending) and read the hook's own duration off the
  reporter. If it already sits close to the current limit, a larger
  timeout may be warranted — state the measured number. If it sits well
  under the limit (e.g. under a fifth of it), the limit was never the
  problem; contention pushed a normally-fast hook past it, and a bigger
  number just delays the same failure to a heavier-load day.
- **Check for a same-project precedent that a bump already failed.** If a
  *different* hook sharing the same `setupFiles`/project already had its
  timeout raised for the same "environment timing" reason and still
  flaked afterward (grep prior flaky-test issues/PRs for the project
  name), that is direct evidence the bottleneck is concurrency, not any
  single hook's deadline — proposing another bump for a second hook in
  the same project repeats a fix this repo's own history already falsified.
- **Prefer bounding worker concurrency over widening the deadline.** When
  the mechanism is "N workers cold-initializing at once fight for the
  runner's cores," the fix that addresses the mechanism is capping
  concurrent workers (Vitest `poolOptions.forks.maxForks` /
  `poolOptions.threads.maxThreads`, sized off `availableParallelism()`
  with headroom for sibling CI services like a DB/search container) for
  that project — not a bigger number on the hook that happened to lose
  the race this time.
- **Never scope the change wider than the evidence.** `hookTimeout` (and
  `testTimeout`) are configurable per-project in `vitest.workspace.mts`
  *and* per-hook as a call's last argument. A fix aimed at one shared
  setup hook must not raise the timeout for the whole project — that
  silently triples (or more) the failure-detection window for every other
  `beforeAll`/`afterAll` in every spec file the project covers, including
  a future genuine hang unrelated to this flake.

Both drivers reduce to the same discipline: **find what the time is
actually being spent on, and address that** — a scaling parameter to
redesign around, or contention to bound — rather than reaching for the
timeout value because it's the line the stack trace happened to point at.

Only accept a bare timeout bump when:
- neither driver applies and no other driver can be identified after
  actually reading the test/hook and its call path (rare — most cases
  reduce to one of the two above), or
- as a **modest safety margin layered on top of a fix that already
  addressed the real driver** — not as the fix itself. State explicitly
  why the margin is still there (e.g. "no CI history yet for this
  reshaped test, and local/CI timing can differ") rather than leaving it
  unexplained.

A proposed fix that is only a numeric timeout change, with no evidence
either driver was checked, is not HIGH confidence at Step 4 regardless of
how clean the diff looks — see the confidence table there. Route it
through the MEDIUM path and present the redesign or concurrency-capping
alternative explicitly rather than defaulting to the bump.

---

## Step 4: Fix-Approach Decision Gate

**Confidence assessment:**

| Situation | Confidence |
|---|---|
| Root cause pinpointed (category from Step 3 is clear, consistent with the Step 2 rerun tally) + fix is surgical (1-2 files) | HIGH |
| Root cause identified but fix touches product code with broader blast radius, or category is ambiguous between "shared state" and "product race" | MEDIUM |
| Reruns failed 100% of the time (looks like a real regression, not a flake — see Step 2's note) | MEDIUM — flag this explicitly, do not silently treat it as a flaky-test fix |
| Issue came in as `flaky/suspected` and its one confirmation rerun (Step 2) also failed | MEDIUM — the mining hit alone is not empirical proof; say explicitly that the confirmation rerun did not reproduce a pass, so this could be a real regression rather than a flake, and that only one rerun was budgeted (not the 100%-tally case above) |
| Proposed fix is a bare timeout increase, with no check for whether the test's cost scales with a parameter (see the Step 3 guardrail) | MEDIUM at best — go back and check for a redesign before treating this as HIGH, even if the diff is small and clean |
| CI evidence and reruns alone do not localize a cause | LOW |

**In `autonomous` mode:**
- **HIGH** → proceed to Step 5 automatically. State the category and planned fix.
- **MEDIUM or LOW** → stop and ask, presenting: reproduction result, suspected
  category, why confidence isn't HIGH, and a recommendation among: 1) proceed
  with the best-guess fix, 2) quarantine with a comment linking this issue
  (only ever a stop-gate outcome, never an autonomous default), 3) escalate
  for human review of the product code, 4) close as unable to reproduce after
  N cycles (only if reproduction attempts genuinely found nothing across
  every method in Step 2).

**In `interactive` mode:** always ask.

**Quarantine guardrail**: never mark a test `.skip`/`.todo` as the
autonomous-HIGH default outcome. Quarantine is legitimate only as an
explicitly chosen MEDIUM/LOW-gate outcome (interactive approval, or
autonomous only when the category is "Environment timing" with no code path
to fix), and the quarantine commit must reference this issue number in a
comment so it is discoverable later.

---

## Step 5: Implement

### 5-A: Branch

```bash
git checkout -b fix/flaky-{ISSUE_NUMBER}-{short-description}
```

### 5-B: Fix

Apply the fix matching the Step 3 category. Whatever the category, the
verification bar is higher than a normal bug fix: a flaky test that "looks
fixed" after one green run has not been shown to be fixed.

Both essential-test-design and essential-test-patterns skills apply here —
consult them if the fix touches test code, same as any other test change in
this repo (`.claude/rules/testing.md`).

Push the fix to the branch and open the PR (Step 6) *before* running
verification — verification here means repeatedly re-running the PR's own
real CI, which needs the PR to exist and its checks to have run at least
once. If the environment happens to support local execution (probed in Step
2), run that too as a fast pre-push sanity check, but it never substitutes
for the PR-CI-based verification in Step 6.

### 5-C: Commit

```
fix(scope): stabilize flaky test — {short root cause}

Fixes #{ISSUE_NUMBER}
```

---

## Step 6: Verify via Real CI, Then the PR Readiness Gate

Verification needs the fix's own commit to run through GitHub Actions' real
MongoDB/Elasticsearch/browsers — that only happens once the branch is
pushed and a PR exists to run checks against. So the sequence here is
**open as draft first, verify, then decide whether to mark it ready** —
not the reverse.

### 6-A: Open a draft PR

Open the draft PR, then immediately post a marker comment on the tracking
issue, in the **same shell invocation** — so the Dashboard Updater (a
separate component) can pick up this PR's link with a simple pattern match
instead of searching issue/comment bodies in free form. `$PR_HTML_URL` only
exists for the duration of the shell that set it — a separate tool call
starts a fresh shell with no memory of it, so both commands below must run
as one script, not as two independent invocations:

```bash
PR_HTML_URL=$(gh pr create --repo growilabs/growi --draft \
  --title "fix: stabilize flaky test in {short scope}" \
  --body "$(cat <<'EOF'
## Summary

{description of the fix}

## Root Cause

{category from Step 3 + specific mechanism}

## Verification

In progress — re-running CI to confirm the fix holds across repeated
executions (see comments below). This PR stays draft until that completes.

Fixes #{ISSUE_NUMBER}
EOF
)")

gh issue comment {ISSUE_NUMBER} --repo growilabs/growi --body "**Fix PR**: ${PR_HTML_URL}"
```

This comment must be its own comment — a fixed one-line marker, not
appended to any other comment — and its exact text must be
`**Fix PR**: {PR_HTML_URL}` (this exact string is what the Dashboard
Updater matches on; do not add a heading or extra wording that would break
the match, and do not reuse the `### Additional observation` /
`### Backfilled observation` headings from `detect-flaky-ci` here — this
comment is intentionally excluded from that issue's observation-count).

### 6-B: Re-run this PR's CI for a repeat-green tally

Let the PR's initial CI run complete, then rerun the **whole run** (not
`--failed` — it should already be green, you're building repeat-pass
evidence, not chasing a failure) 2-3 times:

```bash
gh run rerun {PR_RUN_ID} --repo growilabs/growi
gh run watch {PR_RUN_ID} --repo growilabs/growi
```

This is the direct equivalent of the old local `--repeat=20` /
`--repeat-each=10`, except it runs on real CI infrastructure regardless of
what this skill's own execution environment supports.

### 6-C: Confidence Assessment

| Situation | Confidence |
|---|---|
| All reruns green + lint passes + fix stayed in scope | HIGH |
| All reruns green but fix touched product code beyond the originally suspected file | MEDIUM |
| Any rerun still shows the original failure, or lint/type errors | LOW |

**Autonomous**: HIGH → mark the PR ready and update its body with the
verification tally (see 6-D). MEDIUM/LOW → stop and ask, leaving the PR in
draft, presenting the rerun tally and a recommendation (same four-option
shape as Step 4, plus "close the PR and downgrade to a comment on the
issue" when a rerun shows the original failure recurring).

**Interactive**: always ask, same options.

### 6-D: Mark Ready and Update Labels (HIGH confidence, or after approval)

```bash
gh pr ready {PR_NUMBER} --repo growilabs/growi
gh pr edit {PR_NUMBER} --repo growilabs/growi --body "$(cat <<'EOF'
{same body as 6-A, with the Verification section replaced by:}

## Verification

- Re-ran this PR's CI {N} times after the initial pass — {N}/{N} green.
{- local reproduction result, if the environment supported it (bonus tier)}

Fixes #{ISSUE_NUMBER}
EOF
)"

gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "{EXACT_PHASE_UNDER_INVESTIGATION_LABEL}" --add-label "{EXACT_PHASE_RESOLVED_LABEL}"
```

(`flaky/confirmed` stays — it is a permanent record that this issue was a
real, confirmed flake, not something to remove on resolution. If the same
identity key resurfaces after this merges, `detect-flaky-ci`'s "existing
CLOSED issue found" path reopens it automatically — that recurrence check is
the long-term backstop this skill's verification ultimately relies on, on
top of the repeat-CI tally above.)

---

## Error Handling

- Any `gh issue`/`gh label`/`gh pr` command fails with a GraphQL/proxy error
  (e.g. "This GraphQL query is not enabled for this session"): switch that
  specific call to its `gh api` REST equivalent and continue — see
  `detect-flaky-ci`'s Error Handling for the same note and example mutation
  form. `gh run ...` commands (Actions API) are never affected by this,
  since Actions has no GraphQL API to begin with.
- Issue is neither `flaky/confirmed` nor `flaky/suspected`: stop, do not
  investigate (see Precondition).
- A human approves proceeding with a best-guess fix at a MEDIUM gate for an
  issue that came in as `flaky/suspected` and whose confirmation rerun
  failed (Step 2/Step 4): the label is still `flaky/suspected` at that
  point, not `flaky/confirmed` — do not silently promote it. Leave the
  label as-is and let the PR body's Root Cause section carry the caveat
  that this was never empirically reproduced; only Step 6-D's "reruns
  green" evidence (a different, later rerun of the PR's own CI) is grounds
  to also flip the label to `flaky/confirmed` at that point.
- Reproduction impossible in devcontainer (e.g. browser deps missing): fall
  back to log-based analysis, note the limitation, and do not let this alone
  push confidence below what the CI evidence already supports.
- Fix requires product-code changes with security/auth/data implications:
  treat as MEDIUM or LOW regardless of how clear the race looks — this skill
  is not a substitute for `security-reviewer` on sensitive code paths.
