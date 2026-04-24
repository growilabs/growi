# GitHub CLI (gh) Requirements

## CRITICAL: gh CLI Authentication is Mandatory

When any task requires GitHub operations (PRs, issues, releases, checks, etc.), you MUST use the `gh` CLI.

**If `gh` CLI is not authenticated or not available, you MUST:**

1. **STOP immediately** — do NOT attempt any fallback (WebFetch, curl, API calls, etc.)
2. **Tell the user** that `gh` CLI authentication is required
3. **Prompt the user** to run `gh auth login` before continuing
4. **Wait** — do not proceed until the user confirms authentication

## Prohibited Fallbacks

The following fallbacks are **STRICTLY FORBIDDEN** when `gh` is unavailable or unauthenticated:

- Using `WebFetch` to scrape GitHub URLs
- Using `curl` against the GitHub API directly
- Using `WebSearch` to find PR/issue information
- Any other workaround that bypasses `gh` CLI

## Required Check

Before any `gh` command, if you are unsure about authentication status, run:

```bash
gh auth status
```

If the output indicates the user is not logged in, **STOP and prompt**:

> `gh` CLI is not authenticated. Please run `gh auth login` and try again.

## Example Correct Behavior

```
# gh not authenticated → STOP
User: Please review PR #123
Assistant: gh CLI is not authenticated. Please run `gh auth login` first, then retry.
[Session stops — no fallback attempted]
```

## Why This Rule Exists

Falling back to WebFetch or other HTTP-based access when `gh` is unavailable silently bypasses authentication and can expose unintended behavior. Stopping and prompting ensures credentials are properly configured before any GitHub interaction.
