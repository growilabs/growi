---
name: flaky-ci-routine
description: Full flaky-CI routine - detect flaky CI failures, then investigate/fix every newly-confirmed one. Designed to be run unattended from a cron schedule. Usage: /flaky-ci-routine [--lookback=N] [--vitest-threshold=N]
---

# /flaky-ci-routine

Orchestrates the two flaky-CI skills in sequence. This command holds no
detection or investigation logic of its own — it only sequences
`detect-flaky-ci` and `investigate-flaky-test`, each of which is a
self-contained skill usable on its own. Keeping the sequencing here (rather
than inline in a cron prompt) means there is one place to read or edit the
chain, whether it's triggered by cron or run by hand.

## Step 0 — Ensure `gh` is available and authenticated

Every step below depends on `gh`. This command is designed to also run from
an unattended cloud routine whose checkout may not have `gh` preinstalled
(confirmed missing in this project's cloud environment during setup) — do
not assume it's on `PATH`.

```bash
if ! command -v gh >/dev/null 2>&1; then
  echo "gh not found, bootstrapping a static binary..."
  GH_VERSION="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest | grep -m1 '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')"
  curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" -o /tmp/gh.tar.gz
  tar -xzf /tmp/gh.tar.gz -C /tmp
  export PATH="/tmp/gh_${GH_VERSION}_linux_amd64/bin:$PATH"
fi
gh --version
```

Then confirm write access — a read-only check (`gh issue list`) is not
enough evidence, since it succeeds even without a token. Actually attempt a
harmless write and clean it up:

```bash
gh auth status
LABEL_TEST=$(gh label list --repo growilabs/growi --json name -q '.[0].name' 2>&1) \
  && echo "read ok: $LABEL_TEST" || { echo "gh cannot read growilabs/growi — stopping"; exit 1; }
```

If `gh` cannot be installed, or `gh auth status` shows no authenticated
account, or GitHub API calls fail with a permissions/auth error: **stop
immediately and report this clearly** (this is exactly what happened the
first time this routine ran unattended — treat a missing prerequisite as a
stop condition, not something to route around by improvising a different
approach). Do not proceed to Step 1 without confirmed write access, since
Step 1 onward creates issues/labels/PRs and a failure partway through is
harder to clean up than a clean stop before starting.

## Step 1 — Detect

Invoke the `detect-flaky-ci` skill with `$ARGUMENTS` passed through
(`--lookback`, `--vitest-threshold`). Let it finish and report its summary.

## Step 2 — Select newly-actionable issues

List issues that are confirmed flaky AND not already past the "new" stage
(so an issue already mid-investigation, WIP, or resolved from a prior
routine run is not re-processed):

```bash
gh label list --repo growilabs/growi --json name --limit 100
```

```bash
gh issue list --repo growilabs/growi --state open \
  --label "flaky/confirmed" --label "{EXACT_PHASE_NEW_LABEL}" \
  --json number,title
```

If this list is empty, report that and stop — there is nothing to
investigate this run.

## Step 3 — Investigate each, autonomously

For each issue number found, invoke the `investigate-flaky-test` skill with
`--auto`:

```
investigate-flaky-test {ISSUE_NUMBER} --auto
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

## Step 4 — Report

Summarize the run: how many issues were newly confirmed by Step 1, how many
were investigated in Step 3, how many resulted in a PR, how many were left
pending human decision (and why), and how many were quarantined. This is the
routine's output — nothing else needs to be written.
