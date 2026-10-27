---
name: investigate-issue
description: Investigate a GitHub issue - fetch info, update labels, analyze code/reproduce, report findings, and optionally fix. Usage: /investigate-issue <issue-url-or-number>
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Agent, AskUserQuestion
argument-hint: <issue-url-or-number> [--auto]
---

# investigate-issue

## Overview

Investigate a GROWI GitHub issue end-to-end: fetch details, label it, analyze or reproduce the problem, report findings, and proceed to fix if approved.

This skill supports two execution modes:
- **interactive** (default): stop gates ask the user at each decision point — original behavior
- **autonomous** (pass `--auto` or when invoked from a routine): stop gates are crossed automatically when confidence is HIGH; only stop when confidence is MEDIUM or LOW

## Input

`$ARGUMENTS` is either:
- A full GitHub issue URL: `https://github.com/growilabs/growi/issues/99999`
- An issue number: `99999`
- Either of the above with `--auto` appended to enable autonomous mode

Parse the issue number from whichever form is provided. Detect `--auto` flag to set `mode = autonomous`; otherwise `mode = interactive`.

---

## Confidence Framework

At each decision gate, assess confidence before deciding whether to ask the user.

**CONFIDENCE levels:**

| Level | Meaning | Action in `autonomous` mode | Action in `interactive` mode |
|-------|---------|---------------------------|------------------------------|
| HIGH | Evidence is clear, risk is low, path forward is unambiguous | Proceed autonomously — state the evidence and the decision made | Ask user (present recommendation clearly) |
| MEDIUM | Some evidence exists but ambiguity remains, or blast radius is larger than expected | Stop and ask — present findings and your recommendation | Ask user |
| LOW | Evidence is thin, multiple theories, or the change is risky | Stop and ask — present what is known and what is missing | Ask user |

When stopping in `autonomous` mode (MEDIUM or LOW), present:
1. What evidence was gathered
2. Why confidence is not HIGH (specifically what is missing or ambiguous)
3. A recommended action with your reasoning
4. The alternatives

---

## Step 1: Fetch Issue Information

Run the following to get full issue details:

```bash
gh issue view {ISSUE_NUMBER} --repo growilabs/growi --json number,title,body,labels,comments,createdAt,author,url
```

Extract and display:
- Title and URL
- Description (body)
- Current labels
- Reported GROWI version (look for version info in the body/comments)
- Steps to reproduce (if any)
- Expected vs actual behavior

---

## Step 2: Update Labels — Mark as Under Investigation

Before applying any labels, fetch the exact label names from the repository:

```bash
gh label list --repo growilabs/growi --json name --limit 100
```

Use these exact names when calling `--remove-label` or `--add-label`. Label names in this repo include emoji prefixes (e.g. `"0️⃣ phase/new"`, `"1️⃣ phase/under-investigation"`), so always look them up rather than guessing.

Remove the `phase/new` label (if present) and add `phase/under-investigation`, using the exact names returned above:

```bash
# Remove phase/new (use exact name from label list, e.g. "0️⃣ phase/new")
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "{EXACT_PHASE_NEW_LABEL}"

# Add phase/under-investigation (use exact name from label list, e.g. "1️⃣ phase/under-investigation")
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "{EXACT_PHASE_UNDER_INVESTIGATION_LABEL}"
```

If `phase/new` is not present, skip the removal step and only add `phase/under-investigation`.

---

## Step 3: Analyze the Issue

### 3-A: Version Check

1. Determine the reported GROWI version from the issue body or comments.
2. Get the current master major version:
   ```bash
   cat apps/app/package.json | grep '"version"'
   ```
