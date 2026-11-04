# GitHub Actions Workflow YAML

## Never put a comment inside an `if: |` block

In a workflow YAML, `if: |` is a **literal block scalar** — everything
indented under it, `#`-prefixed lines included, is literal text handed
straight to the GitHub Actions expression parser. It is not YAML comment
syntax there, unlike a comment placed anywhere else in the file.

This matters because prose with a possessive or contraction (`bot's`,
`PR's`, `Mergify's`) has an odd number of `'` characters. Inside `if: |`,
that opens a single-quoted string literal that never closes, and the
**entire workflow file** fails to parse — every run of that workflow shows
zero jobs with GitHub's "workflow file issue" banner, on every trigger,
until the file is fixed.

This already broke `ci-app-prod.yml`'s `test-prod-node24` job in production
for about a day (see PR #11972, #11973, #11974) before anyone noticed —
the run's displayed name had silently fallen back to the raw file path
(`.github/workflows/ci-app-prod.yml` instead of `Node CI for app
production`), which is itself the tell: a per-job `if:` evaluation
failure can't affect the file-level `name:` key, so that fallback means
the whole file failed to parse, not just one job's condition.

```yaml
# ❌ WRONG — comment lives inside the if: | block scalar; the apostrophes
# in "bot's" and "PR's" open unterminated string literals and the whole
# file fails to parse
jobs:
  my-job:
    if: |
      ( github.event_name == 'push' )
      # Skip when this is the bot's translation-only PR's branch
      && github.head_ref != 'i18n-sync/translation-only'

# ✅ CORRECT — comment sits above if: as an ordinary job-level YAML comment;
# the if: | scalar itself is bare expression syntax
jobs:
  # Skip when this is the bot's translation-only PR's branch
  my-job:
    if: |
      ( github.event_name == 'push' )
      && github.head_ref != 'i18n-sync/translation-only'
```

`ci-app.yml`'s `ci-app-test` job already uses the correct pattern.

## Verifying an `if:` fix before trusting it

Pushing to a branch that doesn't match a workflow's `branches:` filter is
**not** a valid way to test whether that workflow's content is broken —
GitHub still creates a zero-job "workflow file issue" run for a push that
modifies the file, regardless of branch match, so a non-matching-branch
push always looks broken and tells you nothing about the content. Test
`if:` changes only on a branch the trigger's `branches:`/`paths:` filters
actually match (e.g. `master`), and confirm the result via
`gh api repos/<org>/<repo>/actions/runs/<id>/jobs` (job count, not just
the pass/fail badge) — a run can complete "successfully" while still
having started zero jobs.
