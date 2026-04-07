---
name: create-next-version-branch
description: Create development and release branches with GitHub Release for the next version. Usage: /create-next-version-branch dev/{major}.{minor}.x
---

# Create Next Version Branch

Automate the creation of development branches and GitHub Release for a new GROWI version.

## Input

The argument `$ARGUMENTS` must be a branch name in the format `dev/{major}.{minor}.x` (e.g., `dev/7.5.x`).

## Procedure

### Step 1: Parse and Validate Input

1. Parse `$ARGUMENTS` to extract `{major}` and `{minor}` from the `dev/{major}.{minor}.x` pattern
2. If the format is invalid, display an error and stop:
   - Must match `dev/{number}.{number}.x`
3. Set the following variables:
   - `DEV_BRANCH`: `dev/{major}.{minor}.x`
   - `RELEASE_BRANCH`: `release/{major}.{minor}.x`
   - `TAG_NAME`: `v{major}.{minor}.x-base`
   - `RELEASE_TITLE`: `v{major}.{minor}.x Base Release`

### Step 2: Create and Push the Development Branch

1. Confirm with the user before proceeding
2. Create and push `DEV_BRANCH` from the current HEAD:
   ```bash
   git checkout -b {DEV_BRANCH}
   git push origin {DEV_BRANCH}
   ```

### Step 3: Create GitHub Release

1. Create a GitHub Release using `gh release create`:
   ```bash
   gh release create {TAG_NAME} \
     --target {DEV_BRANCH} \
     --title "{RELEASE_TITLE}" \
     --notes "The base release for release-drafter to avoid \`Error: GraphQL Rate Limit Exceeded\`
   https://github.com/release-drafter/release-drafter/issues/1018" \
     --latest=false \
     --prerelease=false
   ```
   - `--latest=false`: Do NOT set as latest release
   - `--prerelease=false`: Do NOT set as pre-release

### Step 4: Verify targetCommitish

1. Run the following command and confirm that `targetCommitish` equals `DEV_BRANCH`:
   ```bash
   gh release view {TAG_NAME} --json targetCommitish
   ```
2. If `targetCommitish` does not match, display an error and stop

### Step 5: Create and Push the Release Branch

1. From the same commit (still on `DEV_BRANCH`), create and push `RELEASE_BRANCH`:
   ```bash
   git checkout -b {RELEASE_BRANCH}
   git push origin {RELEASE_BRANCH}
   ```

### Step 6: Summary

Display a summary of all created resources:

```
Created:
  - Branch: {DEV_BRANCH} (pushed to origin)
  - Branch: {RELEASE_BRANCH} (pushed to origin)
  - GitHub Release: {RELEASE_TITLE} (tag: {TAG_NAME}, target: {DEV_BRANCH})
```

## Error Handling

- If `DEV_BRANCH` already exists on the remote, warn the user and ask how to proceed
- If `RELEASE_BRANCH` already exists on the remote, warn the user and ask how to proceed
- If the tag `TAG_NAME` already exists, warn the user and ask how to proceed
- If `gh` CLI is not authenticated, instruct the user to run `gh auth login`