3. If the reported major version **matches** master's major version → proceed directly to Step 3-B.
4. If the reported major version is **older** than master's major version:

   **Autonomous confidence assessment — before asking, gather evidence:**

   Spawn a subagent to do a targeted search in the current codebase for any code paths, symptoms, or identifiers mentioned in the issue (error messages, function names, UI element names, API endpoints). Instruct the subagent to determine whether the issue is likely still present in master.

   Then assess confidence:

   - **HIGH**: The subagent finds the exact buggy code path unchanged in master (same logic, same file, same behavior described). Proceed on master and note: _"Reported on v{X}.x; confirmed the same code path is present in master — continuing analysis on master."_
   - **MEDIUM**: Code has changed but it is unclear whether the bug was fixed or remains. Stop and ask:
     > Reported version is v{X}.x, master is v{Y}.x. Related code has changed significantly (see evidence below).
     > **Recommendation**: Continue on master to check if the behavior persists.
     > Would you like me to: 1) Continue on master, 2) Check out v{X}.x tag, 3) Close as outdated?
   - **LOW**: Major version gap, completely different architecture, or the subagent finds no relevant code. Stop and ask:
     > Reported version is v{X}.x, master is v{Y}.x. Could not locate relevant code in master.
     > Would you like me to: 1) Check out v{X}.x tag, 2) Continue on master anyway, 3) Close as outdated?

   In `interactive` mode, always ask regardless of confidence. Present the evidence gathered and your recommendation.

### 3-B: Code Investigation

Search the codebase for relevant code related to the reported symptoms:

- Read error messages, stack traces, or behavioral descriptions carefully.
- Use Grep and Glob to locate relevant files, functions, and modules.
- Trace the data/execution flow to find the root cause.
- Check recent commits for related changes:
  ```bash
  git log --oneline -20 -- {relevant-file}
  ```

### 3-C: Reproduction Attempt (if needed)

If code analysis alone is insufficient to confirm the root cause, attempt reproduction:

1. Start the development server:
   ```bash
   turbo run dev
   ```
2. Follow the reproduction steps from the issue.
3. Check browser console and server logs for errors.

### 3-D: Label Update on Confirmation

If the problem is **confirmed** (root cause found in code OR reproduction succeeded):

```bash
# Use exact label names from the label list fetched in Step 2
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "{EXACT_PHASE_UNDER_INVESTIGATION_LABEL}"
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "{EXACT_PHASE_CONFIRMED_LABEL}"
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "type/bug"
```

---

## Step 4: Report Findings

> **CRITICAL**: Do NOT modify any source files in this step. Step 4 is analysis and planning only.
> Implementing code changes before the gate in Step 4-C is strictly forbidden.

### 4-A: Report in This Session

Present a clear summary:

```
## Investigation Results for #{ISSUE_NUMBER}: {TITLE}

**Status**: Confirmed / Unconfirmed / Needs reproduction

### Root Cause
{Describe what was found — file paths, line numbers, logic errors, etc.}

### Evidence
{Code snippets, git log entries, or reproduction steps that confirm the finding}

### Fix Plan (not yet implemented)
{High-level description of the fix approach, if a cause was found.
List specific files and changes needed, but do NOT apply them yet.}
```

### 4-B: Post Comment on Issue

**CRITICAL — Language rule**: Detect the language of the issue body (from Step 1) and write the comment **strictly in that language**, regardless of the language used in this conversation.
The issue body language takes absolute priority over the conversation language.

Post the findings as a GitHub issue comment:

```bash
gh issue comment {ISSUE_NUMBER} --repo growilabs/growi --body "$(cat <<'EOF'
## Investigation Results

**Status**: [Confirmed / Under investigation]

### Root Cause
{root cause description}

### Evidence
{relevant code locations, snippets, or reproduction steps}

### Fix Plan
{fix approach — files and changes needed}

---
*Investigated by Claude Code*
EOF
)"
```

### 4-C: Fix Decision Gate

**Confidence assessment — evaluate before deciding:**

Assess confidence based on:
- Root cause: **pinpointed** (exact file + lines identified) vs. **suspected** vs. **unknown**
- Fix approach: **clear** (1-3 files, minimal blast radius, no architectural change) vs. **complex** vs. **unclear**
- Risk: **low** (isolated logic, well-tested module) vs. **medium** vs. **high** (auth, data migration, shared utilities)

