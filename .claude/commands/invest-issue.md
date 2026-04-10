---
name: invest-issue
description: Investigate a GitHub issue - fetch info, update labels, analyze code/reproduce, report findings, and optionally fix. Usage: /invest-issue <issue-url-or-number>
---

# /invest-issue — Issue Investigation

Investigate a GROWI GitHub issue end-to-end: fetch details, label it, analyze or reproduce the problem, report findings, and proceed to fix if approved.

## Input

`$ARGUMENTS` is either:
- A full GitHub issue URL: `https://github.com/growilabs/growi/issues/99999`
- An issue number: `99999`

Parse the issue number from whichever form is provided.

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

## Step 2: Update Labels — Mark as Under Investigation

Remove `phase/new` (if present) and add `phase/under-investigation`:

```bash
# Remove phase/new
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "phase/new"

# Add phase/under-investigation
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "phase/under-investigation"
```

If `phase/new` is not present, skip the removal step and only add `phase/under-investigation`.

## Step 3: Analyze the Issue

### 3-A: Version Check

1. Determine the reported GROWI version from the issue body or comments.
2. Get the current master major version:
   ```bash
   cat apps/app/package.json | grep '"version"'
   ```
3. If the reported major version matches master's major version → proceed with master-branch analysis.
4. If the reported major version is **older** than master's major version → **STOP analysis** and ask the user:

   > Reported version is v{X}.x, but master is v{Y}.x.
   > Would you like me to:
   > 1. **Check out v{X}.x tag/branch** and analyze on that version
   > 2. **Continue on master** — the issue may still be relevant
   > 3. **Close as outdated** — skip analysis

   **Wait for the user's response before continuing to Step 3-B.**

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
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --remove-label "phase/under-investigation"
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "phase/confirmed"
```

## Step 4: Report Findings

> **CRITICAL**: Do NOT modify any source files in this step. Step 4 is analysis and planning only.
> Implementing code changes before receiving explicit user approval is strictly forbidden.

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

Detect the language of the issue body (from Step 1) and write the comment **in the same language**.
For example, if the issue is written in Japanese, write the comment in Japanese.

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

### 4-C: STOP — Ask for Direction

**STOP HERE. Do not proceed to Step 5 until the user explicitly approves.**

After reporting, ask the user:

> Investigation complete. Root cause [found / not yet confirmed].
> Would you like me to:
> 1. **Proceed with the fix** — I'll implement the fix now
> 2. **Investigate further** — specify what additional analysis is needed
> 3. **Stop here** — you'll handle the fix manually

**Wait for the user's response before doing anything else.**

## Step 5: Implement the Fix (Only if Approved)

Proceed only after explicit user approval.

### 5-A: Add WIP Label

```bash
gh issue edit {ISSUE_NUMBER} --repo growilabs/growi --add-label "phase/WIP"
```

### 5-B: Create a Fix Branch

**Always create a dedicated fix branch before touching any source files.**
Never commit fixes to `master` or the current branch directly.

Branch naming convention: `fix/{ISSUE_NUMBER}-{short-description}`

```bash
git checkout -b fix/{ISSUE_NUMBER}-{short-description}
```

Example: `fix/12345-page-title-overflow`

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

### 5-D: Open a Pull Request

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

## Error Handling

- If the issue number is invalid or not found: display error from `gh` and stop
- If `gh` is not authenticated: instruct the user to run `gh auth login`
- If a label does not exist in the repo: note it in output and skip (don't create new labels)
- If the dev server fails to start: note this and rely on code analysis only
