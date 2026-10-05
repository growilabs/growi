# Source

- **Real, trimmed.** `gh api -X GET repos/growilabs/growi/compare/master...807c3628fc85bbf29335840d004660ce8c195f64 -q .status`
  returned `diverged` (both `master` and this PR branch carry commits the
  other doesn't). Trimmed to `.status` for the same reason as
  `master-identical-0d1a319a.json.meta.md`.
- Commit `807c3628fc85bbf29335840d004660ce8c195f64` = head of PR #11919
  ("feat: Sync backlinks on page delete", open, base `feat/185872-backlinks`)
  at capture time.
- **Captured**: 2026-09-16.