| Situation | Confidence |
|-----------|-----------|
| Root cause pinpointed + fix is surgical (1-3 files) + low risk | HIGH |
| Root cause identified but fix touches multiple modules or has side effects | MEDIUM |
| Root cause unconfirmed, multiple theories, or complex fix | LOW |

**In `autonomous` mode:**
- **HIGH** → proceed to Step 5 automatically. State: _"Root cause confirmed at {file}:{line}. Fix approach is clear and low-risk — proceeding to implementation."_
- **MEDIUM or LOW** → stop and ask:
  > Investigation complete. Root cause [found/not confirmed]. Fix confidence: {MEDIUM/LOW} because {specific reason}.
  > **Recommendation**: {your recommended action with reasoning}
  > Would you like me to: 1) Proceed with the fix, 2) Investigate further ({what specifically}), 3) Stop here?

**In `interactive` mode:**
Always ask, presenting confidence level and recommendation clearly.

---

## Step 5: Implement the Fix (Only if approved or autonomous HIGH confidence)

### 5-A: Add WIP Label — BEFORE Any Code Changes

**MANDATORY — Do this FIRST, before creating a branch or touching any files.**

Use the exact label name from the label list fetched in Step 2 (e.g. `"4️⃣ phase/WIP"`):

```bash
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "{EXACT_PHASE_WIP_LABEL}"
```

### 5-B: Create a Fix Branch

**Always create a dedicated fix branch before touching any source files.**
Never commit fixes to `master` or the current branch directly.

Branch naming convention: `fix/{ISSUE_NUMBER}-{short-description}`

```bash
git checkout -b fix/{ISSUE_NUMBER}-{short-description}
```

### 5-C: Implement the Fix

- Make the minimal targeted fix
- Run lint and tests:
  ```bash
  turbo run lint --filter @growi/app
  turbo run test --filter @growi/app
  ```
- Commit with a meaningful message referencing the issue:
  ```
  fix(scope): brief description of fix

  Fixes #ISSUE_NUMBER
  ```

### 5-D: PR Decision Gate

**Confidence assessment — evaluate after implementation:**

| Situation | Confidence |
|-----------|-----------|
| All tests pass + lint passes + fix stays within originally scoped files | HIGH |
| Tests pass but warnings exist, or fix expanded beyond original scope | MEDIUM |
| Tests fail, lint errors, or unexpected scope expansion | LOW |

**In `autonomous` mode:**
- **HIGH** → proceed to create PR automatically. State: _"Tests and lint pass. Fix is within scope — creating PR."_
- **MEDIUM or LOW** → stop and ask:
  > Implementation complete on `fix/{ISSUE_NUMBER}-{short-description}`. PR confidence: {MEDIUM/LOW} because {specific reason — e.g., "2 tests failing in unrelated module", "fix expanded to touch auth middleware"}.
  > **Recommendation**: {your recommended action}
  > Would you like me to: 1) Create a PR, 2) Review first, 3) Stop here?

**In `interactive` mode:**
Always ask, presenting confidence level and recommendation clearly.

### 5-E: Open a Pull Request (Only if approved or autonomous HIGH confidence)

```bash
gh pr create \
  --repo growilabs/growi \
  --title "fix: {brief description}" \
  --body "$(cat <<'EOF'
## Summary

{description of the fix}

## Root Cause

{root cause identified during investigation}

## Changes

- {bullet list of changes}

## Test Plan

- [ ] {manual test step 1}
- [ ] {manual test step 2}

Closes #{ISSUE_NUMBER}
EOF
)"
```

### 5-F: Update Labels — Mark as Resolved

After the PR is created, update the labels:

```bash
# Remove WIP label
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "{EXACT_PHASE_WIP_LABEL}"

# Add resolved label
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "{EXACT_PHASE_RESOLVED_LABEL}"
```

---

## Error Handling

- If the issue number is invalid or not found: display error from `gh` and stop
- If `gh` is not authenticated: instruct the user to run `gh auth login`
- If a label does not exist in the repo: note it in output and skip (don't create new labels)
- If the dev server fails to start: note this and rely on code analysis only
- If a subagent returns inconclusive results during confidence assessment: treat as MEDIUM confidence
