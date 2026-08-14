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

**Precondition**: the issue must carry the `flaky/confirmed` label (fetch
exact label names with `gh label list --repo growilabs/growi --json name`
before comparing — never hardcode). If it is still `flaky/observing`, stop
and report that `detect-flaky-ci` has not gathered enough evidence yet; do
not attempt to lower the bar by investigating early.

---

## Confidence Framework

Same three levels and same autonomous/interactive behavior as
`investigate-issue` (HIGH → proceed autonomously and state the evidence,
MEDIUM/LOW → stop and ask with a recommendation). Applied at two gates in
this skill: the fix-classification gate (Step 4) and the PR gate (Step 6).

---

## Step 1: Fetch Issue Evidence

```bash
gh issue view {ISSUE_NUMBER} --repo growilabs/growi --json number,title,body,labels,comments,url
```

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

**Primary tier — CI log analysis (always available, no live services
needed).** This skill is expected to run unattended, including from a cloud
routine whose checkout has no MongoDB replica set, no Elasticsearch, and no
browsers. Do not make CI-log analysis a fallback for when reproduction
"isn't available" — treat it as the normal, primary path, and treat live
reproduction (below) as a bonus when the current environment happens to
support it.

Pull more history than what's already in the issue, using the same tools
`detect-flaky-ci` uses:

```bash
# Vitest: how often does this exact test appear as FAIL across recent runs
# of the job that hosts it?
gh run list --repo growilabs/growi --workflow "Node CI for app development" --limit 50 --status completed --json databaseId,conclusion,headSha,createdAt

# Playwright: how often does this spec/browser show up in Retry#/flaky
# evidence across recent run-playwright jobs?
gh run list --repo growilabs/growi --workflow "Node CI for app production" --limit 50 --status completed --json databaseId,conclusion,headSha,createdAt
```

For each candidate run, fetch the relevant job's log (same commands as
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
problem, even though it *manifests* as flakiness.

| Category | Signature | Fix belongs in |
|---|---|---|
| **Shared/leaked state** | Test passes alone, fails alongside siblings; order-dependent; touches DB/fixtures another test also mutates | Test (isolate fixtures, don't disable parallelism — see `feedback_integ_test_isolation_per_worker` precedent: per-worker isolation, not disabling parallel execution) |
| **Missing await / race in the test** | Assertion runs before an async side effect completes; timing-dependent selector waits (Playwright) | Test |
| **Race in product code** | A fire-and-forget or unsynchronized async operation in application code (not the test) can observably run after the test's cleanup/assertion — e.g. a post-write side effect racing the same request's response | Product code |
| **Environment timing** | Legitimately slow CI runner, no logic bug, but still worth quarantine if disruptive | Quarantine only, do not "fix" nonexistent code |

Use `git log --oneline -20 -- {SPEC_PATH}` and read the code under test to
tell "shared state" from "product race" — a test that fails only when run
after a specific sibling usually points at a fixture; a test that fails with
an error surfaced from a service/model file (not the spec file itself) in
the log's stack trace usually points at a product-code race worth reading
carefully before dismissing as test flakiness.

---

## Step 4: Fix-Approach Decision Gate

**Confidence assessment:**

| Situation | Confidence |
|---|---|
| Root cause pinpointed (category from Step 3 is clear, consistent with the Step 2 rerun tally) + fix is surgical (1-2 files) | HIGH |
| Root cause identified but fix touches product code with broader blast radius, or category is ambiguous between "shared state" and "product race" | MEDIUM |
| Reruns failed 100% of the time (looks like a real regression, not a flake — see Step 2's note) | MEDIUM — flag this explicitly, do not silently treat it as a flaky-test fix |
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

```bash
gh pr create --repo growilabs/growi --draft \
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
)"
```

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

- Issue is not `flaky/confirmed`: stop, do not investigate (see Precondition).
- Reproduction impossible in devcontainer (e.g. browser deps missing): fall
  back to log-based analysis, note the limitation, and do not let this alone
  push confidence below what the CI evidence already supports.
- Fix requires product-code changes with security/auth/data implications:
  treat as MEDIUM or LOW regardless of how clear the race looks — this skill
  is not a substitute for `security-reviewer` on sensitive code paths.
